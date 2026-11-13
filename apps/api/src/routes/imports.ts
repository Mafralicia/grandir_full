import type { BrMarketplace } from '@grandir/engines';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { logActivity, ROLE_RANK } from '../auth/service';
import type { Config } from '../config';
import { nowIso, type Db } from '../db';
import { badRequest, forbidden, notFound } from '../errors';
import { IMPORT_KINDS, KIND_SPECS, mapRows, suggestMapping, type ImportKind } from '../imports/schema';
import { readTable } from '../imports/tabular';
import { runStoreAudit } from '../services/audit';
import type { TenantScope } from '../tenant';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const params = z.object({ id: z.string().uuid(), kind: z.enum(IMPORT_KINDS) });
const fileQuery = z.object({ filename: z.string().min(1).max(200) });

interface StoreRow {
  id: string;
  name: string;
  marketplace: string;
  connector: string;
  lastAuditAt: string | null;
}

function storeOf(scope: TenantScope, id: string): StoreRow {
  const store = scope.get<StoreRow>(
    'SELECT id, name, marketplace, connector, last_audit_at AS lastAuditAt FROM stores WHERE tenant_id = :tenantId AND id = :id',
    { id },
  );
  if (!store) throw notFound('Loja não encontrada.');
  if (store.marketplace !== 'mercadolivre' && store.marketplace !== 'shopee') {
    throw badRequest('A importação de relatórios está disponível para lojas do Mercado Livre e da Shopee.');
  }
  return store;
}

function fileBody(request: FastifyRequest): Buffer {
  if (!Buffer.isBuffer(request.body) || request.body.length === 0) throw badRequest('Envie o arquivo no corpo da requisição.');
  return request.body;
}

/**
 * Entrada de dados reais por arquivo. O seller envia o relatório que o painel dele
 * exporta (CSV ou XLSX), confere o mapeamento de colunas e a auditoria roda sobre
 * esses dados. O mapeamento fica salvo por loja e tipo para a próxima importação.
 */
export async function importRoutes(
  app: FastifyInstance,
  deps: { db: Db; config: Config; requireAuth: (request: FastifyRequest) => Promise<void> },
): Promise<void> {
  const { db, config, requireAuth } = deps;
  const admin = [
    requireAuth,
    async (request: FastifyRequest) => {
      if (ROLE_RANK[request.auth!.user.role] < ROLE_RANK.ADMIN) throw forbidden();
    },
  ];

  app.get('/api/stores/:id/imports', { preHandler: requireAuth }, async (request) => {
    const { scope } = request.auth!;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const store = storeOf(scope, id);
    const counts = new Map(
      scope
        .all<{ kind: string; total: number; last: string }>(
          'SELECT kind, COUNT(*) AS total, MAX(imported_at) AS last FROM imported_records WHERE tenant_id = :tenantId AND store_id = :id GROUP BY kind',
          { id },
        )
        .map((row) => [row.kind, row]),
    );
    const mappings = new Map(
      scope
        .all<{ kind: string; mapping_json: string }>('SELECT kind, mapping_json FROM import_mappings WHERE tenant_id = :tenantId AND store_id = :id', { id })
        .map((row) => [row.kind, JSON.parse(row.mapping_json) as Record<string, string>]),
    );
    const count = (table: string) => scope.get<{ total: number }>(`SELECT COUNT(*) AS total FROM ${table} WHERE tenant_id = :tenantId AND store_id = :id`, { id })!.total;
    return {
      store,
      kinds: IMPORT_KINDS.map((kind) => ({
        kind,
        label: KIND_SPECS[kind].label,
        description: KIND_SPECS[kind].description,
        fields: KIND_SPECS[kind].fields.map(({ key, label, required, hint }) => ({ key, label, required, hint })),
        rowCount: counts.get(kind)?.total ?? 0,
        lastImportedAt: counts.get(kind)?.last ?? null,
        mapping: mappings.get(kind) ?? null,
      })),
      erpProductCount: count('erp_products'),
      nfeCount: count('nfe_documents'),
    };
  });

  // Lê o arquivo e devolve cabeçalhos, amostra e sugestão de mapeamento. Nada é gravado.
  app.post('/api/stores/:id/imports/:kind/preview', { preHandler: admin, bodyLimit: MAX_FILE_BYTES }, async (request) => {
    const { id, kind } = params.parse(request.params);
    const { filename } = fileQuery.parse(request.query);
    storeOf(request.auth!.scope, id);
    const table = readTable(fileBody(request), filename);
    return {
      headers: table.headers.filter(Boolean),
      sample: table.rows.slice(0, 5).map((row) => row.filter((_, index) => table.headers[index])),
      suggested: suggestMapping(kind, table.headers),
      totalRows: table.rows.length,
    };
  });

  app.put('/api/stores/:id/imports/:kind', { preHandler: admin, bodyLimit: MAX_FILE_BYTES }, async (request) => {
    const { scope, user } = request.auth!;
    const { id, kind } = params.parse(request.params);
    const query = fileQuery.extend({ mapping: z.string().min(2).max(4000) }).parse(request.query);
    const store = storeOf(scope, id);

    let mapping: Record<string, string>;
    try {
      mapping = z.record(z.string().max(60), z.string().max(200)).parse(JSON.parse(query.mapping));
    } catch {
      throw badRequest('Mapeamento de colunas inválido.');
    }
    const table = readTable(fileBody(request), query.filename);
    const mapped = mapRows(kind as ImportKind, table, mapping, store.marketplace as BrMarketplace);
    if (mapped.records.length === 0) throw badRequest(mapped.errors[0]?.reason ?? 'Nenhuma linha válida no arquivo.');

    const importedAt = nowIso();
    let imported = 0;
    let updated = 0;
    scope.transaction(() => {
      const existing = new Set(
        scope
          .all<{ record_key: string }>('SELECT record_key FROM imported_records WHERE tenant_id = :tenantId AND store_id = :id AND kind = :kind', { id, kind })
          .map((row) => row.record_key),
      );
      for (const { key, record } of mapped.records) {
        scope.run(
          `INSERT INTO imported_records (tenant_id, store_id, kind, record_key, record_json, imported_at)
           VALUES (:tenantId, :id, :kind, :key, :json, :importedAt)
           ON CONFLICT (tenant_id, store_id, kind, record_key) DO UPDATE SET record_json = :json, imported_at = :importedAt`,
          { id, kind, key, json: JSON.stringify(record), importedAt },
        );
        if (existing.has(key)) updated += 1;
        else { imported += 1; existing.add(key); }
      }
      scope.run(
        `INSERT INTO import_mappings (tenant_id, store_id, kind, mapping_json) VALUES (:tenantId, :id, :kind, :json)
         ON CONFLICT (tenant_id, store_id, kind) DO UPDATE SET mapping_json = :json`,
        { id, kind, json: JSON.stringify(mapping) },
      );
      scope.run("UPDATE stores SET status = 'CONNECTED' WHERE tenant_id = :tenantId AND id = :id", { id });
    });

    const audit = await runStoreAudit(scope, config, id);
    logActivity(db, { tenantId: user.tenantId, userId: user.id, actor: user.email, action: 'RELATORIO_IMPORTADO', target: `${KIND_SPECS[kind as ImportKind].label}: ${imported + updated} linhas`, ip: request.ip });
    return { imported, updated, errors: mapped.errors.slice(0, 50), audit };
  });
}
