import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { ACTIVE_STATUSES, CLAIM_STATUSES, DISCREPANCY_TYPES, nextStatuses, type ClaimStatus } from '@grandir/engines';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createPasswordResetToken, logActivity, revokeUserSessions, ROLE_RANK, type Role } from '../auth/service';
import type { Config } from '../config';
import { initialConnector, isDemoConnector, MARKETPLACES } from '../connectors/index';
import { NfeError, parseNfeXml, toEngineInvoices } from '../connectors/erp/nfe';
import { parseErpProducts } from '../connectors/erp/sheet';
import { nowIso, type Db } from '../db';
import { badRequest, conflict, forbidden, notFound } from '../errors';
import type { Mailer } from '../mailer';
import { randomToken } from '../security/crypto';
import { hashPassword } from '../security/password';
import { runStoreAudit } from '../services/audit';
import { addComment, addDocumentEvent, getClaim, openClaim, transitionClaim } from '../services/claims';
import { simulateDemoHistory } from '../services/demoHistory';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_STORES = 10;
const DOCUMENT_KINDS = ['NOTA_FISCAL', 'COMPROVANTE_ENTREGA', 'OUTRO'] as const;

/** Extensões aceitas e, quando o formato tem assinatura, os bytes iniciais esperados. */
const UPLOAD_TYPES: Record<string, number[] | null> = {
  '.pdf': [0x25, 0x50, 0x44, 0x46],
  '.png': [0x89, 0x50, 0x4e, 0x47],
  '.jpg': [0xff, 0xd8, 0xff],
  '.jpeg': [0xff, 0xd8, 0xff],
  '.xlsx': [0x50, 0x4b],
  '.csv': null,
};

const idParams = z.object({ id: z.string().uuid() });

export interface PortalDeps {
  db: Db;
  config: Config;
  mailer: Mailer;
  requireAuth: (request: FastifyRequest) => Promise<void>;
}

export async function portalRoutes(app: FastifyInstance, deps: PortalDeps): Promise<void> {
  const { db, config, mailer, requireAuth } = deps;

  const atLeast = (role: Role) => [
    requireAuth,
    async (request: FastifyRequest) => {
      if (ROLE_RANK[request.auth!.user.role] < ROLE_RANK[role]) throw forbidden();
    },
  ];
  const actorName = (request: FastifyRequest) => `${request.auth!.user.firstName} ${request.auth!.user.lastName}`;
  const audit = (request: FastifyRequest, action: string, target?: string) => {
    const { user } = request.auth!;
    logActivity(db, { tenantId: user.tenantId, userId: user.id, actor: user.email, action, target, ip: request.ip });
  };

  // ───────────────────────── Visão geral ─────────────────────────

  app.get('/api/dashboard', { preHandler: atLeast('VIEWER') }, async (request) => {
    const { scope } = request.auth!;

    const identified = scope.get<{ cents: number; count: number }>(
      `SELECT COALESCE(SUM(estimated_value_cents), 0) AS cents, COUNT(*) AS count
         FROM discrepancies WHERE tenant_id = :tenantId AND status != 'DISMISSED'`,
    )!;
    const open = scope.get<{ cents: number; count: number }>(
      `SELECT COALESCE(SUM(estimated_value_cents), 0) AS cents, COUNT(*) AS count
         FROM discrepancies WHERE tenant_id = :tenantId AND status = 'OPEN'`,
    )!;
    const pipeline = scope.all<{ status: ClaimStatus; count: number; claimedCents: number; approvedCents: number }>(
      `SELECT status, COUNT(*) AS count, COALESCE(SUM(claimed_cents), 0) AS claimedCents,
              COALESCE(SUM(approved_cents), 0) AS approvedCents
         FROM claims WHERE tenant_id = :tenantId GROUP BY status`,
    );
    const paidByMonth = new Map(
      scope
        .all<{ period: string; cents: number }>(
          `SELECT substr(paid_at, 1, 7) AS period, SUM(approved_cents) AS cents
             FROM claims WHERE tenant_id = :tenantId AND status = 'PAID' GROUP BY 1`,
        )
        .map((row) => [row.period, row.cents]),
    );
    const byType = scope.all<{ type: string; count: number; cents: number }>(
      `SELECT type, COUNT(*) AS count, SUM(estimated_value_cents) AS cents
         FROM discrepancies WHERE tenant_id = :tenantId AND status != 'DISMISSED'
        GROUP BY type ORDER BY cents DESC`,
    );
    const recent = scope.all(
      `SELECT e.at, e.kind, e.to_status AS toStatus, e.note, e.actor, c.code, c.id AS claimId
         FROM claim_events e JOIN claims c ON c.id = e.claim_id AND c.tenant_id = e.tenant_id
        WHERE e.tenant_id = :tenantId ORDER BY e.at DESC LIMIT 8`,
    );
    const fees = scope.get<{ cents: number }>(
      'SELECT COALESCE(SUM(fee_cents), 0) AS cents FROM invoices WHERE tenant_id = :tenantId',
    )!;
    const stores = scope.get<{ count: number; lastAuditAt: string | null }>(
      'SELECT COUNT(*) AS count, MAX(last_audit_at) AS lastAuditAt FROM stores WHERE tenant_id = :tenantId',
    )!;

    const sum = (statuses: readonly ClaimStatus[], field: 'claimedCents' | 'approvedCents' | 'count') =>
      pipeline.filter((row) => statuses.includes(row.status)).reduce((total, row) => total + row[field], 0);
    const won = sum(['APPROVED', 'PARTIALLY_APPROVED', 'PAID'], 'count');
    const lost = sum(['DENIED', 'CLOSED'], 'count');

    const monthly: { period: string; cents: number }[] = [];
    const cursor = new Date();
    cursor.setUTCDate(1);
    for (let i = 11; i >= 0; i--) {
      const date = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - i, 1));
      const period = date.toISOString().slice(0, 7);
      monthly.push({ period, cents: paidByMonth.get(period) ?? 0 });
    }

    return {
      totals: {
        identifiedCents: identified.cents,
        identifiedCount: identified.count,
        openCents: open.cents,
        openCount: open.count,
        inDisputeCents: sum(ACTIVE_STATUSES, 'claimedCents'),
        inDisputeCount: sum(ACTIVE_STATUSES, 'count'),
        awaitingPaymentCents: sum(['APPROVED', 'PARTIALLY_APPROVED'], 'approvedCents'),
        recoveredCents: sum(['PAID'], 'approvedCents'),
        feesCents: fees.cents,
        needsDocumentsCount: sum(['NEEDS_DOCUMENTS'], 'count'),
        successRate: won + lost > 0 ? won / (won + lost) : null,
      },
      monthly,
      byType,
      pipeline,
      recent,
      stores,
    };
  });

  // ───────────────────────── Lojas e auditoria ─────────────────────────

  app.get('/api/stores', { preHandler: atLeast('VIEWER') }, async (request) => {
    const { scope } = request.auth!;
    return {
      stores: scope.all(
        `SELECT s.id, s.name, s.marketplace, s.region, s.connector, s.status,
                s.last_audit_at AS lastAuditAt, s.created_at AS createdAt,
                (SELECT COUNT(*) FROM discrepancies d WHERE d.tenant_id = s.tenant_id AND d.store_id = s.id) AS discrepancyCount,
                (SELECT COUNT(*) FROM nfe_documents n WHERE n.tenant_id = s.tenant_id AND n.store_id = s.id) AS nfeCount,
                (SELECT COUNT(*) FROM erp_products p WHERE p.tenant_id = s.tenant_id AND p.store_id = s.id) AS erpProductCount
           FROM stores s WHERE s.tenant_id = :tenantId ORDER BY s.created_at`,
      ),
      runs: scope.all(
        `SELECT r.id, r.store_id AS storeId, s.name AS storeName, r.finished_at AS finishedAt,
                r.events_scanned AS eventsScanned, r.discrepancies_found AS discrepanciesFound,
                r.new_discrepancies AS newDiscrepancies, r.value_found_cents AS valueFoundCents,
                r.pending_count AS pendingCount, r.expired_count AS expiredCount
           FROM audit_runs r JOIN stores s ON s.id = r.store_id AND s.tenant_id = r.tenant_id
          WHERE r.tenant_id = :tenantId ORDER BY r.finished_at DESC LIMIT 15`,
      ),
    };
  });

  app.post('/api/stores', { preHandler: atLeast('ADMIN') }, async (request, reply) => {
    const { scope } = request.auth!;
    const body = z
      .object({
        name: z.string().trim().min(2, 'Dê um nome à loja.').max(80),
        marketplace: z.enum(MARKETPLACES),
        region: z.string().trim().length(2).toUpperCase(),
      })
      .parse(request.body);

    const { total } = scope.get<{ total: number }>('SELECT COUNT(*) AS total FROM stores WHERE tenant_id = :tenantId')!;
    if (total >= MAX_STORES) throw conflict(`Limite de ${MAX_STORES} lojas por conta atingido.`);

    const connector = initialConnector(body.marketplace, config.demoMode);
    const demo = isDemoConnector(connector);
    const storeId = randomUUID();
    scope.run(
      `INSERT INTO stores (id, tenant_id, name, marketplace, region, connector, created_at)
       VALUES (:id, :tenantId, :name, :marketplace, :region, :connector, :createdAt)`,
      { id: storeId, ...body, connector, createdAt: nowIso() },
    );
    // Loja real nasce vazia, aguardando os dados do seller: não há o que auditar ainda.
    if (!demo) {
      scope.run("UPDATE stores SET status = 'AGUARDANDO_DADOS' WHERE tenant_id = :tenantId AND id = :storeId", { storeId });
      audit(request, 'LOJA_CONECTADA', body.name);
      reply.status(201);
      return { id: storeId, audit: null };
    }
    const summary = await runStoreAudit(scope, config, storeId);
    if (connector === 'demo') simulateDemoHistory(scope, storeId);
    audit(request, 'LOJA_CONECTADA', body.name);
    reply.status(201);
    return { id: storeId, audit: summary };
  });

  app.post('/api/stores/:id/audit', { preHandler: atLeast('ANALYST') }, async (request) => {
    const { id } = idParams.parse(request.params);
    const summary = await runStoreAudit(request.auth!.scope, config, id);
    audit(request, 'AUDITORIA_EXECUTADA', id);
    return { audit: summary };
  });

  app.addContentTypeParser('text/csv', { parseAs: 'string', bodyLimit: MAX_UPLOAD_BYTES }, (_request, body, done) => done(null, body));

  // Cadastro de produtos exportado do ERP (Bling, Tiny, Omie…): fonte de verdade de custo, peso e medidas.
  app.put('/api/stores/:id/erp-products', { preHandler: atLeast('ADMIN'), bodyLimit: MAX_UPLOAD_BYTES }, async (request) => {
    const { scope } = request.auth!;
    const { id } = idParams.parse(request.params);
    if (typeof request.body !== 'string') throw badRequest('Envie a planilha em CSV no corpo da requisição.');
    if (!scope.get('SELECT id FROM stores WHERE tenant_id = :tenantId AND id = :id', { id })) throw notFound('Loja não encontrada.');

    const sheet = parseErpProducts(request.body);
    if (sheet.products.length === 0) throw badRequest(sheet.errors[0]?.reason ?? 'Nenhum produto válido na planilha.');
    const importedAt = nowIso();
    scope.transaction(() => {
      for (const product of sheet.products.slice(0, 5000)) {
        scope.run(
          `INSERT INTO erp_products (tenant_id, store_id, sku, product_json, imported_at)
           VALUES (:tenantId, :storeId, :sku, :json, :importedAt)
           ON CONFLICT (tenant_id, store_id, sku) DO UPDATE SET product_json = :json, imported_at = :importedAt`,
          { storeId: id, sku: product.sku, json: JSON.stringify(product), importedAt },
        );
      }
    });
    const summary = await runStoreAudit(scope, config, id);
    audit(request, 'PLANILHA_ERP_IMPORTADA', `${sheet.products.length} produtos`);
    return { imported: sheet.products.length, errors: sheet.errors.slice(0, 20), audit: summary };
  });

  // Importação em lote de XML de NF-e (modelo 55): notas de entrada, remessa, retorno, venda e devolução.
  app.put('/api/stores/:id/nfe', { preHandler: atLeast('ADMIN'), bodyLimit: MAX_UPLOAD_BYTES }, async (request) => {
    const { scope } = request.auth!;
    const { id } = idParams.parse(request.params);
    const body = z
      .object({ files: z.array(z.object({ name: z.string().max(200), xml: z.string().min(1) })).min(1, 'Envie ao menos um XML.').max(300) })
      .parse(request.body);
    if (!scope.get('SELECT id FROM stores WHERE tenant_id = :tenantId AND id = :id', { id })) throw notFound('Loja não encontrada.');

    const importedAt = nowIso();
    const byKind: Record<string, number> = {};
    const errors: { file: string; reason: string }[] = [];
    let imported = 0;
    let duplicates = 0;
    scope.transaction(() => {
      for (const file of body.files) {
        try {
          const nfe = parseNfeXml(file.xml);
          const changed = scope.run(
            `INSERT INTO nfe_documents (tenant_id, store_id, access_key, kind, issued_at, cfop, total_cents, doc_json, imported_at)
             VALUES (:tenantId, :storeId, :key, :kind, :issuedAt, :cfop, :total, :json, :importedAt)
             ON CONFLICT (tenant_id, store_id, access_key) DO NOTHING`,
            { storeId: id, key: nfe.accessKey, kind: nfe.kind, issuedAt: nfe.issuedAt, cfop: nfe.cfop, total: nfe.totals.invoiceCents, json: JSON.stringify(toEngineInvoices(nfe)), importedAt },
          );
          if (changed) {
            imported += 1;
            byKind[nfe.kind] = (byKind[nfe.kind] ?? 0) + 1;
          } else duplicates += 1;
        } catch (error) {
          if (!(error instanceof NfeError)) throw error;
          errors.push({ file: file.name, reason: error.message });
        }
      }
    });
    const summary = imported > 0 ? await runStoreAudit(scope, config, id) : null;
    audit(request, 'NFE_IMPORTADAS', `${imported} notas`);
    return { imported, duplicates, byKind, errors: errors.slice(0, 50), audit: summary };
  });

  app.get('/api/reconciliation', { preHandler: atLeast('VIEWER') }, async (request) => {
    const { scope } = request.auth!;
    return {
      rows: scope.all(
        `SELECT r.sku, r.product_name AS productName, s.name AS storeName, r.opening, r.inbound, r.outbound,
                r.adjustments, r.expected_ending AS expectedEnding, r.reported_ending AS reportedEnding,
                r.variance, r.variance_value_cents AS varianceValueCents
           FROM sku_reconciliation r JOIN stores s ON s.id = r.store_id AND s.tenant_id = r.tenant_id
          WHERE r.tenant_id = :tenantId ORDER BY r.variance, r.sku`,
      ),
    };
  });

  // ───────────────────────── Divergências ─────────────────────────

  app.get('/api/discrepancies', { preHandler: atLeast('VIEWER') }, async (request) => {
    const { scope } = request.auth!;
    const query = z
      .object({
        status: z.enum(['OPEN', 'CLAIMED', 'RESOLVED', 'DISMISSED']).optional(),
        type: z.enum(DISCREPANCY_TYPES).optional(),
      })
      .parse(request.query);
    const rows = scope.all<{ evidenceJson: string }>(
      `SELECT d.id, d.type, d.sku, d.product_name AS productName, d.quantity,
              d.estimated_value_cents AS estimatedValueCents, d.reference_id AS referenceId,
              d.evidence_json AS evidenceJson, d.occurred_at AS occurredAt, d.detected_at AS detectedAt,
              d.expires_at AS expiresAt, d.status, s.name AS storeName, c.id AS claimId, c.code AS claimCode
         FROM discrepancies d
         JOIN stores s ON s.id = d.store_id AND s.tenant_id = d.tenant_id
         LEFT JOIN claims c ON c.discrepancy_id = d.id AND c.tenant_id = d.tenant_id
        WHERE d.tenant_id = :tenantId
          AND (:status IS NULL OR d.status = :status)
          AND (:type IS NULL OR d.type = :type)
        ORDER BY d.estimated_value_cents DESC LIMIT 500`,
      { status: query.status ?? null, type: query.type ?? null },
    );
    return {
      discrepancies: rows.map(({ evidenceJson, ...row }) => ({ ...row, evidence: JSON.parse(evidenceJson) as string[] })),
    };
  });

  app.post('/api/discrepancies/:id/claim', { preHandler: atLeast('ANALYST') }, async (request, reply) => {
    const { scope } = request.auth!;
    const { id } = idParams.parse(request.params);
    const claim = scope.transaction(() => openClaim(scope, id, actorName(request)));
    audit(request, 'CHAMADO_ABERTO', claim.code);
    reply.status(201);
    return { id: claim.id, code: claim.code };
  });

  app.post('/api/discrepancies/claim-all', { preHandler: atLeast('ANALYST') }, async (request) => {
    const { scope } = request.auth!;
    const opened = scope.transaction(() => {
      const ids = scope.all<{ id: string }>(
        "SELECT id FROM discrepancies WHERE tenant_id = :tenantId AND status = 'OPEN' ORDER BY estimated_value_cents DESC",
      );
      for (const { id } of ids) openClaim(scope, id, actorName(request));
      return ids.length;
    });
    audit(request, 'CHAMADOS_ABERTOS_EM_LOTE', String(opened));
    return { opened };
  });

  app.post('/api/discrepancies/:id/dismiss', { preHandler: atLeast('ANALYST') }, async (request) => {
    const { scope } = request.auth!;
    const { id } = idParams.parse(request.params);
    const changed = scope.run(
      "UPDATE discrepancies SET status = 'DISMISSED' WHERE tenant_id = :tenantId AND id = :id AND status = 'OPEN'",
      { id },
    );
    if (!changed) throw conflict('Só é possível descartar divergências em aberto.');
    audit(request, 'DIVERGENCIA_DESCARTADA', id);
    return { ok: true };
  });

  // ───────────────────────── Chamados ─────────────────────────

  app.get('/api/claims', { preHandler: atLeast('VIEWER') }, async (request) => {
    const { scope } = request.auth!;
    const query = z.object({ status: z.enum(CLAIM_STATUSES).optional() }).parse(request.query);
    return {
      claims: scope.all(
        `SELECT c.id, c.code, c.type, c.status, c.claimed_cents AS claimedCents, c.approved_cents AS approvedCents,
                c.marketplace_case_id AS marketplaceCaseId, c.opened_at AS openedAt, c.updated_at AS updatedAt, c.case_id AS caseId,
                d.sku, d.product_name AS productName, d.quantity, s.name AS storeName
           FROM claims c
           JOIN discrepancies d ON d.id = c.discrepancy_id AND d.tenant_id = c.tenant_id
           JOIN stores s ON s.id = c.store_id AND s.tenant_id = c.tenant_id
          WHERE c.tenant_id = :tenantId AND (:status IS NULL OR c.status = :status)
          ORDER BY c.updated_at DESC LIMIT 500`,
        { status: query.status ?? null },
      ),
    };
  });

  app.get('/api/claims/:id', { preHandler: atLeast('VIEWER') }, async (request) => {
    const { scope } = request.auth!;
    const { id } = idParams.parse(request.params);
    const claim = scope.get<{ status: ClaimStatus; evidenceJson: string }>(
      `SELECT c.id, c.code, c.type, c.status, c.claimed_cents AS claimedCents, c.approved_cents AS approvedCents,
              c.marketplace_case_id AS marketplaceCaseId, c.opened_at AS openedAt, c.updated_at AS updatedAt,
              c.resolved_at AS resolvedAt, c.paid_at AS paidAt, c.case_id AS caseId,
              d.sku, d.product_name AS productName, d.quantity, d.reference_id AS referenceId,
              d.occurred_at AS occurredAt, d.expires_at AS expiresAt, d.evidence_json AS evidenceJson,
              s.name AS storeName, s.marketplace
         FROM claims c
         JOIN discrepancies d ON d.id = c.discrepancy_id AND d.tenant_id = c.tenant_id
         JOIN stores s ON s.id = c.store_id AND s.tenant_id = c.tenant_id
        WHERE c.tenant_id = :tenantId AND c.id = :id`,
      { id },
    );
    if (!claim) throw notFound('Chamado não encontrado.');
    const { evidenceJson, ...rest } = claim;
    return {
      claim: {
        ...rest,
        evidence: JSON.parse(evidenceJson) as string[],
        // Ocorrência de dossiê não tem próximos passos próprios.
        nextStatuses: (rest as { caseId?: string | null }).caseId ? [] : nextStatuses(claim.status),
      },
      events: scope.all(
        `SELECT id, at, actor, kind, from_status AS fromStatus, to_status AS toStatus, note
           FROM claim_events WHERE tenant_id = :tenantId AND claim_id = :id ORDER BY at DESC, rowid DESC`,
        { id },
      ),
      documents: scope.all(
        `SELECT id, kind, filename, size_bytes AS sizeBytes, uploaded_by AS uploadedBy, created_at AS createdAt
           FROM documents WHERE tenant_id = :tenantId AND claim_id = :id ORDER BY created_at DESC`,
        { id },
      ),
    };
  });

  app.post('/api/claims/:id/transition', { preHandler: atLeast('ANALYST') }, async (request) => {
    const { scope } = request.auth!;
    const { id } = idParams.parse(request.params);
    const body = z
      .object({
        to: z.enum(CLAIM_STATUSES),
        note: z.string().trim().max(1000).optional(),
        approvedCents: z.number().int().positive().optional(),
        marketplaceCaseId: z.string().trim().max(60).optional(),
      })
      .parse(request.body);
    if (getClaim(scope, id).case_id) {
      throw conflict('Esta ocorrência faz parte de um chamado de dossiê: atualize a situação pelo dossiê.', 'GOVERNADO_PELO_DOSSIE');
    }
    const claim = scope.transaction(() =>
      transitionClaim(scope, id, body.to, {
        actor: actorName(request),
        note: body.note || undefined,
        approvedCents: body.approvedCents,
        marketplaceCaseId: body.marketplaceCaseId || undefined,
      }),
    );
    audit(request, `CHAMADO_${body.to}`, claim.code);
    return { status: claim.status };
  });

  app.post('/api/claims/:id/comments', { preHandler: atLeast('ANALYST') }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = z.object({ note: z.string().trim().min(1, 'Escreva o comentário.').max(2000) }).parse(request.body);
    addComment(request.auth!.scope, id, actorName(request), body.note);
    reply.status(201);
    return { ok: true };
  });

  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: MAX_UPLOAD_BYTES }, (_request, body, done) =>
    done(null, body),
  );

  app.put('/api/claims/:id/documents', { preHandler: atLeast('ANALYST'), bodyLimit: MAX_UPLOAD_BYTES }, async (request, reply) => {
    const { scope, user } = request.auth!;
    const { id } = idParams.parse(request.params);
    const query = z.object({ kind: z.enum(DOCUMENT_KINDS), filename: z.string().min(1).max(160) }).parse(request.query);
    const content = request.body;
    if (!Buffer.isBuffer(content) || content.length === 0) throw badRequest('Envie o arquivo no corpo da requisição.');

    // O nome é só um rótulo: o arquivo é gravado sob um identificador gerado pelo servidor.
    const filename = basename(query.filename).replace(/[^\p{L}\p{N}._ -]/gu, '_');
    const extension = extname(filename).toLowerCase();
    if (!(extension in UPLOAD_TYPES)) throw badRequest('Formato não aceito. Envie PDF, PNG, JPG, CSV ou XLSX.');
    const signature = UPLOAD_TYPES[extension];
    if (signature && !signature.every((byte, index) => content[index] === byte)) {
      throw badRequest('O conteúdo do arquivo não corresponde à extensão informada.');
    }
    getClaim(scope, id);

    const documentId = randomUUID();
    const directory = join(config.uploadDir, user.tenantId);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, documentId), content, { flag: 'wx' });
    scope.transaction(() => {
      scope.run(
        `INSERT INTO documents (id, tenant_id, claim_id, kind, filename, size_bytes, sha256, uploaded_by, created_at)
         VALUES (:id, :tenantId, :claimId, :kind, :filename, :size, :sha256, :uploadedBy, :createdAt)`,
        {
          id: documentId,
          claimId: id,
          kind: query.kind,
          filename,
          size: content.length,
          sha256: createHash('sha256').update(content).digest('hex'),
          uploadedBy: actorName(request),
          createdAt: nowIso(),
        },
      );
      addDocumentEvent(scope, id, actorName(request), filename);
    });
    audit(request, 'DOCUMENTO_ENVIADO', filename);
    reply.status(201);
    return { id: documentId };
  });

  app.get('/api/documents/:id', { preHandler: atLeast('VIEWER') }, async (request, reply) => {
    const { scope, user } = request.auth!;
    const { id } = idParams.parse(request.params);
    const document = scope.get<{ filename: string }>(
      'SELECT filename FROM documents WHERE tenant_id = :tenantId AND id = :id',
      { id },
    );
    if (!document) throw notFound('Documento não encontrado.');
    audit(request, 'DOCUMENTO_BAIXADO', document.filename);
    return reply
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(document.filename)}`)
      .type('application/octet-stream')
      .send(createReadStream(join(config.uploadDir, user.tenantId, id)));
  });

  // ───────────────────────── Faturamento ─────────────────────────

  app.get('/api/billing', { preHandler: atLeast('ADMIN') }, async (request) => {
    const { scope } = request.auth!;
    const currentPeriod = nowIso().slice(0, 7);
    const invoices = scope.all<{ period: string }>(
      `SELECT i.id, i.period, i.fee_rate_bps AS feeRateBps, i.recovered_cents AS recoveredCents, i.fee_cents AS feeCents,
              (SELECT COUNT(*) FROM invoice_lines l WHERE l.invoice_id = i.id AND l.tenant_id = i.tenant_id) AS lineCount
         FROM invoices i WHERE i.tenant_id = :tenantId ORDER BY i.period DESC`,
    );
    return {
      feeRateBps: scope.get<{ rate: number }>('SELECT fee_rate_bps AS rate FROM tenants WHERE id = :tenantId')!.rate,
      invoices: invoices.map((invoice) => ({ ...invoice, status: invoice.period < currentPeriod ? 'FECHADA' : 'EM_ABERTO' })),
      lines: scope.all(
        `SELECT l.id, i.period, c.code, c.id AS claimId, c.type, l.recovered_cents AS recoveredCents,
                l.fee_cents AS feeCents, l.created_at AS createdAt
           FROM invoice_lines l
           JOIN invoices i ON i.id = l.invoice_id AND i.tenant_id = l.tenant_id
           JOIN claims c ON c.id = l.claim_id AND c.tenant_id = l.tenant_id
          WHERE l.tenant_id = :tenantId ORDER BY l.created_at DESC LIMIT 200`,
      ),
    };
  });

  // ───────────────────────── Equipe e trilha de auditoria ─────────────────────────

  app.get('/api/team', { preHandler: atLeast('ADMIN') }, async (request) => ({
    members: request.auth!.scope.all<{ active: number; mfaEnabled: number }>(
      `SELECT id, email, first_name AS firstName, last_name AS lastName, role, active,
              mfa_enabled AS mfaEnabled, created_at AS createdAt
         FROM users WHERE tenant_id = :tenantId ORDER BY created_at`,
    ).map((member) => ({ ...member, active: member.active === 1, mfaEnabled: member.mfaEnabled === 1 })),
  }));

  app.post('/api/team', { preHandler: atLeast('ADMIN') }, async (request, reply) => {
    const { scope } = request.auth!;
    const body = z
      .object({
        email: z.string().trim().toLowerCase().email('Informe um e-mail válido.').max(254),
        firstName: z.string().trim().min(1, 'Informe o nome.').max(80),
        lastName: z.string().trim().min(1, 'Informe o sobrenome.').max(80),
        role: z.enum(['ADMIN', 'ANALYST', 'VIEWER']),
      })
      .parse(request.body);

    const userId = randomUUID();
    // Senha aleatória descartável: o convidado define a própria pelo link do convite.
    const passwordHash = await hashPassword(randomToken());
    try {
      scope.run(
        `INSERT INTO users (id, tenant_id, email, first_name, last_name, password_hash, role, created_at)
         VALUES (:id, :tenantId, :email, :firstName, :lastName, :passwordHash, :role, :createdAt)`,
        { id: userId, ...body, passwordHash, createdAt: nowIso() },
      );
    } catch (error) {
      if (String((error as Error).message).includes('UNIQUE')) {
        throw conflict('Este e-mail já está cadastrado na Grandir.', 'EMAIL_EM_USO');
      }
      throw error;
    }
    const token = createPasswordResetToken(db, userId, 72);
    await mailer.send({
      to: body.email,
      subject: 'Você foi convidado para a Grandir',
      text: `${actorName(request)} convidou você para acompanhar as recuperações na Grandir.\nCrie sua senha (link válido por 72 horas):\n${config.webOrigins[0]}/redefinir-senha?token=${token}`,
    });
    audit(request, 'MEMBRO_CONVIDADO', body.email);
    reply.status(201);
    return { id: userId };
  });

  app.patch('/api/team/:id', { preHandler: atLeast('ADMIN') }, async (request) => {
    const { scope, user } = request.auth!;
    const { id } = idParams.parse(request.params);
    const body = z
      .object({ role: z.enum(['ADMIN', 'ANALYST', 'VIEWER']).optional(), active: z.boolean().optional() })
      .refine((value) => value.role !== undefined || value.active !== undefined, 'Nada a alterar.')
      .parse(request.body);

    const member = scope.get<{ role: Role; email: string }>(
      'SELECT role, email FROM users WHERE tenant_id = :tenantId AND id = :id',
      { id },
    );
    if (!member) throw notFound('Membro não encontrado.');
    if (id === user.id) throw badRequest('Você não pode alterar o próprio acesso.');
    if (member.role === 'OWNER') throw forbidden('O acesso do titular da conta não pode ser alterado.');

    if (body.role) scope.run('UPDATE users SET role = :role WHERE tenant_id = :tenantId AND id = :id', { role: body.role, id });
    if (body.active !== undefined) {
      scope.run('UPDATE users SET active = :active WHERE tenant_id = :tenantId AND id = :id', { active: body.active ? 1 : 0, id });
    }
    // Mudança de permissão vale imediatamente: as sessões abertas do membro são encerradas.
    revokeUserSessions(db, id);
    audit(request, 'MEMBRO_ALTERADO', member.email);
    return { ok: true };
  });

  app.get('/api/activity', { preHandler: atLeast('ADMIN') }, async (request) => ({
    entries: request.auth!.scope.all(
      'SELECT id, at, actor, action, target, ip FROM audit_log WHERE tenant_id = :tenantId ORDER BY at DESC LIMIT 100',
    ),
  }));
}
