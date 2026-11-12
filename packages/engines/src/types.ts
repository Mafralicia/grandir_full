/** Valores monetários são sempre inteiros em centavos — nunca ponto flutuante. */
export type Cents = number;

export const DISCREPANCY_TYPES = [
  'LOST_WAREHOUSE',
  'DAMAGED_WAREHOUSE',
  'DISPOSED_SELLABLE',
  'TRANSFER_LOST',
  'INBOUND_SHORTAGE',
  'REMOVAL_NOT_RECEIVED',
  'FEE_OVERCHARGE',
  'RETURN_NOT_RECEIVED',
] as const;
export type DiscrepancyType = (typeof DISCREPANCY_TYPES)[number];

export interface CatalogItem {
  sku: string;
  name: string;
  unitCostCents: Cents;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightG: number;
}

export type LedgerEventType =
  | 'RECEIPT'
  | 'SHIPMENT'
  | 'CUSTOMER_RETURN'
  | 'ADJUSTMENT_LOST'
  | 'ADJUSTMENT_FOUND'
  | 'ADJUSTMENT_DAMAGED'
  | 'DISPOSAL'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN'
  | 'REMOVAL';

/** Movimentação de estoque vendável no centro de distribuição. `quantity` é sempre positiva. */
export interface LedgerEvent {
  id: string;
  sku: string;
  date: string;
  type: LedgerEventType;
  quantity: number;
  disposition: 'SELLABLE' | 'UNSELLABLE';
  /** Remessa, ordem de remoção ou transferência à qual o evento pertence. */
  referenceId?: string;
}

/** Reembolso já pago pelo marketplace — abate a divergência correspondente. */
export interface Reimbursement {
  id: string;
  type: DiscrepancyType;
  sku: string;
  date: string;
  quantity: number;
  amountCents: Cents;
  referenceId?: string;
}

export interface InboundShipment {
  id: string;
  closedAt: string | null;
  lines: { sku: string; shipped: number; received: number }[];
}

export interface RemovalOrder {
  id: string;
  sku: string;
  completedAt: string | null;
  requested: number;
  delivered: number;
  disposed: number;
}

/** Tarifa de fulfillment cobrada por unidade em um lote de pedidos. */
export interface FeeCharge {
  id: string;
  sku: string;
  date: string;
  units: number;
  chargedPerUnitCents: Cents;
}

export interface CustomerReturn {
  orderId: string;
  sku: string;
  quantity: number;
  refundedAt: string;
  refundCents: Cents;
  /** Data em que o item voltou ao centro de distribuição; `null` se nunca voltou. */
  returnedAt: string | null;
}

export interface AuditInput {
  asOf: string;
  catalog: CatalogItem[];
  openingBalances: Record<string, number>;
  reportedBalances: Record<string, number>;
  ledger: LedgerEvent[];
  reimbursements: Reimbursement[];
  inboundShipments: InboundShipment[];
  removalOrders: RemovalOrder[];
  feeCharges: FeeCharge[];
  customerReturns: CustomerReturn[];
}

export interface Discrepancy {
  /** Identidade estável: reexecutar a auditoria sobre os mesmos dados gera a mesma chave. */
  fingerprint: string;
  type: DiscrepancyType;
  sku: string;
  productName: string;
  quantity: number;
  estimatedValueCents: Cents;
  referenceId: string;
  occurredAt: string;
  /** Fim da janela de contestação; `null` quando não há prazo. */
  expiresAt: string | null;
  /** Trilha legível de como o valor foi apurado. */
  evidence: string[];
}

export interface SkuReconciliation {
  sku: string;
  productName: string;
  opening: number;
  inbound: number;
  outbound: number;
  adjustments: number;
  expectedEnding: number;
  reportedEnding: number;
  variance: number;
  varianceValueCents: Cents;
}

export interface AuditStats {
  eventsScanned: number;
  /** Ocorrências ainda dentro do prazo de espera antes de poderem ser contestadas. */
  pendingCount: number;
  /** Ocorrências cujo prazo de contestação já venceu. */
  expiredCount: number;
}

export interface DetectorResult {
  discrepancies: Discrepancy[];
  pendingCount: number;
  expiredCount: number;
}
