import { randomUUID } from 'node:crypto';
import { canTransition, successFeeCents, type ClaimStatus } from '@grandir/engines';
import { nowIso } from '../db';
import { badRequest, conflict, notFound } from '../errors';
import type { TenantScope } from '../tenant';

export interface ClaimRow {
  id: string;
  store_id: string;
  discrepancy_id: string;
  code: string;
  type: string;
  status: ClaimStatus;
  claimed_cents: number;
  approved_cents: number | null;
  /** Chamado de dossiê que governa este registro; `null` para chamados avulsos. */
  case_id: string | null;
}

function addEvent(
  scope: TenantScope,
  claimId: string,
  event: { at: string; actor: string; kind: 'STATUS' | 'COMMENT' | 'DOCUMENT'; from?: string | null; to?: string | null; note?: string | null },
): void {
  scope.run(
    `INSERT INTO claim_events (id, tenant_id, claim_id, at, actor, kind, from_status, to_status, note)
     VALUES (:id, :tenantId, :claimId, :at, :actor, :kind, :from, :to, :note)`,
    {
      id: randomUUID(),
      claimId,
      at: event.at,
      actor: event.actor,
      kind: event.kind,
      from: event.from ?? null,
      to: event.to ?? null,
      note: event.note ?? null,
    },
  );
}

export function getClaim(scope: TenantScope, claimId: string): ClaimRow {
  const claim = scope.get<ClaimRow>('SELECT * FROM claims WHERE tenant_id = :tenantId AND id = :claimId', { claimId });
  if (!claim) throw notFound('Chamado não encontrado.');
  return claim;
}

/** Abre um chamado para uma divergência em aberto. Deve rodar dentro de uma transação. */
export function openClaim(
  scope: TenantScope,
  discrepancyId: string,
  actor: string,
  at = nowIso(),
  initial: 'SUBMITTED' | 'DRAFT' = 'SUBMITTED',
): ClaimRow {
  const discrepancy = scope.get<{ id: string; store_id: string; type: string; status: string; estimated_value_cents: number }>(
    'SELECT id, store_id, type, status, estimated_value_cents FROM discrepancies WHERE tenant_id = :tenantId AND id = :discrepancyId',
    { discrepancyId },
  );
  if (!discrepancy) throw notFound('Divergência não encontrada.');
  if (discrepancy.status !== 'OPEN') throw conflict('Esta divergência já foi tratada.');

  const { total } = scope.get<{ total: number }>('SELECT COUNT(*) AS total FROM claims WHERE tenant_id = :tenantId')!;
  const id = randomUUID();
  scope.run(
    `INSERT INTO claims (id, tenant_id, store_id, discrepancy_id, code, type, status, claimed_cents, opened_at, updated_at)
     VALUES (:id, :tenantId, :storeId, :discrepancyId, :code, :type, :initial, :claimedCents, :at, :at)`,
    {
      id,
      storeId: discrepancy.store_id,
      discrepancyId,
      code: `GRD-${String(total + 1).padStart(5, '0')}`,
      type: discrepancy.type,
      claimedCents: discrepancy.estimated_value_cents,
      initial,
      at,
    },
  );
  scope.run("UPDATE discrepancies SET status = 'CLAIMED' WHERE tenant_id = :tenantId AND id = :discrepancyId", { discrepancyId });
  addEvent(scope, id, {
    at,
    actor,
    kind: 'STATUS',
    to: initial,
    note: initial === 'DRAFT' ? 'Incluído em um chamado de dossiê.' : 'Chamado aberto junto ao marketplace.',
  });
  return getClaim(scope, id);
}

export interface TransitionOptions {
  actor: string;
  at?: string;
  note?: string;
  approvedCents?: number;
  marketplaceCaseId?: string;
}

/** Move o chamado no ciclo de vida. Deve rodar dentro de uma transação. */
export function transitionClaim(scope: TenantScope, claimId: string, to: ClaimStatus, options: TransitionOptions): ClaimRow {
  const claim = getClaim(scope, claimId);
  if (!canTransition(claim.status, to)) {
    throw conflict(`Não é possível mover o chamado de ${claim.status} para ${to}.`, 'TRANSICAO_INVALIDA');
  }
  const at = options.at ?? nowIso();

  let approvedCents = claim.approved_cents;
  if (to === 'APPROVED') approvedCents = options.approvedCents ?? claim.claimed_cents;
  if (to === 'PARTIALLY_APPROVED') {
    if (options.approvedCents === undefined) throw badRequest('Informe o valor aprovado.');
    approvedCents = options.approvedCents;
  }
  if (to === 'DENIED' || to === 'REOPENED') approvedCents = null;
  if (approvedCents !== null && (approvedCents <= 0 || approvedCents > claim.claimed_cents)) {
    throw badRequest('O valor aprovado deve ser maior que zero e no máximo o valor reclamado.');
  }
  if (to === 'PARTIALLY_APPROVED' && approvedCents === claim.claimed_cents) {
    throw badRequest('Aprovação pelo valor integral deve usar o status "Aprovado".');
  }

  const decided = to === 'APPROVED' || to === 'PARTIALLY_APPROVED' || to === 'DENIED' || to === 'CLOSED';
  scope.run(
    `UPDATE claims
        SET status = :to,
            approved_cents = :approvedCents,
            updated_at = :at,
            resolved_at = CASE WHEN :decided = 1 THEN :at WHEN :to = 'REOPENED' THEN NULL ELSE resolved_at END,
            paid_at = CASE WHEN :to = 'PAID' THEN :at ELSE paid_at END,
            marketplace_case_id = COALESCE(:caseId, marketplace_case_id)
      WHERE tenant_id = :tenantId AND id = :claimId`,
    { to, approvedCents, at, decided: decided ? 1 : 0, caseId: options.marketplaceCaseId ?? null, claimId },
  );
  addEvent(scope, claimId, { at, actor: options.actor, kind: 'STATUS', from: claim.status, to, note: options.note });

  if (to === 'PAID') {
    recordRecovery(scope, claimId, approvedCents!, at);
    scope.run("UPDATE discrepancies SET status = 'RESOLVED' WHERE tenant_id = :tenantId AND id = :id", { id: claim.discrepancy_id });
  }
  if (to === 'CLOSED') {
    scope.run("UPDATE discrepancies SET status = 'RESOLVED' WHERE tenant_id = :tenantId AND id = :id", { id: claim.discrepancy_id });
  }
  return getClaim(scope, claimId);
}

export function addComment(scope: TenantScope, claimId: string, actor: string, note: string): void {
  getClaim(scope, claimId);
  addEvent(scope, claimId, { at: nowIso(), actor, kind: 'COMMENT', note });
}

export function addDocumentEvent(scope: TenantScope, claimId: string, actor: string, filename: string): void {
  addEvent(scope, claimId, { at: nowIso(), actor, kind: 'DOCUMENT', note: filename });
}

/**
 * Cobrança por sucesso: lança a taxa na fatura do mês em que o reembolso foi pago.
 * A taxa da fatura é fixada na abertura do período, de modo que uma mudança de
 * contrato não altera cobranças de meses anteriores.
 */
function recordRecovery(scope: TenantScope, claimId: string, recoveredCents: number, at: string): void {
  const period = at.slice(0, 7);
  let invoice = scope.get<{ id: string; fee_rate_bps: number }>(
    'SELECT id, fee_rate_bps FROM invoices WHERE tenant_id = :tenantId AND period = :period',
    { period },
  );
  if (!invoice) {
    const tenant = scope.get<{ fee_rate_bps: number }>('SELECT fee_rate_bps FROM tenants WHERE id = :tenantId')!;
    invoice = { id: randomUUID(), fee_rate_bps: tenant.fee_rate_bps };
    scope.run(
      'INSERT INTO invoices (id, tenant_id, period, fee_rate_bps, created_at) VALUES (:id, :tenantId, :period, :rate, :at)',
      { id: invoice.id, period, rate: invoice.fee_rate_bps, at },
    );
  }
  const feeCents = successFeeCents(recoveredCents, invoice.fee_rate_bps);
  scope.run(
    `INSERT INTO invoice_lines (id, tenant_id, invoice_id, claim_id, recovered_cents, fee_cents, created_at)
     VALUES (:id, :tenantId, :invoiceId, :claimId, :recoveredCents, :feeCents, :at)`,
    { id: randomUUID(), invoiceId: invoice.id, claimId, recoveredCents, feeCents, at },
  );
  scope.run(
    `UPDATE invoices SET recovered_cents = recovered_cents + :recoveredCents, fee_cents = fee_cents + :feeCents
      WHERE tenant_id = :tenantId AND id = :invoiceId`,
    { recoveredCents, feeCents, invoiceId: invoice.id },
  );
}
