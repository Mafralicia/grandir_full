import type { AuditPolicy } from './policy';
import type { AuditInput, CatalogItem, Cents, DetectorResult, FeeCharge } from './types';
import { catalogIndex, daysBetween, fingerprint } from './util';

export interface FeeTier {
  code: string;
  label: string;
  /** Limites para o maior, o intermediário e o menor lado da embalagem. */
  maxLongestCm: number;
  maxMedianCm: number;
  maxShortestCm: number;
  maxBillableG: number;
  baseCents: Cents;
  /** Peso coberto pela tarifa-base; o excedente é cobrado por fração de 100 g. */
  includedG: number;
  per100gCents: Cents;
}

export interface FeeSchedule {
  /** cm³ por kg no cálculo do peso cubado. */
  dimensionalDivisor: number;
  tiers: FeeTier[];
}

/**
 * Tabela de referência usada no ambiente de demonstração. Cada conector de
 * marketplace deve fornecer a tabela vigente publicada pelo operador.
 */
export const DEFAULT_FEE_SCHEDULE: FeeSchedule = {
  dimensionalDivisor: 6000,
  tiers: [
    { code: 'P', label: 'Pequeno', maxLongestCm: 25, maxMedianCm: 20, maxShortestCm: 5, maxBillableG: 500, baseCents: 895, includedG: 250, per100gCents: 45 },
    { code: 'M', label: 'Médio', maxLongestCm: 45, maxMedianCm: 35, maxShortestCm: 20, maxBillableG: 5_000, baseCents: 1295, includedG: 500, per100gCents: 60 },
    { code: 'G', label: 'Grande', maxLongestCm: 80, maxMedianCm: 60, maxShortestCm: 45, maxBillableG: 20_000, baseCents: 2190, includedG: 1_000, per100gCents: 75 },
    { code: 'XG', label: 'Extragrande', maxLongestCm: Infinity, maxMedianCm: Infinity, maxShortestCm: Infinity, maxBillableG: Infinity, baseCents: 4490, includedG: 2_000, per100gCents: 90 },
  ],
};

/** O maior entre o peso real e o peso cubado. */
export function billableWeightG(item: CatalogItem, schedule: FeeSchedule): number {
  const volumeCm3 = item.lengthCm * item.widthCm * item.heightCm;
  const dimensionalG = Math.round((volumeCm3 / schedule.dimensionalDivisor) * 1000);
  return Math.max(item.weightG, dimensionalG);
}

export function resolveTier(item: CatalogItem, schedule: FeeSchedule): FeeTier {
  const [shortest, median, longest] = [item.lengthCm, item.widthCm, item.heightCm].sort((a, b) => a - b);
  const billable = billableWeightG(item, schedule);
  const tier = schedule.tiers.find(
    (t) =>
      longest <= t.maxLongestCm &&
      median <= t.maxMedianCm &&
      shortest <= t.maxShortestCm &&
      billable <= t.maxBillableG,
  );
  return tier ?? schedule.tiers[schedule.tiers.length - 1];
}

/** Tarifa de fulfillment esperada por unidade, a partir das medidas cadastradas do produto. */
export function expectedFeeCents(item: CatalogItem, schedule: FeeSchedule = DEFAULT_FEE_SCHEDULE): Cents {
  const tier = resolveTier(item, schedule);
  const extraG = Math.max(0, billableWeightG(item, schedule) - tier.includedG);
  return tier.baseCents + Math.ceil(extraG / 100) * tier.per100gCents;
}

/**
 * Compara a tarifa cobrada com a esperada. As cobranças a maior são agrupadas por
 * SKU e mês: um único chamado cobre todos os pedidos afetados no período.
 */
export function detectFeeOvercharges(
  input: AuditInput,
  policy: AuditPolicy,
  schedule: FeeSchedule = DEFAULT_FEE_SCHEDULE,
): DetectorResult {
  const catalog = catalogIndex(input.catalog);
  const groups = new Map<string, { sku: string; period: string; charges: FeeCharge[]; expected: Cents }>();

  for (const charge of input.feeCharges) {
    const age = daysBetween(charge.date, input.asOf);
    if (age < 0 || age > policy.feeLookbackDays) continue;
    const item = catalog.get(charge.sku);
    if (!item) continue;
    const expected = expectedFeeCents(item, schedule);
    if (charge.chargedPerUnitCents - expected <= policy.feeToleranceCents) continue;

    const period = charge.date.slice(0, 7);
    const key = `${charge.sku}|${period}`;
    const group = groups.get(key);
    if (group) group.charges.push(charge);
    else groups.set(key, { sku: charge.sku, period, charges: [charge], expected });
  }

  const discrepancies = [...groups.values()].map((group) => {
    const item = catalog.get(group.sku)!;
    const units = group.charges.reduce((sum, c) => sum + c.units, 0);
    const overcharge = group.charges.reduce(
      (sum, c) => sum + (c.chargedPerUnitCents - group.expected) * c.units,
      0,
    );
    const tier = resolveTier(item, schedule);
    const charged = group.charges[0].chargedPerUnitCents;
    return {
      fingerprint: fingerprint('FEE_OVERCHARGE', group.sku, group.period),
      type: 'FEE_OVERCHARGE' as const,
      sku: group.sku,
      productName: item.name,
      quantity: units,
      estimatedValueCents: overcharge,
      referenceId: group.period,
      occurredAt: group.charges.map((c) => c.date).sort()[0],
      expiresAt: null,
      evidence: [
        `Medidas cadastradas: ${item.lengthCm}×${item.widthCm}×${item.heightCm} cm, ${item.weightG} g → faixa ${tier.label}.`,
        `Tarifa esperada: ${(group.expected / 100).toFixed(2)} por unidade; cobrada: ${(charged / 100).toFixed(2)}.`,
        `${units} un. tarifadas a maior em ${group.period}.`,
      ],
    };
  });

  return { discrepancies, pendingCount: 0, expiredCount: 0 };
}
