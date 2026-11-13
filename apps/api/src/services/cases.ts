import { randomUUID } from 'node:crypto';
import type { DossierGroup } from '@grandir/engines';
import { nowIso } from '../db';
import { badRequest, conflict, notFound } from '../errors';
import type { TenantScope } from '../tenant';
import { openClaim, transitionClaim } from './claims';

/**
 * Chamado de dossiê: um único pedido ao marketplace que cobre um grupo de divergências.
 * O status do chamado governa todas elas — cada divergência tem um registro individual
 * (para o valor deferido por item e para a cobrança por sucesso), mas esses registros só
 * mudam por aqui, nunca um a um.
 */
export const CASE_STATUSES = ['RASCUNHO', 'ABERTO', 'EM_ANALISE', 'DEFERIDO', 'INDEFERIDO', 'PAGO'] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

const TRANSITIONS: Record<CaseStatus, readonly CaseStatus[]> = {
  RASCUNHO: ['ABERTO'],
  ABERTO: ['EM_ANALISE'],
  EM_ANALISE: ['DEFERIDO', 'INDEFERIDO'],
  DEFERIDO: ['PAGO'],
  // Indeferimento admite reabertura com novas evidências.
  INDEFERIDO: ['EM_ANALISE'],
  PAGO: [],
};
export const nextCaseStatuses = (status: CaseStatus): readonly CaseStatus[] => TRANSITIONS[status];

export interface CaseRow {
  id: string;
  store_id: string;
  code: string;
  type: string;
  bucket_label: string;
  status: CaseStatus;
  protocol: string | null;
  opened_at: string | null;
  claimed_cents: number;
  approved_cents: number | null;
  refunded_cents: number | null;
}

interface ItemRow {
  claim_id: string;
  discrepancy_id: string;
  status: string;
  claimed_cents: number;
  approved_cents: number | null;
}

export function getCase(scope: TenantScope, caseId: string): CaseRow {
  const row = scope.get<CaseRow>('SELECT * FROM dossier_cases WHERE tenant_id = :tenantId AND id = :caseId', { caseId });
  if (!row) throw notFound('Chamado não encontrado.');
  return row;
}

const itemsOf = (scope: TenantScope, caseId: string) =>
  scope.all<ItemRow>(
    `SELECT id AS claim_id, discrepancy_id, status, claimed_cents, approved_cents
       FROM claims WHERE tenant_id = :tenantId AND case_id = :caseId ORDER BY claimed_cents DESC`,
    { caseId },
  );

function addEvent(scope: TenantScope, caseId: string, at: string, actor: string, from: string | null, to: string, note?: string): void {
  scope.run(
    `INSERT INTO case_events (id, tenant_id, case_id, at, actor, from_status, to_status, note)
     VALUES (:id, :tenantId, :caseId, :at, :actor, :from, :to, :note)`,
    { id: randomUUID(), caseId, at, actor, from, to, note: note ?? null },
  );
}

/** Cria o chamado em rascunho a partir de um agrupamento de dossiê. Deve rodar em transação. */
export function createCase(scope: TenantScope, group: DossierGroup, actor: string): CaseRow {
  const at = nowIso();
  const { total } = scope.get<{ total: number }>('SELECT COUNT(*) AS total FROM dossier_cases WHERE tenant_id = :tenantId')!;
  const id = randomUUID();
  scope.run(
    `INSERT INTO dossier_cases (id, tenant_id, store_id, code, type, bucket_label, status, claimed_cents, created_at, updated_at)
     VALUES (:id, :tenantId, :storeId, :code, :type, :bucketLabel, 'RASCUNHO', :claimedCents, :at, :at)`,
    {
      id,
      storeId: group.storeId,
      code: `DOS-${String(total + 1).padStart(5, '0')}`,
      type: group.type,
      bucketLabel: group.bucketLabel,
      claimedCents: group.totalCents,
      at,
    },
  );
  for (const item of group.items) {
    const claim = openClaim(scope, item.id, actor, at, 'DRAFT');
    scope.run('UPDATE claims SET case_id = :caseId WHERE tenant_id = :tenantId AND id = :claimId', { caseId: id, claimId: claim.id });
  }
  addEvent(scope, id, at, actor, null, 'RASCUNHO', `Chamado criado com ${group.items.length} ocorrência(s).`);
  return getCase(scope, id);
}

export interface CaseTransition {
  actor: string;
  note?: string;
  /** Protocolo do marketplace; obrigatório ao abrir. */
  protocol?: string;
  /** Valor deferido por divergência, em centavos. Ausente = valor integral; zero = item indeferido. */
  items?: { discrepancyId: string; approvedCents: number }[];
}

/** Move o chamado e, junto com ele, todas as divergências vinculadas. Deve rodar em transação. */
export function transitionCase(scope: TenantScope, caseId: string, to: CaseStatus, options: CaseTransition): CaseRow {
  const current = getCase(scope, caseId);
  if (!TRANSITIONS[current.status].includes(to)) {
    throw conflict(`Não é possível mover o chamado de ${current.status} para ${to}.`, 'TRANSICAO_INVALIDA');
  }
  const at = nowIso();
  const items = itemsOf(scope, caseId);
  const move = (item: ItemRow, status: Parameters<typeof transitionClaim>[2], approvedCents?: number) =>
    transitionClaim(scope, item.claim_id, status, { actor: options.actor, at, approvedCents, marketplaceCaseId: current.protocol ?? options.protocol });

  let approvedTotal = current.approved_cents;
  let refundedTotal = current.refunded_cents;
  let protocol = current.protocol;
  let openedAt = current.opened_at;

  if (to === 'ABERTO') {
    protocol = options.protocol?.trim() || null;
    if (!protocol) throw badRequest('Informe o protocolo do marketplace para abrir o chamado.');
    openedAt = at;
    for (const item of items) move(item, 'SUBMITTED');
  } else if (to === 'EM_ANALISE') {
    for (const item of items) {
      if (item.status === 'DENIED') move(item, 'REOPENED');
      if (item.status !== 'UNDER_REVIEW') move(item, 'UNDER_REVIEW');
    }
    approvedTotal = null;
  } else if (to === 'DEFERIDO') {
    const decided = new Map((options.items ?? []).map((i) => [i.discrepancyId, i.approvedCents]));
    const unknown = [...decided.keys()].filter((id) => !items.some((item) => item.discrepancy_id === id));
    if (unknown.length) throw badRequest('Há itens na decisão que não pertencem a este chamado.');
    approvedTotal = 0;
    for (const item of items) {
      const approved = decided.get(item.discrepancy_id) ?? item.claimed_cents;
      if (approved < 0 || approved > item.claimed_cents) throw badRequest('O valor deferido de um item não pode passar do valor contestado.');
      approvedTotal += approved;
    }
    if (approvedTotal === 0) throw badRequest('Nenhum valor deferido: registre o chamado como indeferido.');
    for (const item of items) {
      const approved = decided.get(item.discrepancy_id) ?? item.claimed_cents;
      if (approved === 0) move(item, 'DENIED');
      else if (approved === item.claimed_cents) move(item, 'APPROVED');
      else move(item, 'PARTIALLY_APPROVED', approved);
    }
  } else if (to === 'INDEFERIDO') {
    for (const item of items) move(item, 'DENIED');
    approvedTotal = 0;
  } else if (to === 'PAGO') {
    // Só os itens deferidos são pagos; cada pagamento gera a linha de cobrança por sucesso.
    for (const item of items) if (item.status === 'APPROVED' || item.status === 'PARTIALLY_APPROVED') move(item, 'PAID');
    refundedTotal = approvedTotal;
  }

  scope.run(
    `UPDATE dossier_cases SET status = :to, protocol = :protocol, opened_at = :openedAt, approved_cents = :approved,
            refunded_cents = :refunded, updated_at = :at
      WHERE tenant_id = :tenantId AND id = :caseId`,
    { to, protocol, openedAt, approved: approvedTotal, refunded: refundedTotal, at, caseId },
  );
  addEvent(scope, caseId, at, options.actor, current.status, to, options.note);
  return getCase(scope, caseId);
}
