import type { Discrepancy, ErpProduct, Nfe, SkuReconciliation } from '@grandir/engines';
import type { IntegrationApps } from '../integrations/tokens';
import { mercadoLivreLiveConnector, shopeeLiveConnector } from './br/liveSources';
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
  [demoConnector, mercadoLivreConnector, shopeeConnector, mercadoLivreLiveConnector, shopeeLiveConnector].map((connector) => [connector.id, connector]),
);

export const MARKETPLACES = ['amazon', 'mercadolivre', 'shopee', 'magalu'] as const;
export type Marketplace = (typeof MARKETPLACES)[number];

/** Conector inicial de cada marketplace: dados sintéticos, até a loja autorizar a conta real por OAuth. */
export const CONNECTOR_FOR: Record<Marketplace, string> = {
  amazon: demoConnector.id,
  magalu: demoConnector.id,
  mercadolivre: mercadoLivreConnector.id,
  shopee: shopeeConnector.id,
};
