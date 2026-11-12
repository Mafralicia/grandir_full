export type Tone = 'neutral' | 'info' | 'warn' | 'success' | 'danger' | 'purple';

/** Classes do sistema de quatro cores (ver styles.css). */
export type ToneClass = 't-gold' | 't-blue' | 't-purple' | 't-green';

/** Cada tipo de divergência pertence a uma categoria, e cada categoria tem uma cor fixa. */
export const TYPE_CATEGORY: Record<string, { label: string; tone: ToneClass }> = {
  LOST_WAREHOUSE: { label: 'Estoque', tone: 't-blue' },
  DAMAGED_WAREHOUSE: { label: 'Estoque', tone: 't-blue' },
  DISPOSED_SELLABLE: { label: 'Estoque', tone: 't-blue' },
  TRANSFER_LOST: { label: 'Logística', tone: 't-purple' },
  INBOUND_SHORTAGE: { label: 'Logística', tone: 't-purple' },
  REMOVAL_NOT_RECEIVED: { label: 'Logística', tone: 't-purple' },
  FEE_OVERCHARGE: { label: 'Tarifas', tone: 't-gold' },
  RETURN_NOT_RECEIVED: { label: 'Devoluções', tone: 't-green' },
  ML_WAREHOUSE_LOSS: { label: 'Estoque', tone: 't-blue' },
  ML_WAREHOUSE_DAMAGE: { label: 'Estoque', tone: 't-blue' },
  ERP_INBOUND_GAP: { label: 'Estoque', tone: 't-blue' },
  ML_TRANSIT_LOSS: { label: 'Logística', tone: 't-purple' },
  SHOPEE_LOST_NO_CREDIT: { label: 'Logística', tone: 't-purple' },
  ML_FREIGHT_OVERCHARGE: { label: 'Tarifas', tone: 't-gold' },
  SHOPEE_FREIGHT_OVERCHARGE: { label: 'Tarifas', tone: 't-gold' },
  ML_COMMISSION_OVERCHARGE: { label: 'Tarifas', tone: 't-gold' },
  ML_RETURN_NOT_RESTOCKED: { label: 'Devoluções', tone: 't-green' },
  ML_RETURN_DAMAGED: { label: 'Devoluções', tone: 't-green' },
  SHOPEE_PAYOUT_SHORTFALL: { label: 'Repasses', tone: 't-green' },
  ERP_UNSETTLED_SALE: { label: 'Repasses', tone: 't-green' },
};

export const TYPE_LABEL: Record<string, string> = {
  LOST_WAREHOUSE: 'Perda em armazém',
  DAMAGED_WAREHOUSE: 'Dano em armazém',
  DISPOSED_SELLABLE: 'Descarte indevido',
  TRANSFER_LOST: 'Perda em transferência',
  INBOUND_SHORTAGE: 'Falta em remessa',
  REMOVAL_NOT_RECEIVED: 'Remoção não entregue',
  FEE_OVERCHARGE: 'Tarifa cobrada a maior',
  RETURN_NOT_RECEIVED: 'Devolução não recebida',
  ML_WAREHOUSE_LOSS: 'Extravio no centro de distribuição',
  ML_WAREHOUSE_DAMAGE: 'Avaria no centro de distribuição',
  ML_TRANSIT_LOSS: 'Extravio em trânsito',
  ML_FREIGHT_OVERCHARGE: 'Frete por peso cubado indevido',
  ML_RETURN_NOT_RESTOCKED: 'Devolução sem retorno do produto',
  ML_RETURN_DAMAGED: 'Devolução com produto avariado',
  ML_COMMISSION_OVERCHARGE: 'Comissão ou tarifa acima da regra',
  SHOPEE_LOST_NO_CREDIT: 'Pedido extraviado sem crédito',
  SHOPEE_PAYOUT_SHORTFALL: 'Repasse menor que o esperado',
  SHOPEE_FREIGHT_OVERCHARGE: 'Frete por cubagem indevida',
  ERP_INBOUND_GAP: 'Furo de inventário no recebimento',
  ERP_UNSETTLED_SALE: 'Venda faturada sem repasse',
};

export const CLAIM_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Rascunho', tone: 'neutral' },
  SUBMITTED: { label: 'Enviado', tone: 'info' },
  UNDER_REVIEW: { label: 'Em análise', tone: 'info' },
  NEEDS_DOCUMENTS: { label: 'Aguardando documentos', tone: 'warn' },
  APPROVED: { label: 'Aprovado', tone: 'success' },
  PARTIALLY_APPROVED: { label: 'Aprovado parcialmente', tone: 'success' },
  DENIED: { label: 'Negado', tone: 'danger' },
  REOPENED: { label: 'Reaberto', tone: 'purple' },
  PAID: { label: 'Pago', tone: 'success' },
  CLOSED: { label: 'Encerrado', tone: 'neutral' },
};

export const CASE_STATUS: Record<string, { label: string; tone: Tone }> = {
  RASCUNHO: { label: 'Rascunho', tone: 'neutral' },
  ABERTO: { label: 'Aberto', tone: 'info' },
  EM_ANALISE: { label: 'Em análise', tone: 'info' },
  DEFERIDO: { label: 'Deferido', tone: 'success' },
  INDEFERIDO: { label: 'Indeferido', tone: 'danger' },
  PAGO: { label: 'Pago', tone: 'success' },
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
  DOSSIE_EXPORTADO: 'Dossiê exportado',
  NFE_IMPORTADAS: 'XML de NF-e importados',
  CONTA_DE_MARKETPLACE_CONECTADA: 'Conta de marketplace conectada',
  PLANILHA_ERP_IMPORTADA: 'Planilha do ERP importada',
};

export const activityLabel = (action: string): string => {
  if (ACTIVITY_LABEL[action]) return ACTIVITY_LABEL[action];
  const caseStatus = action.startsWith('CHAMADO_DE_DOSSIE_') ? CASE_STATUS[action.slice(18)] : undefined;
  if (caseStatus) return `Chamado de dossiê → ${caseStatus.label}`;
  if (action === 'CHAMADO_DE_DOSSIE_CRIADO') return 'Chamado de dossiê criado';
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
