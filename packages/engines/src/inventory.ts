import type { AuditPolicy } from './policy';
import type {
  AuditInput,
  DetectorResult,
  Discrepancy,
  DiscrepancyType,
  LedgerEvent,
  SkuReconciliation,
} from './types';
import { catalogIndex, claimWindow, fifoOpen, fingerprint, fmtDate, mulUnits, reimbursedUnits } from './util';

const INBOUND_TYPES = new Set(['RECEIPT', 'CUSTOMER_RETURN', 'TRANSFER_IN', 'ADJUSTMENT_FOUND']);
const OUTBOUND_TYPES = new Set(['SHIPMENT', 'REMOVAL', 'TRANSFER_OUT', 'DISPOSAL']);
const ADJUSTMENT_TYPES = new Set(['ADJUSTMENT_LOST', 'ADJUSTMENT_DAMAGED']);

/** Prefixo da referência de divergências apuradas por diferença de saldo (sem evento no razão). */
export const BALANCE_REFERENCE_PREFIX = 'saldo-';

function balanceReimbursedUnits(input: AuditInput, sku: string): number {
  return input.reimbursements
    .filter((r) => r.type === 'LOST_WAREHOUSE' && r.sku === sku && r.referenceId?.startsWith(BALANCE_REFERENCE_PREFIX))
    .reduce((sum, r) => sum + r.quantity, 0);
}

/**
 * Reconstrói o saldo esperado de cada SKU a partir do razão de movimentações e
 * compara com o saldo informado pelo marketplace.
 *
 *   esperado = inicial + entradas − saídas − ajustes (perdas e danos)
 */
export function buildReconciliation(input: AuditInput): SkuReconciliation[] {
  const catalog = catalogIndex(input.catalog);
  const totals = new Map<string, { inbound: number; outbound: number; adjustments: number }>();
  const bucket = (sku: string) => {
    let entry = totals.get(sku);
    if (!entry) totals.set(sku, (entry = { inbound: 0, outbound: 0, adjustments: 0 }));
    return entry;
  };

  for (const event of input.ledger) {
    if (event.disposition !== 'SELLABLE') continue;
    const entry = bucket(event.sku);
    if (INBOUND_TYPES.has(event.type)) entry.inbound += event.quantity;
    else if (OUTBOUND_TYPES.has(event.type)) entry.outbound += event.quantity;
    else if (ADJUSTMENT_TYPES.has(event.type)) entry.adjustments += event.quantity;
  }

  const skus = new Set([
    ...Object.keys(input.openingBalances),
    ...Object.keys(input.reportedBalances),
    ...totals.keys(),
  ]);

  return [...skus].sort().map((sku) => {
    const entry = bucket(sku);
    const opening = input.openingBalances[sku] ?? 0;
    const expectedEnding = opening + entry.inbound - entry.outbound - entry.adjustments;
    const reportedEnding = input.reportedBalances[sku] ?? expectedEnding;
    const variance = reportedEnding - expectedEnding;
    const item = catalog.get(sku);
    return {
      sku,
      productName: item?.name ?? sku,
      opening,
      inbound: entry.inbound,
      outbound: entry.outbound,
      adjustments: 0 - entry.adjustments,
      expectedEnding,
      reportedEnding,
      variance,
      varianceValueCents: mulUnits(item?.unitCostCents ?? 0, variance),
    };
  });
}

interface LedgerRule {
  type: DiscrepancyType;
  select: (event: LedgerEvent) => boolean;
  /** Unidades que voltaram ao estoque e compensam a ocorrência (além dos reembolsos). */
  offset?: (event: LedgerEvent) => boolean;
  describe: (event: LedgerEvent, remaining: number) => string;
}

const LEDGER_RULES: LedgerRule[] = [
  {
    type: 'LOST_WAREHOUSE',
    select: (e) => e.type === 'ADJUSTMENT_LOST',
    offset: (e) => e.type === 'ADJUSTMENT_FOUND',
    describe: (e, remaining) =>
      `Ajuste de perda de ${e.quantity} un. em ${fmtDate(e.date)}; ${remaining} un. sem localização nem reembolso.`,
  },
  {
    type: 'DAMAGED_WAREHOUSE',
    select: (e) => e.type === 'ADJUSTMENT_DAMAGED' && e.disposition === 'SELLABLE',
    describe: (e, remaining) =>
      `${e.quantity} un. vendáveis danificadas sob custódia do operador em ${fmtDate(e.date)}; ${remaining} un. sem reembolso.`,
  },
  {
    type: 'DISPOSED_SELLABLE',
    // Descartes com referência pertencem a uma ordem de remoção pedida pelo próprio seller.
    select: (e) => e.type === 'DISPOSAL' && e.disposition === 'SELLABLE' && !e.referenceId,
    describe: (e, remaining) =>
      `${e.quantity} un. vendáveis descartadas sem solicitação em ${fmtDate(e.date)}; ${remaining} un. sem reembolso.`,
  },
];

/** Perdas, danos e descartes reconhecidos no razão e ainda não compensados. */
export function detectLedgerDiscrepancies(input: AuditInput, policy: AuditPolicy): DetectorResult {
  const catalog = catalogIndex(input.catalog);
  const result: DetectorResult = { discrepancies: [], pendingCount: 0, expiredCount: 0 };

  const bySku = new Map<string, LedgerEvent[]>();
  for (const event of input.ledger) {
    const list = bySku.get(event.sku);
    if (list) list.push(event);
    else bySku.set(event.sku, [event]);
  }

  for (const [sku, events] of bySku) {
    const item = catalog.get(sku);
    for (const rule of LEDGER_RULES) {
      const occurrences = events.filter(rule.select);
      if (occurrences.length === 0) continue;
      const offsetUnits = rule.offset
        ? events.filter(rule.offset).reduce((sum, e) => sum + e.quantity, 0)
        : 0;
      // Reembolsos de variação de saldo compensam outra divergência (ver detectUnexplainedVariance).
      const credits =
        offsetUnits +
        reimbursedUnits(input.reimbursements, rule.type, sku) -
        (rule.type === 'LOST_WAREHOUSE' ? balanceReimbursedUnits(input, sku) : 0);

      for (const { event, remaining } of fifoOpen(occurrences, credits)) {
        const window = claimWindow(
          event.date,
          input.asOf,
          policy.warehouseWaitDays,
          policy.warehouseClaimWindowDays,
        );
        if (window.state === 'PENDING') {
          result.pendingCount += 1;
          continue;
        }
        if (window.state === 'EXPIRED') {
          result.expiredCount += 1;
          continue;
        }
        result.discrepancies.push({
          fingerprint: fingerprint(rule.type, sku, event.id),
          type: rule.type,
          sku,
          productName: item?.name ?? sku,
          quantity: remaining,
          estimatedValueCents: mulUnits(item?.unitCostCents ?? 0, remaining),
          referenceId: event.id,
          occurredAt: event.date,
          expiresAt: window.expiresAt,
          evidence: [rule.describe(event, remaining)],
        });
      }
    }
  }
  return result;
}

/** Transferências entre centros em que saíram mais unidades do que chegaram. */
export function detectTransferLosses(input: AuditInput, policy: AuditPolicy): DetectorResult {
  const catalog = catalogIndex(input.catalog);
  const result: DetectorResult = { discrepancies: [], pendingCount: 0, expiredCount: 0 };
  const transfers = new Map<string, { sku: string; out: number; in: number; date: string; ref: string }>();

  for (const event of input.ledger) {
    if (!event.referenceId) continue;
    if (event.type !== 'TRANSFER_OUT' && event.type !== 'TRANSFER_IN') continue;
    const key = `${event.sku}|${event.referenceId}`;
    let entry = transfers.get(key);
    if (!entry) {
      entry = { sku: event.sku, out: 0, in: 0, date: event.date, ref: event.referenceId };
      transfers.set(key, entry);
    }
    if (event.type === 'TRANSFER_OUT') {
      entry.out += event.quantity;
      if (event.date < entry.date) entry.date = event.date;
    } else {
      entry.in += event.quantity;
    }
  }

  for (const transfer of transfers.values()) {
    const missing =
      transfer.out - transfer.in - reimbursedUnits(input.reimbursements, 'TRANSFER_LOST', transfer.sku, transfer.ref);
    if (missing <= 0) continue;
    const window = claimWindow(transfer.date, input.asOf, policy.transferWaitDays, policy.warehouseClaimWindowDays);
    if (window.state === 'PENDING') {
      result.pendingCount += 1;
      continue;
    }
    if (window.state === 'EXPIRED') {
      result.expiredCount += 1;
      continue;
    }
    const item = catalog.get(transfer.sku);
    result.discrepancies.push({
      fingerprint: fingerprint('TRANSFER_LOST', transfer.sku, transfer.ref),
      type: 'TRANSFER_LOST',
      sku: transfer.sku,
      productName: item?.name ?? transfer.sku,
      quantity: missing,
      estimatedValueCents: mulUnits(item?.unitCostCents ?? 0, missing),
      referenceId: transfer.ref,
      occurredAt: transfer.date,
      expiresAt: window.expiresAt,
      evidence: [
        `Transferência ${transfer.ref}: ${transfer.out} un. expedidas, ${transfer.in} un. recebidas no destino.`,
        `${missing} un. sem chegada nem reembolso após ${policy.transferWaitDays} dias.`,
      ],
    });
  }
  return result;
}

/**
 * Diferença entre o saldo informado e o saldo reconstruído que nenhum ajuste explica.
 * A referência usa o mês de apuração para que a mesma variação não seja contada duas vezes.
 */
export function detectUnexplainedVariance(input: AuditInput, rows: SkuReconciliation[]): DetectorResult {
  const catalog = catalogIndex(input.catalog);
  const period = input.asOf.slice(0, 7);
  const discrepancies: Discrepancy[] = [];
  for (const row of rows) {
    const missing = -row.variance - balanceReimbursedUnits(input, row.sku);
    if (missing <= 0) continue;
    const referenceId = `${BALANCE_REFERENCE_PREFIX}${period}`;
    discrepancies.push({
      fingerprint: fingerprint('LOST_WAREHOUSE', row.sku, referenceId),
      type: 'LOST_WAREHOUSE',
      sku: row.sku,
      productName: row.productName,
      quantity: missing,
      estimatedValueCents: mulUnits(catalog.get(row.sku)?.unitCostCents ?? 0, missing),
      referenceId,
      occurredAt: input.asOf,
      expiresAt: null,
      evidence: [
        `Saldo esperado pelo razão: ${row.expectedEnding} un.; saldo informado: ${row.reportedEnding} un.`,
        `${missing} un. ausentes sem ajuste, venda ou remoção que justifique.`,
      ],
    });
  }
  return { discrepancies, pendingCount: 0, expiredCount: 0 };
}
