import { randomUUID } from 'node:crypto';
import { BALANCE_REFERENCE_PREFIX, type ErpProduct } from '@grandir/engines';
import type { Config } from '../config';
import { connectors } from '../connectors/index';
import { nowIso } from '../db';
import { badRequest, notFound } from '../errors';
import { decrypt } from '../security/crypto';
import type { TenantScope } from '../tenant';

interface StoreRow {
  id: string;
  marketplace: string;
  region: string;
  connector: string;
  credentials_enc: string | null;
  created_at: string;
}

export interface AuditRunSummary {
  id: string;
  eventsScanned: number;
  discrepanciesFound: number;
  newDiscrepancies: number;
  valueFoundCents: number;
  pendingCount: number;
  expiredCount: number;
}

/**
 * Busca os dados da loja no conector, roda os motores e grava o resultado.
 * A gravação é idempotente: divergências já conhecidas são atualizadas enquanto
 * estiverem em aberto, e nunca duplicadas.
 */
export async function runStoreAudit(scope: TenantScope, config: Config, storeId: string): Promise<AuditRunSummary> {
  const store = scope.get<StoreRow>('SELECT * FROM stores WHERE tenant_id = :tenantId AND id = :storeId', { storeId });
  if (!store) throw notFound('Loja não encontrada.');
  const connector = connectors[store.connector];
  if (!connector) throw badRequest('O conector desta loja não está disponível neste ambiente.');

  const startedAt = nowIso();
  const erpProducts = scope
    .all<{ product_json: string }>('SELECT product_json FROM erp_products WHERE tenant_id = :tenantId AND store_id = :storeId', { storeId })
    .map((row) => JSON.parse(row.product_json) as ErpProduct);
  const result = await connector.audit(
    {
      erpProducts,
      id: store.id,
      createdAt: store.created_at,
      marketplace: store.marketplace,
      region: store.region,
      credentials: store.credentials_enc ? JSON.parse(decrypt(store.credentials_enc, config.encryptionKey)) : null,
    },
    startedAt,
  );

  return scope.transaction(() => {
    const known = new Map(
      scope
        .all<{ id: string; fingerprint: string; status: string; sku: string; reference_id: string }>(
          'SELECT id, fingerprint, status, sku, reference_id FROM discrepancies WHERE tenant_id = :tenantId AND store_id = :storeId',
          { storeId },
        )
        .map((row) => [row.fingerprint, row]),
    );
    // Uma variação de saldo ainda não resolvida cobre o SKU: o mês seguinte não abre outra.
    const unresolvedBalanceSkus = new Set(
      [...known.values()]
        .filter((row) => row.reference_id.startsWith(BALANCE_REFERENCE_PREFIX) && (row.status === 'OPEN' || row.status === 'CLAIMED'))
        .map((row) => row.sku),
    );

    let newDiscrepancies = 0;
    const seen = new Set<string>();
    for (const d of result.discrepancies) {
      seen.add(d.fingerprint);
      const existing = known.get(d.fingerprint);
      const values = {
        quantity: d.quantity,
        value: d.estimatedValueCents,
        evidence: JSON.stringify(d.evidence),
        details: d.details ? JSON.stringify(d.details) : null,
      };
      if (existing) {
        if (existing.status === 'OPEN') {
          scope.run(
            `UPDATE discrepancies SET quantity = :quantity, estimated_value_cents = :value, evidence_json = :evidence, details_json = :details
              WHERE tenant_id = :tenantId AND id = :id`,
            { ...values, id: existing.id },
          );
        }
        continue;
      }
      if (d.referenceId.startsWith(BALANCE_REFERENCE_PREFIX) && unresolvedBalanceSkus.has(d.sku)) continue;
      scope.run(
        `INSERT INTO discrepancies (id, tenant_id, store_id, fingerprint, type, sku, product_name, quantity,
                                    estimated_value_cents, reference_id, evidence_json, details_json, occurred_at, detected_at, expires_at)
         VALUES (:id, :tenantId, :storeId, :fingerprint, :type, :sku, :productName, :quantity,
                 :value, :referenceId, :evidence, :details, :occurredAt, :detectedAt, :expiresAt)`,
        {
          ...values,
          id: randomUUID(),
          storeId,
          fingerprint: d.fingerprint,
          type: d.type,
          sku: d.sku,
          productName: d.productName,
          referenceId: d.referenceId,
          occurredAt: d.occurredAt,
          detectedAt: startedAt,
          expiresAt: d.expiresAt,
        },
      );
      newDiscrepancies += 1;
    }

    // Divergência em aberto que deixou de aparecer foi compensada na origem (item localizado ou reembolsado).
    for (const row of known.values()) {
      if (row.status !== 'OPEN' || seen.has(row.fingerprint)) continue;
      if (row.reference_id.startsWith(BALANCE_REFERENCE_PREFIX)) continue;
      scope.run("UPDATE discrepancies SET status = 'RESOLVED' WHERE tenant_id = :tenantId AND id = :id", { id: row.id });
    }

    scope.run('DELETE FROM sku_reconciliation WHERE tenant_id = :tenantId AND store_id = :storeId', { storeId });
    for (const row of result.reconciliation) {
      scope.run(
        `INSERT INTO sku_reconciliation (id, tenant_id, store_id, sku, product_name, opening, inbound, outbound, adjustments,
                                         expected_ending, reported_ending, variance, variance_value_cents)
         VALUES (:id, :tenantId, :storeId, :sku, :productName, :opening, :inbound, :outbound, :adjustments,
                 :expectedEnding, :reportedEnding, :variance, :varianceValueCents)`,
        { id: randomUUID(), storeId, ...row },
      );
    }

    const summary: AuditRunSummary = {
      id: randomUUID(),
      eventsScanned: result.eventsScanned,
      discrepanciesFound: result.discrepancies.length,
      newDiscrepancies,
      valueFoundCents: result.discrepancies.reduce((sum, d) => sum + d.estimatedValueCents, 0),
      pendingCount: result.pendingCount,
      expiredCount: result.expiredCount,
    };
    const finishedAt = nowIso();
    scope.run(
      `INSERT INTO audit_runs (id, tenant_id, store_id, started_at, finished_at, events_scanned, discrepancies_found,
                               new_discrepancies, value_found_cents, pending_count, expired_count)
       VALUES (:id, :tenantId, :storeId, :startedAt, :finishedAt, :eventsScanned, :discrepanciesFound,
               :newDiscrepancies, :valueFoundCents, :pendingCount, :expiredCount)`,
      { ...summary, storeId, startedAt, finishedAt },
    );
    scope.run('UPDATE stores SET last_audit_at = :finishedAt WHERE tenant_id = :tenantId AND id = :storeId', {
      finishedAt,
      storeId,
    });
    return summary;
  });
}
