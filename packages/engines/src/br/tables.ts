import type { Cents } from '../types';
import type { BrRule, ErpProduct } from './model';

/**
 * Tabelas de tarifas e prazos usadas pelo motor.
 *
 * ATENÇÃO: os valores abaixo são de REFERÊNCIA, para o ambiente de demonstração e para
 * os testes. Comissões, tarifas fixas, tabelas de frete e prazos de contestação mudam
 * com frequência e variam por categoria, reputação e programa logístico. Antes de usar
 * com dados reais, carregue as tabelas vigentes publicadas por cada marketplace.
 */
export interface CommissionRule {
  categoryId: string;
  label: string;
  rateBps: { classico: number; premium: number };
}

export interface FreightTier {
  maxG: number;
  cents: Cents;
}

export interface BrTables {
  ml: {
    commissions: CommissionRule[];
    defaultCommission: CommissionRule;
    /** Tarifa fixa por unidade para itens abaixo de `fixedFeeBelowCents`. */
    fixedFeeCents: Cents;
    fixedFeeBelowCents: Cents;
    freight: FreightTier[];
    cubicDivisor: number;
  };
  shopee: {
    commissionBps: number;
    /** Teto da comissão por item. */
    commissionCapCents: Cents;
    transactionFeeBps: number;
    freight: FreightTier[];
    cubicDivisor: number;
  };
  /** Diferenças abaixo deste valor não viram divergência. */
  toleranceCents: Cents;
  /** Dias para contestar, contados da ocorrência. */
  deadlineDays: Record<BrRule, number>;
  /** Dias de espera antes de tratar o caso como não resolvido. */
  inboundWaitDays: number;
  settlementWaitDays: number;
  incidentWaitDays: number;
}

export const REFERENCE_TABLES: BrTables = {
  ml: {
    commissions: [
      { categoryId: 'MLB-CASA', label: 'Casa, móveis e decoração', rateBps: { classico: 1150, premium: 1650 } },
      { categoryId: 'MLB-ELETRO', label: 'Eletrônicos, áudio e vídeo', rateBps: { classico: 1300, premium: 1800 } },
      { categoryId: 'MLB-ESPORTE', label: 'Esportes e fitness', rateBps: { classico: 1200, premium: 1700 } },
    ],
    defaultCommission: { categoryId: '*', label: 'Demais categorias', rateBps: { classico: 1200, premium: 1700 } },
    fixedFeeCents: 600,
    fixedFeeBelowCents: 7900,
    freight: [
      { maxG: 500, cents: 1990 },
      { maxG: 1000, cents: 2290 },
      { maxG: 2000, cents: 2490 },
      { maxG: 5000, cents: 2990 },
      { maxG: 9000, cents: 4490 },
      { maxG: Infinity, cents: 7990 },
    ],
    cubicDivisor: 6000,
  },
  shopee: {
    commissionBps: 1400,
    commissionCapCents: 10000,
    transactionFeeBps: 200,
    freight: [
      { maxG: 500, cents: 1590 },
      { maxG: 1000, cents: 1890 },
      { maxG: 2000, cents: 2290 },
      { maxG: 5000, cents: 2890 },
      { maxG: Infinity, cents: 4990 },
    ],
    cubicDivisor: 6000,
  },
  toleranceCents: 50,
  deadlineDays: {
    ML_WAREHOUSE_LOSS: 90,
    ML_WAREHOUSE_DAMAGE: 90,
    ML_TRANSIT_LOSS: 60,
    ML_FREIGHT_OVERCHARGE: 60,
    ML_RETURN_NOT_RESTOCKED: 30,
    ML_RETURN_DAMAGED: 30,
    ML_COMMISSION_OVERCHARGE: 90,
    SHOPEE_LOST_NO_CREDIT: 30,
    SHOPEE_PAYOUT_SHORTFALL: 30,
    SHOPEE_FREIGHT_OVERCHARGE: 30,
    ERP_INBOUND_GAP: 90,
    ERP_UNSETTLED_SALE: 90,
  },
  inboundWaitDays: 10,
  settlementWaitDays: 30,
  incidentWaitDays: 15,
};

/** O maior entre o peso real e o peso cubado (C × L × A ÷ divisor), em gramas. */
export function billableWeightG(product: ErpProduct, cubicDivisor: number): number {
  const cubicG = Math.round(((product.lengthCm * product.widthCm * product.heightCm) / cubicDivisor) * 1000);
  return Math.max(product.weightG, cubicG);
}

export function freightFor(weightG: number, tiers: FreightTier[]): Cents {
  return (tiers.find((tier) => weightG <= tier.maxG) ?? tiers[tiers.length - 1]).cents;
}

export const pct = (bps: number): string => `${(bps / 100).toLocaleString('pt-BR')}%`;
export const brl = (cents: Cents): string =>
  `R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
