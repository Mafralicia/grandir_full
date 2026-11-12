import {
  buildDossier,
  dossierCsv,
  groupForDossiers,
  type DiscrepancyType,
  type Dossier,
  type DossierGroup,
  type EvidenceItem,
  type FindingDetails,
} from '@grandir/engines';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { logActivity, ROLE_RANK } from '../auth/service';
import { nowIso, type Db } from '../db';
import { forbidden, notFound } from '../errors';
import { dossierPdf, dossierXlsx } from '../evidence-reporter/render';
import { CASE_STATUSES, createCase, getCase, nextCaseStatuses, transitionCase } from '../services/cases';
import type { TenantScope } from '../tenant';

interface Row {
  id: string;
  storeId: string;
  storeName: string;
  marketplace: string;
  type: DiscrepancyType;
  sku: string;
  productName: string;
  quantity: number;
  recoverableCents: number;
  occurredAt: string;
  deadlineAt: string | null;
  referenceId: string;
  evidenceJson: string;
  detailsJson: string | null;
}

const EVIDENCE_SQL = `
  SELECT d.id, d.store_id AS storeId, s.name AS storeName, s.marketplace, d.type, d.sku, d.product_name AS productName,
         d.quantity, d.estimated_value_cents AS recoverableCents, d.occurred_at AS occurredAt, d.expires_at AS deadlineAt,
         d.reference_id AS referenceId, d.evidence_json AS evidenceJson, d.details_json AS detailsJson
    FROM discrepancies d JOIN stores s ON s.id = d.store_id AND s.tenant_id = d.tenant_id`;

const toEvidence = ({ evidenceJson, detailsJson, ...row }: Row): EvidenceItem => ({
  ...row,
  evidence: JSON.parse(evidenceJson) as string[],
  details: detailsJson ? (JSON.parse(detailsJson) as FindingDetails) : null,
});

/** Divergências em aberto do tenant: as que ainda podem entrar em um chamado. */
const openEvidence = (scope: TenantScope): EvidenceItem[] =>
  scope.all<Row>(`${EVIDENCE_SQL} WHERE d.tenant_id = :tenantId AND d.status = 'OPEN'`).map(toEvidence);

/** O dossiê de um chamado já criado: as divergências vinculadas, seja qual for a situação delas. */
function caseDossier(scope: TenantScope, caseId: string): Dossier {
  const row = getCase(scope, caseId);
  const items = scope
    .all<Row>(
      `${EVIDENCE_SQL} JOIN claims c ON c.discrepancy_id = d.id AND c.tenant_id = d.tenant_id
        WHERE d.tenant_id = :tenantId AND c.case_id = :caseId ORDER BY d.estimated_value_cents DESC`,
      { caseId },
    )
    .map(toEvidence);
  const deadlines = items.map((i) => i.deadlineAt).filter((d): d is string => d !== null).sort();
  const group: DossierGroup = {
    key: caseId,
    storeId: row.store_id,
    storeName: items[0]?.storeName ?? '',
    marketplace: items[0]?.marketplace ?? '',
    type: row.type as DiscrepancyType,
    bucketLabel: row.bucket_label,
    items,
    totalCents: row.claimed_cents,
    earliestDeadline: deadlines[0] ?? null,
  };
  const company = scope.get<{ name: string }>('SELECT name FROM tenants WHERE id = :tenantId')!.name;
  return buildDossier(group, company, nowIso());
}

const FORMATS = {
  txt: { type: 'text/plain; charset=utf-8', extension: 'txt' },
  csv: { type: 'text/csv; charset=utf-8', extension: 'csv' },
  pdf: { type: 'application/pdf', extension: 'pdf' },
  xlsx: { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: 'xlsx' },
} as const;
const formatQuery = z.object({ format: z.enum(['json', 'txt', 'csv', 'pdf', 'xlsx']).default('json') });
const idParams = z.object({ id: z.string().uuid() });

export async function dossierRoutes(
  app: FastifyInstance,
  deps: { db: Db; requireAuth: (request: FastifyRequest) => Promise<void> },
): Promise<void> {
  const { db, requireAuth } = deps;
  const analyst = [
    requireAuth,
    async (request: FastifyRequest) => {
      if (ROLE_RANK[request.auth!.user.role] < ROLE_RANK.ANALYST) throw forbidden();
    },
  ];
  const actor = (request: FastifyRequest) => `${request.auth!.user.firstName} ${request.auth!.user.lastName}`;
  const audit = (request: FastifyRequest, action: string, target: string) => {
    const { user } = request.auth!;
    logActivity(db, { tenantId: user.tenantId, userId: user.id, actor: user.email, action, target, ip: request.ip });
  };

  async function send(request: FastifyRequest, reply: FastifyReply, dossier: Dossier, format: keyof typeof FORMATS, name: string) {
    audit(request, 'DOSSIE_EXPORTADO', `${dossier.typeLabel} · ${format}`);
    const body =
      format === 'txt' ? dossier.ticketText
      : format === 'csv' ? dossierCsv(dossier)
      : format === 'pdf' ? await dossierPdf(dossier)
      : dossierXlsx(dossier);
    const filename = `dossie-${name}.${FORMATS[format].extension}`.toLowerCase().replace(/[^a-z0-9._-]/g, '-');
    return reply.header('Content-Disposition', `attachment; filename="${filename}"`).type(FORMATS[format].type).send(body);
  }

  // ───────────── Agrupamentos de divergências em aberto ─────────────

  app.get('/api/dossiers', { preHandler: requireAuth }, async (request) => ({
    groups: groupForDossiers(openEvidence(request.auth!.scope)).map(({ items, ...group }) => ({ ...group, count: items.length })),
  }));

  app.get('/api/dossiers/:key', { preHandler: requireAuth }, async (request, reply) => {
    const { scope } = request.auth!;
    const { key } = z.object({ key: z.string().min(3).max(300) }).parse(request.params);
    const { format } = formatQuery.parse(request.query);
    const group = groupForDossiers(openEvidence(scope)).find((candidate) => candidate.key === key);
    if (!group) throw notFound('Dossiê não encontrado. As divergências podem já ter sido tratadas.');
    const company = scope.get<{ name: string }>('SELECT name FROM tenants WHERE id = :tenantId')!.name;
    const dossier = buildDossier(group, company, nowIso());
    if (format === 'json') return { dossier };
    return send(request, reply, dossier, format, `${group.type}-${group.key.split('~')[2]}`);
  });

  // Transforma o agrupamento em um chamado: a partir daqui o status do chamado governa o grupo.
  app.post('/api/dossiers/:key/case', { preHandler: analyst }, async (request, reply) => {
    const { scope } = request.auth!;
    const { key } = z.object({ key: z.string().min(3).max(300) }).parse(request.params);
    const group = groupForDossiers(openEvidence(scope)).find((candidate) => candidate.key === key);
    if (!group) throw notFound('Dossiê não encontrado. As divergências podem já ter sido tratadas.');
    const created = scope.transaction(() => createCase(scope, group, actor(request)));
    audit(request, 'CHAMADO_DE_DOSSIE_CRIADO', created.code);
    reply.status(201);
    return { id: created.id, code: created.code };
  });

  // ───────────── Chamados de dossiê ─────────────

  app.get('/api/cases', { preHandler: requireAuth }, async (request) => ({
    cases: request.auth!.scope.all(
      `SELECT k.id, k.code, k.type, k.bucket_label AS bucketLabel, k.status, k.protocol, k.opened_at AS openedAt,
              k.claimed_cents AS claimedCents, k.approved_cents AS approvedCents, k.refunded_cents AS refundedCents,
              k.updated_at AS updatedAt, s.name AS storeName, s.marketplace,
              (SELECT COUNT(*) FROM claims c WHERE c.case_id = k.id AND c.tenant_id = k.tenant_id) AS itemCount
         FROM dossier_cases k JOIN stores s ON s.id = k.store_id AND s.tenant_id = k.tenant_id
        WHERE k.tenant_id = :tenantId ORDER BY k.updated_at DESC LIMIT 300`,
    ),
  }));

  app.get('/api/cases/:id', { preHandler: requireAuth }, async (request) => {
    const { scope } = request.auth!;
    const { id } = idParams.parse(request.params);
    const row = getCase(scope, id);
    const dossier = caseDossier(scope, id);
    return {
      case: {
        id: row.id, code: row.code, type: row.type, bucketLabel: row.bucket_label, status: row.status, protocol: row.protocol,
        openedAt: row.opened_at, claimedCents: row.claimed_cents, approvedCents: row.approved_cents, refundedCents: row.refunded_cents,
        storeName: dossier.storeName, marketplace: dossier.marketplace, nextStatuses: nextCaseStatuses(row.status),
        earliestDeadline: dossier.earliestDeadline,
      },
      items: scope.all(
        `SELECT c.id AS claimId, c.code AS claimCode, c.discrepancy_id AS discrepancyId, c.status, c.claimed_cents AS claimedCents,
                c.approved_cents AS approvedCents, d.sku, d.product_name AS productName, d.quantity, d.reference_id AS referenceId
           FROM claims c JOIN discrepancies d ON d.id = c.discrepancy_id AND d.tenant_id = c.tenant_id
          WHERE c.tenant_id = :tenantId AND c.case_id = :id ORDER BY c.claimed_cents DESC`,
        { id },
      ),
      events: scope.all(
        `SELECT id, at, actor, from_status AS fromStatus, to_status AS toStatus, note
           FROM case_events WHERE tenant_id = :tenantId AND case_id = :id ORDER BY at DESC, rowid DESC`,
        { id },
      ),
      ticket: { subject: dossier.subject, text: dossier.ticketText, warnings: dossier.warnings },
    };
  });

  app.get('/api/cases/:id/export', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const { format } = z.object({ format: z.enum(['txt', 'csv', 'pdf', 'xlsx']) }).parse(request.query);
    const { scope } = request.auth!;
    return send(request, reply, caseDossier(scope, id), format, getCase(scope, id).code);
  });

  app.post('/api/cases/:id/transition', { preHandler: analyst }, async (request) => {
    const { scope } = request.auth!;
    const { id } = idParams.parse(request.params);
    const body = z
      .object({
        to: z.enum(CASE_STATUSES),
        protocol: z.string().trim().max(60).optional(),
        note: z.string().trim().max(1000).optional(),
        items: z.array(z.object({ discrepancyId: z.string().uuid(), approvedCents: z.number().int().min(0) })).max(500).optional(),
      })
      .parse(request.body);
    const updated = scope.transaction(() =>
      transitionCase(scope, id, body.to, { actor: actor(request), protocol: body.protocol, note: body.note || undefined, items: body.items }),
    );
    audit(request, `CHAMADO_DE_DOSSIE_${body.to}`, updated.code);
    return { status: updated.status, approvedCents: updated.approved_cents, refundedCents: updated.refunded_cents };
  });
}
