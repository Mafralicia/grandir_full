import type { Config } from '../config';
import type { Db } from '../db';
import { logActivity } from '../auth/service';
import { TenantScope } from '../tenant';
import { runStoreAudit } from './audit';

/** Conectores que buscam dados sozinhos, pela API do marketplace. */
const LIVE_CONNECTORS = ['mercadolivre', 'shopee', 'tiktok'];

export interface SyncReport {
  stores: number;
  succeeded: number;
  failed: { storeId: string; reason: string }[];
}

/**
 * Auditoria contínua: percorre as lojas conectadas por API, renova o token de cada uma
 * e roda a auditoria. A falha de uma loja não interrompe as demais e fica registrada
 * na trilha de auditoria da conta dona da loja.
 */
export async function syncConnectedStores(db: Db, config: Config): Promise<SyncReport> {
  const stores = db
    .prepare(`SELECT id, tenant_id, name FROM stores WHERE connector IN (${LIVE_CONNECTORS.map(() => '?').join(', ')})`)
    .all(...LIVE_CONNECTORS) as { id: string; tenant_id: string; name: string }[];
  const report: SyncReport = { stores: stores.length, succeeded: 0, failed: [] };
  for (const store of stores) {
    try {
      await runStoreAudit(new TenantScope(db, store.tenant_id), config, store.id);
      report.succeeded += 1;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      report.failed.push({ storeId: store.id, reason });
      logActivity(db, { tenantId: store.tenant_id, actor: 'Sincronização automática', action: 'SINCRONIZACAO_FALHOU', target: `${store.name}: ${reason}`.slice(0, 300) });
    }
  }
  return report;
}

/** Agenda a sincronização periódica. Devolve a função que cancela o agendamento. */
export function startScheduler(db: Db, config: Config, log: (message: string) => void): () => void {
  if (config.syncIntervalHours <= 0) return () => undefined;
  let running = false;
  const tick = async () => {
    if (running) return; // Uma rodada demorada não se sobrepõe à seguinte.
    running = true;
    try {
      const report = await syncConnectedStores(db, config);
      if (report.stores > 0) log(`Sincronização automática: ${report.succeeded} de ${report.stores} lojas auditadas; ${report.failed.length} com falha.`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, config.syncIntervalHours * 3_600_000);
  timer.unref();
  return () => clearInterval(timer);
}
