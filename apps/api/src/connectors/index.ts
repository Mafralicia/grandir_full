import type { Discrepancy, ErpProduct, LogisticsIncident, MarketplaceOrder, Nfe, ReturnCase, SkuReconciliation, WarehouseReceipt } from '@grandir/engines';
import { AppError } from '../errors';
import { mercadoLivreImportConnector, shopeeImportConnector, tiktokImportConnector } from './br/importSource';
import type { IntegrationApps } from '../integrations/tokens';
import { mercadoLivreLiveConnector, shopeeLiveConnector, tiktokLiveConnector } from './br/liveSources';
import { mercadoLivreConnector } from './br/mercadolivre';
import { shopeeConnector } from './br/shopee';
import { demoConnector } from './demo';

export interface StoreRef {
  id: string;
  createdAt: string;
  marketplace: string;
  region: string;
  /** Credenciais já decifradas; `null` para conectores que não as exigem. */
  credentials: Record<string, string> | null;
  /** Cadastro de produtos importado do ERP do seller; prevalece sobre o do marketplace. */
  erpProducts: ErpProduct[];
  /** Notas fiscais importadas dos XMLs do seller. */
  invoices: Nfe[];
  /** Credenciais dos aplicativos registrados nos marketplaces (para assinar chamadas). */
  apps: IntegrationApps;
  /** Registros importados dos relatórios do seller. */
  imported: ImportedData;
}

export interface ImportedData {
  orders: MarketplaceOrder[];
  incidents: LogisticsIncident[];
  returns: ReturnCase[];
  receipts: WarehouseReceipt[];
}

export interface AuditOutcome {
  discrepancies: Discrepancy[];
  reconciliation: SkuReconciliation[];
  eventsScanned: number;
  pendingCount: number;
  expiredCount: number;
}

/**
 * Contrato entre a Grandir e um marketplace. O conector busca os dados do operador,
 * traduz para o modelo neutro e roda o motor de regras correspondente. O restante da
 * aplicação só enxerga o resultado: divergências e conciliação por SKU.
 */
export interface MarketplaceConnector {
  id: string;
  label: string;
  audit(store: StoreRef, asOf: string): Promise<AuditOutcome>;
}

export const connectors: Record<string, MarketplaceConnector> = Object.fromEntries(
  [demoConnector, mercadoLivreConnector, shopeeConnector, mercadoLivreLiveConnector, shopeeLiveConnector, tiktokLiveConnector, mercadoLivreImportConnector, shopeeImportConnector, tiktokImportConnector].map((connector) => [connector.id, connector]),
);

export const MARKETPLACES = ['amazon', 'mercadolivre', 'shopee', 'tiktok', 'magalu'] as const;
export type Marketplace = (typeof MARKETPLACES)[number];

/** Marketplaces que já têm motor de regras e entrada de dados reais. */
export const AVAILABLE_MARKETPLACES: readonly Marketplace[] = ['mercadolivre', 'shopee', 'tiktok'];

const DEMO_CONNECTOR: Record<Marketplace, string> = {
  amazon: demoConnector.id,
  magalu: demoConnector.id,
  mercadolivre: mercadoLivreConnector.id,
  shopee: shopeeConnector.id,
  // Não há gerador sintético para o TikTok Shop: mesmo em modo de teste a loja nasce vazia.
  tiktok: tiktokImportConnector.id,
};

/**
 * Conector com que uma loja nasce. Em uso real, a loja começa vazia e é alimentada por
 * arquivos importados até autorizar a conta por OAuth. Os geradores sintéticos só entram
 * com o modo de demonstração ligado.
 */
export function initialConnector(marketplace: Marketplace, demoMode: boolean): string {
  if (demoMode) return DEMO_CONNECTOR[marketplace];
  if (marketplace === 'mercadolivre') return mercadoLivreImportConnector.id;
  if (marketplace === 'shopee') return shopeeImportConnector.id;
  if (marketplace === 'tiktok') return tiktokImportConnector.id;
  throw new AppError(400, 'MARKETPLACE_EM_BREVE', 'Este marketplace ainda não está disponível. Por enquanto a Grandir audita Mercado Livre, Shopee e TikTok Shop.');
}

export const isDemoConnector = (connector: string): boolean => connector === demoConnector.id || connector.endsWith('-demo');
