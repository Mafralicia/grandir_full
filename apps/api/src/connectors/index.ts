import type { AuditInput } from '@grandir/engines';
import { demoConnector } from './demo';

export interface StoreRef {
  id: string;
  createdAt: string;
  marketplace: string;
  region: string;
  /** Credenciais já decifradas; `null` para conectores que não as exigem. */
  credentials: Record<string, string> | null;
}

/**
 * Contrato entre a Grandir e um marketplace. O conector traduz os relatórios do
 * operador (razão de estoque, remessas, remoções, tarifas, devoluções e
 * reembolsos) para o formato neutro que os motores de auditoria consomem.
 */
export interface MarketplaceConnector {
  id: string;
  label: string;
  fetchAuditInput(store: StoreRef, asOf: string): Promise<AuditInput>;
}

export const connectors: Record<string, MarketplaceConnector> = {
  [demoConnector.id]: demoConnector,
};

export const MARKETPLACES = ['amazon', 'mercadolivre', 'shopee', 'magalu'] as const;
export type Marketplace = (typeof MARKETPLACES)[number];
