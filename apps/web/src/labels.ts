export type Tone = 'neutral' | 'info' | 'warn' | 'success' | 'danger';

export const TYPE_LABEL: Record<string, string> = {
  LOST_WAREHOUSE: 'Perda em armazém',
  DAMAGED_WAREHOUSE: 'Dano em armazém',
  DISPOSED_SELLABLE: 'Descarte indevido',
  TRANSFER_LOST: 'Perda em transferência',
  INBOUND_SHORTAGE: 'Falta em remessa',
  REMOVAL_NOT_RECEIVED: 'Remoção não entregue',
  FEE_OVERCHARGE: 'Tarifa cobrada a maior',
  RETURN_NOT_RECEIVED: 'Devolução não recebida',
};

export const CLAIM_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Rascunho', tone: 'neutral' },
  SUBMITTED: { label: 'Enviado', tone: 'info' },
  UNDER_REVIEW: { label: 'Em análise', tone: 'info' },
  NEEDS_DOCUMENTS: { label: 'Aguardando documentos', tone: 'warn' },
  APPROVED: { label: 'Aprovado', tone: 'success' },
  PARTIALLY_APPROVED: { label: 'Aprovado parcialmente', tone: 'success' },
  DENIED: { label: 'Negado', tone: 'danger' },
  REOPENED: { label: 'Reaberto', tone: 'warn' },
  PAID: { label: 'Pago', tone: 'success' },
  CLOSED: { label: 'Encerrado', tone: 'neutral' },
};

export const DISCREPANCY_STATUS: Record<string, { label: string; tone: Tone }> = {
  OPEN: { label: 'Em aberto', tone: 'warn' },
  CLAIMED: { label: 'Em disputa', tone: 'info' },
  RESOLVED: { label: 'Resolvida', tone: 'success' },
  DISMISSED: { label: 'Descartada', tone: 'neutral' },
};

export const ROLE_LABEL: Record<string, string> = {
  OWNER: 'Titular',
  ADMIN: 'Administrador',
  ANALYST: 'Analista',
  VIEWER: 'Leitor',
};

export const MARKETPLACE_LABEL: Record<string, string> = {
  amazon: 'Amazon FBA',
  mercadolivre: 'Mercado Livre Full',
  shopee: 'Shopee Fulfillment',
  magalu: 'Magalu Fulfillment',
};

export const DOCUMENT_KIND: Record<string, string> = {
  NOTA_FISCAL: 'Nota fiscal de compra',
  COMPROVANTE_ENTREGA: 'Comprovante de entrega',
  OUTRO: 'Outro documento',
};

export const ACTIVITY_LABEL: Record<string, string> = {
  CONTA_CRIADA: 'Conta criada',
  LOGIN: 'Entrada na conta',
  CONTA_BLOQUEADA_TEMPORARIAMENTE: 'Conta bloqueada por tentativas',
  REDEFINICAO_SOLICITADA: 'Redefinição de senha solicitada',
  SENHA_REDEFINIDA: 'Senha redefinida',
  SENHA_ALTERADA: 'Senha alterada',
  OUTRAS_SESSOES_ENCERRADAS: 'Outras sessões encerradas',
  MFA_ATIVADO: 'Verificação em duas etapas ativada',
  MFA_DESATIVADO: 'Verificação em duas etapas desativada',
  LOJA_CONECTADA: 'Loja conectada',
  AUDITORIA_EXECUTADA: 'Auditoria executada',
  CHAMADO_ABERTO: 'Chamado aberto',
  CHAMADOS_ABERTOS_EM_LOTE: 'Chamados abertos em lote',
  DIVERGENCIA_DESCARTADA: 'Divergência descartada',
  DOCUMENTO_ENVIADO: 'Documento enviado',
  DOCUMENTO_BAIXADO: 'Documento baixado',
  MEMBRO_CONVIDADO: 'Membro convidado',
  MEMBRO_ALTERADO: 'Acesso de membro alterado',
};

export const activityLabel = (action: string): string => {
  if (ACTIVITY_LABEL[action]) return ACTIVITY_LABEL[action];
  const status = action.startsWith('CHAMADO_') ? CLAIM_STATUS[action.slice(8)] : undefined;
  return status ? `Chamado → ${status.label}` : action;
};

let currency = 'BRL';
export const setCurrency = (code: string) => {
  currency = code;
};

export const money = (cents: number | null | undefined): string =>
  cents == null ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(cents / 100);

export const moneyShort = (cents: number): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(cents / 100);

export const integer = (value: number): string => new Intl.NumberFormat('pt-BR').format(value);

export const percent = (ratio: number | null): string =>
  ratio == null ? '—' : new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 0 }).format(ratio);

export const date = (iso: string | null | undefined): string =>
  iso ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(iso)) : '—';

export const dateTime = (iso: string): string =>
  new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/** '2026-05' → 'mai/26' */
export const monthLabel = (period: string): string => {
  const [year, month] = period.split('-').map(Number);
  const name = new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 1)));
  return `${name.replace('.', '')}/${String(year).slice(2)}`;
};

export const fileSize = (bytes: number): string =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
