import type { Cents } from './types';

/**
 * Prazos e tolerâncias da auditoria. Cada marketplace publica as próprias regras;
 * os valores abaixo são padrões conservadores e devem ser ajustados por conector.
 */
export interface AuditPolicy {
  /** Dias de espera antes de contestar perda/dano em armazém (o operador pode localizar o item). */
  warehouseWaitDays: number;
  warehouseClaimWindowDays: number;
  transferWaitDays: number;
  /** Dias após o fechamento da remessa para considerar a contagem definitiva. */
  inboundWaitDays: number;
  inboundClaimWindowDays: number;
  removalWaitDays: number;
  removalClaimWindowDays: number;
  /** Prazo que o comprador tem para devolver antes de o reembolso ser contestável. */
  returnWaitDays: number;
  returnClaimWindowDays: number;
  feeLookbackDays: number;
  /** Diferença por unidade abaixo da qual a cobrança é considerada correta. */
  feeToleranceCents: Cents;
}

export const DEFAULT_POLICY: AuditPolicy = {
  warehouseWaitDays: 30,
  warehouseClaimWindowDays: 540,
  transferWaitDays: 30,
  inboundWaitDays: 15,
  inboundClaimWindowDays: 270,
  removalWaitDays: 30,
  removalClaimWindowDays: 365,
  returnWaitDays: 60,
  returnClaimWindowDays: 365,
  feeLookbackDays: 90,
  feeToleranceCents: 5,
};
