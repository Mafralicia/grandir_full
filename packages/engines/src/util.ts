import type { CatalogItem, Cents, DiscrepancyType, Reimbursement } from './types';

const DAY_MS = 86_400_000;

export const toMs = (iso: string): number => new Date(iso).getTime();

export const daysBetween = (fromIso: string, toIso: string): number =>
  Math.floor((toMs(toIso) - toMs(fromIso)) / DAY_MS);

export const addDays = (iso: string, days: number): string =>
  new Date(toMs(iso) + days * DAY_MS).toISOString();

export const mulUnits = (unitCents: Cents, quantity: number): Cents => Math.round(unitCents * quantity);

export type WindowState = 'PENDING' | 'ELIGIBLE' | 'EXPIRED';

/** Situa uma ocorrência em relação ao prazo de espera e à janela de contestação. */
export function claimWindow(
  occurredAt: string,
  asOf: string,
  waitDays: number,
  claimWindowDays: number,
): { state: WindowState; expiresAt: string } {
  const age = daysBetween(occurredAt, asOf);
  const expiresAt = addDays(occurredAt, claimWindowDays);
  if (age < waitDays) return { state: 'PENDING', expiresAt };
  if (age > claimWindowDays) return { state: 'EXPIRED', expiresAt };
  return { state: 'ELIGIBLE', expiresAt };
}

export function reimbursedUnits(
  reimbursements: Reimbursement[],
  type: DiscrepancyType,
  sku: string,
  referenceId?: string,
): number {
  let total = 0;
  for (const r of reimbursements) {
    if (r.type !== type || r.sku !== sku) continue;
    if (referenceId !== undefined && r.referenceId !== referenceId) continue;
    total += r.quantity;
  }
  return total;
}

export function catalogIndex(catalog: CatalogItem[]): Map<string, CatalogItem> {
  return new Map(catalog.map((item) => [item.sku, item]));
}

export const fingerprint = (type: DiscrepancyType, sku: string, referenceId: string): string =>
  `${type}:${sku}:${referenceId}`;

/**
 * Abate créditos (itens localizados ou já reembolsados) das ocorrências mais antigas
 * primeiro e devolve o que continua em aberto em cada uma.
 */
export function fifoOpen<T extends { id: string; date: string; quantity: number }>(
  events: T[],
  credits: number,
): { event: T; remaining: number }[] {
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const open: { event: T; remaining: number }[] = [];
  let left = Math.max(0, credits);
  for (const event of sorted) {
    const used = Math.min(left, event.quantity);
    left -= used;
    const remaining = event.quantity - used;
    if (remaining > 0) open.push({ event, remaining });
  }
  return open;
}

export const fmtDate = (iso: string): string => iso.slice(0, 10).split('-').reverse().join('/');
