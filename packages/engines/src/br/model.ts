import type { Cents } from '../types';

/**
 * Modelo neutro do e-commerce brasileiro. Os conectores (Mercado Livre, Shopee, ERPs)
 * traduzem seus relatórios para estas estruturas; o motor de regras só conhece este formato.
 */
export type BrMarketplace = 'mercadolivre' | 'shopee' | 'tiktok';

/** Cadastro do produto no ERP: é a fonte de verdade para custo, peso e medidas. */
export interface ErpProduct {
  sku: string;
  ean: string;
  name: string;
  costCents: Cents;
  weightG: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
}

export interface MarketplaceOrder {
  marketplace: BrMarketplace;
  orderId: string;
  shipmentId: string;
  trackingCode: string;
  /** MLB no Mercado Livre, Item ID na Shopee. */
  itemId: string;
  sku: string;
  quantity: number;
  saleDate: string;
  grossCents: Cents;
  categoryId: string;
  /** Tipo de anúncio no Mercado Livre; ignorado na Shopee. */
  listingType: 'classico' | 'premium';
  commissionCents: Cents;
  /** Tarifa fixa por unidade (ML) ou taxa de transação (Shopee). */
  feeCents: Cents;
  /** Frete debitado do seller. */
  shippingChargedCents: Cents;
  /** Peso que a transportadora ou o marketplace usou na cobrança. */
  billedWeightG: number;
  /** Valor líquido efetivamente creditado; `null` enquanto não liquidado. */
  settledCents: Cents | null;
  settledAt: string | null;
}

export type IncidentKind = 'WAREHOUSE_LOSS' | 'WAREHOUSE_DAMAGE' | 'TRANSIT_LOSS' | 'REVERSE_LOSS';

/** Extravio ou avaria reconhecido pelo operador logístico. */
export interface LogisticsIncident {
  id: string;
  marketplace: BrMarketplace;
  kind: IncidentKind;
  sku: string;
  quantity: number;
  occurredAt: string;
  orderId?: string;
  shipmentId?: string;
  inboundId?: string;
  /** Indenização já creditada. */
  compensatedCents: Cents;
}

/** Devolução ou mediação encerrada. */
export interface ReturnCase {
  id: string;
  marketplace: BrMarketplace;
  orderId: string;
  sku: string;
  quantity: number;
  closedAt: string;
  resolution: 'BUYER' | 'SELLER';
  refundedToBuyerCents: Cents;
  returnedToStock: boolean;
  returnedCondition: 'OK' | 'DAMAGED' | null;
  compensatedCents: Cents;
}

export type NfeKind = 'ENTRADA' | 'REMESSA' | 'RETORNO' | 'VENDA' | 'DEVOLUCAO';

export interface Nfe {
  /** Chave de acesso de 44 dígitos. */
  accessKey: string;
  kind: NfeKind;
  issuedAt: string;
  sku: string;
  quantity: number;
  totalCents: Cents;
  orderId?: string;
  /** Lote de envio ao centro de distribuição (remessa para armazém). */
  inboundId?: string;
}

/** Conferência de recebimento do lote no centro de distribuição. */
export interface WarehouseReceipt {
  inboundId: string;
  sku: string;
  receivedQty: number;
  receivedAt: string;
}

export interface BrAuditInput {
  asOf: string;
  marketplace: BrMarketplace;
  products: ErpProduct[];
  orders: MarketplaceOrder[];
  incidents: LogisticsIncident[];
  returns: ReturnCase[];
  invoices: Nfe[];
  receipts: WarehouseReceipt[];
  /** Saldo que o marketplace informa por SKU no centro de distribuição. */
  marketplaceStock: Record<string, number>;
}

export const BR_RULES = [
  'ML_WAREHOUSE_LOSS',
  'ML_WAREHOUSE_DAMAGE',
  'ML_TRANSIT_LOSS',
  'ML_FREIGHT_OVERCHARGE',
  'ML_RETURN_NOT_RESTOCKED',
  'ML_RETURN_DAMAGED',
  'ML_COMMISSION_OVERCHARGE',
  'SHOPEE_LOST_NO_CREDIT',
  'SHOPEE_PAYOUT_SHORTFALL',
  'SHOPEE_FREIGHT_OVERCHARGE',
  'SHOPEE_RETURN_NOT_RESTOCKED',
  'SHOPEE_RETURN_DAMAGED',
  'TIKTOK_LOST_NO_CREDIT',
  'TIKTOK_PAYOUT_SHORTFALL',
  'TIKTOK_RETURN_NOT_RESTOCKED',
  'TIKTOK_RETURN_DAMAGED',
  'ERP_INBOUND_GAP',
  'ERP_UNSETTLED_SALE',
] as const;
export type BrRule = (typeof BR_RULES)[number];

/** Identificadores que o suporte do marketplace pede para localizar o caso. */
export interface FindingIds {
  orderId?: string;
  shipmentId?: string;
  trackingCode?: string;
  itemId?: string;
  ean?: string;
  nfeKey?: string;
  inboundId?: string;
}

/** Parte probatória de uma divergência: tudo o que entra no dossiê. */
export interface FindingDetails {
  marketplace: BrMarketplace;
  ids: FindingIds;
  expectedCents: Cents;
  actualCents: Cents;
  /** Rótulos dos dois valores: ["Valor devido", "Valor creditado"] ou ["Valor cobrado", "Valor correto"]. */
  amountLabels: [string, string];
  /** Versão da tabela de tarifas aplicada (a vigente na data da venda) e se ela foi conferida na fonte oficial. */
  tariff?: { id: string; verified: boolean };
  /** Regra ou política do marketplace em que o pedido de reembolso se apoia. */
  policy: string;
  /** Memória de cálculo, uma linha por passo. */
  calc: string[];
  /** Trilha cronológica dos eventos relevantes. */
  timeline: { at: string; label: string }[];
}

export interface Finding {
  fingerprint: string;
  rule: BrRule;
  sku: string;
  productName: string;
  quantity: number;
  recoverableCents: Cents;
  occurredAt: string;
  deadlineAt: string;
  details: FindingDetails;
}
