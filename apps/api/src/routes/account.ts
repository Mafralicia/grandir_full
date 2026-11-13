import type { FastifyInstance, FastifyRequest } from 'fastify';
import { logActivity, ROLE_RANK } from '../auth/service';
import { nowIso, type Db } from '../db';
import { forbidden } from '../errors';

/** Tabelas de negócio do tenant e as colunas que NÃO saem na exportação (segredos). */
const EXPORT_TABLES: [string, string[]][] = [
  ['stores', ['credentials_enc']],
  ['users', ['password_hash', 'mfa_secret_enc', 'mfa_last_step', 'failed_attempts', 'locked_until']],
  ['erp_products', []],
  ['nfe_documents', []],
  ['imported_records', []],
  ['import_mappings', []],
  ['audit_runs', []],
  ['sku_reconciliation', []],
  ['discrepancies', []],
  ['dossier_cases', []],
  ['case_events', []],
  ['claims', []],
  ['claim_events', []],
  ['documents', []],
  ['invoices', []],
  ['invoice_lines', []],
  ['audit_log', []],
];

/**
 * Portabilidade de dados (LGPD, art. 18): o titular da conta baixa tudo o que a Grandir
 * guarda sobre a empresa em um único arquivo JSON. Senhas, segredos de 2FA e tokens de
 * marketplace nunca são incluídos.
 */
export async function accountRoutes(
  app: FastifyInstance,
  deps: { db: Db; requireAuth: (request: FastifyRequest) => Promise<void> },
): Promise<void> {
  const { db, requireAuth } = deps;

  app.get('/api/account/export', { preHandler: requireAuth }, async (request, reply) => {
    const { scope, user } = request.auth!;
    if (ROLE_RANK[user.role] < ROLE_RANK.OWNER) throw forbidden('Só o titular da conta pode exportar os dados.');

    const data: Record<string, unknown[]> = {};
    for (const [table, secrets] of EXPORT_TABLES) {
      data[table] = scope.all<Record<string, unknown>>(`SELECT * FROM ${table} WHERE tenant_id = :tenantId`).map((row) => {
        const copy = { ...row };
        for (const column of secrets) delete copy[column];
        delete copy.tenant_id;
        return copy;
      });
    }
    const tenant = scope.get('SELECT name, country, is_agency, revenue_band, currency, fee_rate_bps, created_at FROM tenants WHERE id = :tenantId');
    logActivity(db, { tenantId: user.tenantId, userId: user.id, actor: user.email, action: 'DADOS_EXPORTADOS', ip: request.ip });
    return reply
      .header('Content-Disposition', `attachment; filename="grandir-dados-${nowIso().slice(0, 10)}.json"`)
      .type('application/json; charset=utf-8')
      .send(JSON.stringify({ exportedAt: nowIso(), exportedBy: user.email, tenant, ...data }, null, 2));
  });
}
