import type { FindingDetails } from '../br/model';
import { brl } from '../br/tables';
import type { Cents, DiscrepancyType } from '../types';
import { fmtDate } from '../util';
import { MARKETPLACE_NAMES, REQUIRED_DOCUMENTS, TYPE_LABELS } from './labels';

/** Uma divergência em aberto, como o gerador de dossiês a recebe. */
export interface EvidenceItem {
  id: string;
  storeId: string;
  storeName: string;
  marketplace: string;
  type: DiscrepancyType;
  sku: string;
  productName: string;
  quantity: number;
  recoverableCents: Cents;
  occurredAt: string;
  deadlineAt: string | null;
  referenceId: string;
  evidence: string[];
  details: FindingDetails | null;
}

export interface DossierGroup {
  /** Chave estável do agrupamento: loja, tipo, lote ou período, e parte. */
  key: string;
  storeId: string;
  storeName: string;
  marketplace: string;
  type: DiscrepancyType;
  bucketLabel: string;
  items: EvidenceItem[];
  totalCents: Cents;
  earliestDeadline: string | null;
}

/** Tipos em que o lote de envio é a unidade natural de contestação. */
const LOT_TYPES = new Set<DiscrepancyType>(['ERP_INBOUND_GAP', 'ML_WAREHOUSE_LOSS', 'ML_WAREHOUSE_DAMAGE', 'INBOUND_SHORTAGE']);
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function bucketOf(item: EvidenceItem): { id: string; label: string } {
  const lot = item.details?.ids.inboundId;
  if (lot && LOT_TYPES.has(item.type)) return { id: `lote-${lot}`, label: `lote de envio ${lot}` };
  const [year, month] = item.occurredAt.slice(0, 7).split('-');
  return { id: `${year}-${month}`, label: `${MONTHS[Number(month) - 1]} de ${year}` };
}

/**
 * Agrupamento inteligente: consolida divergências da mesma loja e do mesmo tipo por lote
 * de envio ou por mês, para abrir um chamado por assunto em vez de dezenas de chamados
 * repetidos — o que os marketplaces tratam como abuso do canal de suporte.
 */
export function groupForDossiers(items: EvidenceItem[], maxItemsPerDossier = 40): DossierGroup[] {
  const buckets = new Map<string, { label: string; items: EvidenceItem[] }>();
  for (const item of items) {
    const bucket = bucketOf(item);
    const key = [item.storeId, item.type, bucket.id].join('~');
    const entry = buckets.get(key);
    if (entry) entry.items.push(item);
    else buckets.set(key, { label: bucket.label, items: [item] });
  }

  const groups: DossierGroup[] = [];
  for (const [key, bucket] of buckets) {
    const sorted = bucket.items.sort((a, b) => b.recoverableCents - a.recoverableCents || a.id.localeCompare(b.id));
    const parts = Math.ceil(sorted.length / maxItemsPerDossier);
    for (let part = 0; part < parts; part++) {
      const slice = sorted.slice(part * maxItemsPerDossier, (part + 1) * maxItemsPerDossier);
      const deadlines = slice.map((i) => i.deadlineAt).filter((d): d is string => d !== null).sort();
      groups.push({
        key: `${key}~${part + 1}`,
        storeId: slice[0].storeId,
        storeName: slice[0].storeName,
        marketplace: slice[0].marketplace,
        type: slice[0].type,
        bucketLabel: parts > 1 ? `${bucket.label} (parte ${part + 1} de ${parts})` : bucket.label,
        items: slice,
        totalCents: slice.reduce((sum, i) => sum + i.recoverableCents, 0),
        earliestDeadline: deadlines[0] ?? null,
      });
    }
  }
  return groups.sort((a, b) => b.totalCents - a.totalCents || a.key.localeCompare(b.key));
}

export interface Dossier extends DossierGroup {
  company: string;
  generatedAt: string;
  typeLabel: string;
  marketplaceName: string;
  subject: string;
  /** Texto pronto para colar na central de ajuda do marketplace. */
  ticketText: string;
  /** Alertas para o seller conferir antes de enviar; não fazem parte do texto do chamado. */
  warnings: string[];
  /** Documentos que costumam ser exigidos para este tipo de divergência. */
  requiredDocuments: string[];
}

const ID_FIELDS: [keyof FindingDetails['ids'], string][] = [
  ['orderId', 'Pedido'],
  ['shipmentId', 'Envio'],
  ['trackingCode', 'Rastreio'],
  ['itemId', 'Anúncio'],
  ['ean', 'EAN'],
  ['nfeKey', 'NF-e'],
  ['inboundId', 'Lote'],
];

/** Identificadores do item em uma linha: "Pedido 123 | Envio 456 | SKU ABC | …". */
export function identifiers(item: EvidenceItem): string {
  const ids = item.details?.ids ?? {};
  const parts = ID_FIELDS.filter(([field]) => ids[field]).map(([field, label]) => `${label} ${ids[field]}`);
  parts.splice(Math.min(parts.length, 3), 0, `SKU ${item.sku}`);
  if (!item.details) parts.push(`Ref. ${item.referenceId}`);
  return parts.join(' | ');
}

const TEXT_ITEM_LIMIT = 15;

export function buildDossier(group: DossierGroup, company: string, generatedAt: string): Dossier {
  const typeLabel = TYPE_LABELS[group.type] ?? group.type;
  const marketplaceName = MARKETPLACE_NAMES[group.marketplace] ?? group.marketplace;
  const count = group.items.length;
  const plural = count === 1 ? 'ocorrência' : 'ocorrências';
  const subject = `Solicitação de reembolso — ${typeLabel} — ${group.bucketLabel} (${count} ${plural}, ${brl(group.totalCents)})`;
  const policy = group.items.find((i) => i.details)?.details?.policy;

  const lines: string[] = [
    `Assunto: ${subject}`,
    '',
    `Olá, equipe ${marketplaceName}.`,
    '',
    `Somos a ${company} (loja ${group.storeName}). Em auditoria da nossa operação identificamos ${count} ${plural} de "${typeLabel}" referente${count === 1 ? '' : 's'} a ${group.bucketLabel}, que ${count === 1 ? 'soma' : 'somam'} ${brl(group.totalCents)} a restituir.`,
    '',
  ];
  if (policy) lines.push(`Fundamento: ${policy}`, '');
  lines.push(count === 1 ? 'Detalhe da ocorrência:' : 'Resumo das ocorrências:');

  group.items.slice(0, TEXT_ITEM_LIMIT).forEach((item, index) => {
    lines.push(`${index + 1}. ${identifiers(item)}`);
    lines.push(`   ${item.productName} — ${item.quantity} un. — ocorrência em ${fmtDate(item.occurredAt)} — a recuperar ${brl(item.recoverableCents)}`);
    const calc = item.details?.calc ?? item.evidence;
    if (calc.length) lines.push(`   Memória de cálculo: ${calc.join(' ')}`);
  });
  if (count > TEXT_ITEM_LIMIT) {
    lines.push(`… e mais ${count - TEXT_ITEM_LIMIT} ocorrências, todas detalhadas na planilha anexa.`);
  }

  lines.push(
    '',
    `Solicitamos ${count === 1 ? 'a análise do caso acima' : 'a análise conjunta dos casos acima'} e o crédito de ${brl(group.totalCents)} na nossa conta.`,
  );
  if (group.earliestDeadline) {
    lines.push(`O prazo de contestação mais próximo vence em ${fmtDate(group.earliestDeadline)}; por isso pedimos prioridade.`);
  }
  lines.push(
    '',
    'Anexos: planilha com todas as ocorrências (identificadores, valores e memória de cálculo) e dossiê em PDF com a trilha cronológica de cada caso. Notas fiscais e comprovantes estão à disposição.',
    '',
    'Ficamos no aguardo. Obrigado.',
    company,
  );

  const unverified = [...new Set(group.items.map((i) => i.details?.tariff).filter((t) => t && !t.verified).map((t) => t!.id))];
  const warnings = unverified.length
    ? [`A tabela de tarifas usada no cálculo (${unverified.join(', ')}) não foi confirmada na fonte oficial do marketplace. Confira os valores antes de enviar o chamado.`]
    : [];
  return { ...group, company, generatedAt, typeLabel, marketplaceName, subject, ticketText: lines.join('\n'), warnings, requiredDocuments: REQUIRED_DOCUMENTS[group.type] ?? [] };
}

export const DOSSIER_COLUMNS = [
  'Tipo', 'Marketplace', 'Pedido', 'Envio', 'Rastreio', 'SKU', 'Anúncio (MLB / Item ID)', 'EAN', 'Chave NF-e', 'Lote',
  'Produto', 'Qtd.', 'Ocorrência', 'Prazo de contestação', 'Valor de referência (R$)', 'Valor creditado ou correto (R$)',
  'A recuperar (R$)', 'Regra aplicável', 'Memória de cálculo',
] as const;

/** Linhas tabulares do dossiê, compartilhadas pelas exportações CSV e XLSX. */
export function dossierRows(dossier: Dossier): (string | number)[][] {
  return dossier.items.map((item) => {
    const ids = item.details?.ids ?? {};
    const reais = (cents: number | undefined) => (cents === undefined ? '' : cents / 100);
    return [
      dossier.typeLabel,
      dossier.marketplaceName,
      ids.orderId ?? '',
      ids.shipmentId ?? '',
      ids.trackingCode ?? '',
      item.sku,
      ids.itemId ?? '',
      ids.ean ?? '',
      ids.nfeKey ?? '',
      ids.inboundId ?? (item.details ? '' : item.referenceId),
      item.productName,
      item.quantity,
      fmtDate(item.occurredAt),
      item.deadlineAt ? fmtDate(item.deadlineAt) : '',
      reais(item.details?.expectedCents),
      reais(item.details?.actualCents),
      item.recoverableCents / 100,
      item.details?.policy ?? '',
      (item.details?.calc ?? item.evidence).join(' '),
    ];
  });
}

/** Neutraliza células que uma planilha interpretaria como fórmula. */
export const safeCell = (value: string): string => (/^[=+\-@\t\r]/.test(value) ? `'${value}` : value);

/** CSV no padrão brasileiro: separador ponto e vírgula, decimal com vírgula, BOM para o Excel. */
export function dossierCsv(dossier: Dossier): string {
  const cell = (value: string | number) => {
    const text = typeof value === 'number' ? value.toLocaleString('pt-BR', { useGrouping: false, maximumFractionDigits: 2 }) : safeCell(value);
    return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const rows = [[...DOSSIER_COLUMNS], ...dossierRows(dossier)];
  return '﻿' + rows.map((row) => row.map(cell).join(';')).join('\r\n') + '\r\n';
}
