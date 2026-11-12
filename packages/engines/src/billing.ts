import type { Cents } from './types';

/** Aplica uma taxa em pontos-base (2000 = 20%) com arredondamento para o centavo mais próximo. */
export function successFeeCents(recoveredCents: Cents, rateBps: number): Cents {
  if (!Number.isInteger(recoveredCents) || recoveredCents < 0) {
    throw new RangeError('recoveredCents deve ser um inteiro não negativo');
  }
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10_000) {
    throw new RangeError('rateBps deve estar entre 0 e 10000');
  }
  return Math.floor((recoveredCents * rateBps + 5_000) / 10_000);
}

export interface RecoveryLine {
  claimId: string;
  recoveredCents: Cents;
}

export interface InvoiceDraft {
  rateBps: number;
  recoveredCents: Cents;
  feeCents: Cents;
  lines: (RecoveryLine & { feeCents: Cents })[];
}

/**
 * Cobrança por sucesso: a taxa incide somente sobre o que foi efetivamente pago
 * pelo marketplace. É calculada linha a linha para que cada cobrança possa ser
 * rastreada até o chamado que a originou.
 */
export function buildInvoice(recoveries: RecoveryLine[], rateBps: number): InvoiceDraft {
  const lines = recoveries.map((line) => ({ ...line, feeCents: successFeeCents(line.recoveredCents, rateBps) }));
  return {
    rateBps,
    recoveredCents: lines.reduce((sum, line) => sum + line.recoveredCents, 0),
    feeCents: lines.reduce((sum, line) => sum + line.feeCents, 0),
    lines,
  };
}
