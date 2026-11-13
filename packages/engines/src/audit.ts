import { DEFAULT_FEE_SCHEDULE, detectFeeOvercharges, type FeeSchedule } from './fees';
import {
  buildReconciliation,
  detectLedgerDiscrepancies,
  detectTransferLosses,
  detectUnexplainedVariance,
} from './inventory';
import { detectInboundShortages, detectRemovalShortages, detectUnreturnedRefunds } from './logistics';
import { DEFAULT_POLICY, type AuditPolicy } from './policy';
import type { AuditInput, AuditStats, Discrepancy, SkuReconciliation } from './types';

export interface AuditResult {
  discrepancies: Discrepancy[];
  reconciliation: SkuReconciliation[];
  stats: AuditStats;
}

/**
 * Executa todos os detectores sobre um retrato dos dados do marketplace.
 * É uma função pura: mesmos dados, mesmo resultado — o que torna a auditoria
 * reexecutável sem duplicar divergências.
 */
export function runAudit(
  input: AuditInput,
  policy: AuditPolicy = DEFAULT_POLICY,
  feeSchedule: FeeSchedule = DEFAULT_FEE_SCHEDULE,
): AuditResult {
  const reconciliation = buildReconciliation(input);
  const results = [
    detectLedgerDiscrepancies(input, policy),
    detectTransferLosses(input, policy),
    detectUnexplainedVariance(input, reconciliation),
    detectInboundShortages(input, policy),
    detectRemovalShortages(input, policy),
    detectUnreturnedRefunds(input, policy),
    detectFeeOvercharges(input, policy, feeSchedule),
  ];

  const byFingerprint = new Map<string, Discrepancy>();
  for (const result of results) {
    for (const discrepancy of result.discrepancies) {
      if (discrepancy.quantity <= 0 || discrepancy.estimatedValueCents <= 0) continue;
      byFingerprint.set(discrepancy.fingerprint, discrepancy);
    }
  }

  return {
    discrepancies: [...byFingerprint.values()].sort(
      (a, b) => b.estimatedValueCents - a.estimatedValueCents || a.fingerprint.localeCompare(b.fingerprint),
    ),
    reconciliation,
    stats: {
      eventsScanned:
        input.ledger.length +
        input.inboundShipments.length +
        input.removalOrders.length +
        input.feeCharges.length +
        input.customerReturns.length,
      pendingCount: results.reduce((sum, r) => sum + r.pendingCount, 0),
      expiredCount: results.reduce((sum, r) => sum + r.expiredCount, 0),
    },
  };
}
