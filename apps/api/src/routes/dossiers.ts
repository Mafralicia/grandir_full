import { buildDossier, dossierCsv, groupForDossiers, type DiscrepancyType, type EvidenceItem, type FindingDetails } from '@grandir/engines';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { logActivity } from '../auth/service';
import { nowIso, type Db } from '../db';
import { notFound } from '../errors';
import { dossierPdf, dossierXlsx } from '../evidence-reporter/render';
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

/** Divergências em aberto do tenant, já no formato do gerador de dossiês. */
function openEvidence(scope: TenantScope): EvidenceItem[] {
  return scope
    .all<Row>(
      `SELECT d.id, d.store_id AS storeId, s.name AS storeName, s.marketplace, d.type, d.sku, d.product_name AS productName,
              d.quantity, d.estimated_value_cents AS recoverableCents, d.occurred_at AS occurredAt, d.expires_at AS deadlineAt,
              d.reference_id AS referenceId, d.evidence_json AS evidenceJson, d.details_json AS detailsJson
         FROM discrepancies d JOIN stores s ON s.id = d.store_id AND s.tenant_id = d.tenant_id
        WHERE d.tenant_id = :tenantId AND d.status = 'OPEN'`,
    )
    .map(({ evidenceJson, detailsJson, ...row }) => ({
      ...row,
      evidence: JSON.parse(evidenceJson) as string[],
      details: detailsJson ? (JSON.parse(detailsJson) as FindingDetails) : null,
    }));
}

const FORMATS = {
  txt: { type: 'text/plain; charset=utf-8', extension: 'txt' },
  csv: { type: 'text/csv; charset=utf-8', extension: 'csv' },
  pdf: { type: 'application/pdf', extension: 'pdf' },
  xlsx: { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: 'xlsx' },
} as const;

export async function dossierRoutes(
  app: FastifyInstance,
  deps: { db: Db; requireAuth: (request: FastifyRequest) => Promise<void> },
): Promise<void> {
  const { db, requireAuth } = deps;

  // Agrupamentos prontos para virar chamado: um por loja, tipo e lote ou mês.
  app.get('/api/dossiers', { preHandler: requireAuth }, async (request) => ({
    groups: groupForDossiers(openEvidence(request.auth!.scope)).map(({ items, ...group }) => ({ ...group, count: items.length })),
  }));

  app.get('/api/dossiers/:key', { preHandler: requireAuth }, async (request, reply) => {
    const { scope, user } = request.auth!;
    const { key } = z.object({ key: z.string().min(3).max(300) }).parse(request.params);
    const { format } = z.object({ format: z.enum(['json', 'txt', 'csv', 'pdf', 'xlsx']).default('json') }).parse(request.query);

    const group = groupForDossiers(openEvidence(scope)).find((candidate) => candidate.key === key);
    if (!group) throw notFound('Dossiê não encontrado. As divergências podem já ter sido tratadas.');
    const company = scope.get<{ name: string }>('SELECT name FROM tenants WHERE id = :tenantId')!.name;
    const dossier = buildDossier(group, company, nowIso());
    if (format === 'json') return { dossier };

    logActivity(db, { tenantId: user.tenantId, userId: user.id, actor: user.email, action: 'DOSSIE_EXPORTADO', target: `${dossier.typeLabel} · ${format}`, ip: request.ip });
    const body =
      format === 'txt' ? dossier.ticketText
      : format === 'csv' ? dossierCsv(dossier)
      : format === 'pdf' ? await dossierPdf(dossier)
      : dossierXlsx(dossier);
    const filename = `dossie-${group.type.toLowerCase()}-${group.key.split('~')[2]}.${FORMATS[format].extension}`.replace(/[^a-z0-9._-]/gi, '-');
    return reply.header('Content-Disposition', `attachment; filename="${filename}"`).type(FORMATS[format].type).send(body);
  });
}
