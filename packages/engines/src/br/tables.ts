import mercadolivre from '../../config/tarifas/mercadolivre.json';
import shopee from '../../config/tarifas/shopee.json';
import type { Cents } from '../types';
import type { BrRule, ErpProduct } from './model';

/**
 * Tabelas de tarifas versionadas por vigência.
 *
 * Cada versão vale de `effectiveFrom` a `effectiveTo` (inclusive; `null` = em aberto) e cada
 * pedido é auditado com a versão válida na data da venda. As versões ficam em
 * `packages/engines/config/tarifas/*.json`. `verified` indica se os valores foram
 * conferidos na fonte oficial do marketplace — enquanto for `false`, a divergência
 * calculada com a versão é marcada como apoiada em regra não confirmada.
 */
export interface TariffVersion {
  id: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  verified: boolean;
  sources: string[];
  notes: string;
  cubicDivisor: number;
  /** Faixas de preço unitário, da mais alta para a mais baixa; em cada uma, degraus por peso. */
  freight: { minPriceCents: Cents; tiers: { maxG: number | null; cents: Cents }[] }[];
}

export interface CommissionRule {
  categoryId: string;
  label: string;
  classicoBps: number;
  premiumBps: number;
}

export interface MlTariff extends TariffVersion {
  commissions: CommissionRule[];
  defaultCommission: CommissionRule;
  /** Custo fixo por unidade conforme o preço: valor em centavos ou percentual do preço. */
  fixedFee: { belowCents: Cents; cents?: Cents; percentBps?: number }[];
}

export interface ShopeeTariff extends TariffVersion {
  /** Comissão por faixa de preço unitário (`belowCents: null` = sem limite superior). */
  commission: { belowCents: Cents | null; rateBps: number; fixedCents: Cents }[];
  commissionCapCents: Cents | null;
  transactionFeeBps: number;
}

export interface BrTables {
  ml: MlTariff[];
  shopee: ShopeeTariff[];
  /** Diferenças abaixo deste valor não viram divergência. */
  toleranceCents: Cents;
  /** Dias para contestar, contados da ocorrência. Valores de referência, não confirmados. */
  deadlineDays: Record<BrRule, number>;
  inboundWaitDays: number;
  settlementWaitDays: number;
  incidentWaitDays: number;
}

function validate<T extends TariffVersion>(versions: T[], name: string): T[] {
  const sorted = [...versions].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  sorted.forEach((version, index) => {
    if (version.effectiveTo && version.effectiveTo < version.effectiveFrom) throw new Error(`${name}: vigência invertida em ${version.id}`);
    const next = sorted[index + 1];
    if (next && (!version.effectiveTo || version.effectiveTo >= next.effectiveFrom)) {
      throw new Error(`${name}: as versões ${version.id} e ${next.id} se sobrepõem`);
    }
  });
  return sorted;
}

export const REFERENCE_TABLES: BrTables = {
  ml: validate(mercadolivre.versions as MlTariff[], 'mercadolivre'),
  shopee: validate(shopee.versions as ShopeeTariff[], 'shopee'),
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
    SHOPEE_RETURN_NOT_RESTOCKED: 30,
    SHOPEE_RETURN_DAMAGED: 30,
    TIKTOK_LOST_NO_CREDIT: 30,
    TIKTOK_PAYOUT_SHORTFALL: 30,
    TIKTOK_RETURN_NOT_RESTOCKED: 30,
    TIKTOK_RETURN_DAMAGED: 30,
    ERP_INBOUND_GAP: 90,
    ERP_UNSETTLED_SALE: 90,
  },
  inboundWaitDays: 10,
  settlementWaitDays: 30,
  incidentWaitDays: 15,
};

/** A versão vigente na data informada, ou `undefined` se nenhuma cobre a data. */
export function versionAt<T extends TariffVersion>(versions: T[], date: string): T | undefined {
  const day = date.slice(0, 10);
  return versions.find((v) => v.effectiveFrom <= day && (v.effectiveTo === null || day <= v.effectiveTo));
}

/** O maior entre o peso real e o peso cubado (C × L × A ÷ divisor), em gramas. */
export function billableWeightG(product: ErpProduct, cubicDivisor: number): number {
  const cubicG = Math.round(((product.lengthCm * product.widthCm * product.heightCm) / cubicDivisor) * 1000);
  return Math.max(product.weightG, cubicG);
}

export function freightCents(version: TariffVersion, unitPriceCents: Cents, weightG: number): Cents {
  const band = version.freight.find((b) => unitPriceCents >= b.minPriceCents) ?? version.freight[version.freight.length - 1];
  return (band.tiers.find((tier) => tier.maxG === null || weightG <= tier.maxG) ?? band.tiers[band.tiers.length - 1]).cents;
}

export function mlCommissionRule(version: MlTariff, categoryId: string): CommissionRule {
  return version.commissions.find((c) => c.categoryId === categoryId) ?? version.defaultCommission;
}

export function mlFixedFeeCents(version: MlTariff, unitPriceCents: Cents, quantity: number): Cents {
  const band = version.fixedFee.find((b) => unitPriceCents < b.belowCents);
  if (!band) return 0;
  return (band.cents ?? Math.round((unitPriceCents * (band.percentBps ?? 0)) / 10_000)) * quantity;
}

export function mlCommissionCents(version: MlTariff, categoryId: string, listingType: 'classico' | 'premium', grossCents: Cents): Cents {
  const rule = mlCommissionRule(version, categoryId);
  return Math.round((grossCents * (listingType === 'premium' ? rule.premiumBps : rule.classicoBps)) / 10_000);
}

export function shopeeBand(version: ShopeeTariff, unitPriceCents: Cents) {
  return version.commission.find((b) => b.belowCents === null || unitPriceCents < b.belowCents) ?? version.commission[version.commission.length - 1];
}

/** Comissão da Shopee: percentual sobre a venda mais valor fixo por item, respeitando o teto por item quando houver. */
export function shopeeCommissionCents(version: ShopeeTariff, grossCents: Cents, quantity: number): Cents {
  const band = shopeeBand(version, grossCents / quantity);
  const percent = Math.round((grossCents * band.rateBps) / 10_000);
  const capped = version.commissionCapCents === null ? percent : Math.min(percent, version.commissionCapCents * quantity);
  return capped + band.fixedCents * quantity;
}

export const shopeeTransactionCents = (version: ShopeeTariff, grossCents: Cents): Cents =>
  Math.round((grossCents * version.transactionFeeBps) / 10_000);

export const pct = (bps: number): string => `${(bps / 100).toLocaleString('pt-BR')}%`;
export const brl = (cents: Cents): string =>
  `R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "tabela ml-br-2026-03, vigente desde 01/03/2026" */
export function versionLabel(version: TariffVersion): string {
  const since = version.effectiveFrom.split('-').reverse().join('/');
  return `tabela ${version.id}, vigente desde ${since}`;
}
