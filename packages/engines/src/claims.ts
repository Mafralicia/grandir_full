export const CLAIM_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'NEEDS_DOCUMENTS',
  'APPROVED',
  'PARTIALLY_APPROVED',
  'DENIED',
  'REOPENED',
  'PAID',
  'CLOSED',
] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/** Ciclo de vida de um chamado de disputa junto ao marketplace. */
const TRANSITIONS: Record<ClaimStatus, readonly ClaimStatus[]> = {
  DRAFT: ['SUBMITTED', 'CLOSED'],
  SUBMITTED: ['UNDER_REVIEW', 'NEEDS_DOCUMENTS', 'CLOSED'],
  UNDER_REVIEW: ['NEEDS_DOCUMENTS', 'APPROVED', 'PARTIALLY_APPROVED', 'DENIED'],
  NEEDS_DOCUMENTS: ['UNDER_REVIEW', 'CLOSED'],
  APPROVED: ['PAID'],
  PARTIALLY_APPROVED: ['PAID', 'REOPENED'],
  DENIED: ['REOPENED', 'CLOSED'],
  REOPENED: ['UNDER_REVIEW', 'CLOSED'],
  PAID: [],
  CLOSED: [],
};

export const nextStatuses = (from: ClaimStatus): readonly ClaimStatus[] => TRANSITIONS[from];

export const canTransition = (from: ClaimStatus, to: ClaimStatus): boolean => TRANSITIONS[from].includes(to);

/** Chamados que ainda dependem de ação da Grandir, do seller ou do marketplace. */
export const ACTIVE_STATUSES: readonly ClaimStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'NEEDS_DOCUMENTS',
  'REOPENED',
];

export const WON_STATUSES: readonly ClaimStatus[] = ['APPROVED', 'PARTIALLY_APPROVED', 'PAID'];

export const isTerminal = (status: ClaimStatus): boolean => TRANSITIONS[status].length === 0;
