import type { BrMarketplace, IncidentKind, LogisticsIncident, MarketplaceOrder, ReturnCase, WarehouseReceipt } from '@grandir/engines';
import type { Table } from './tabular';

/**
 * O que a auditoria precisa de cada tipo de relatório. O seller diz qual coluna do
 * arquivo dele corresponde a cada campo — o importador não depende do formato de
 * nenhum relatório específico, só dos campos abaixo.
 */
export const IMPORT_KINDS = ['orders', 'incidents', 'returns', 'receipts'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

type FieldType = 'text' | 'int' | 'money' | 'date' | 'weightKg';

export interface FieldSpec {
  key: string;
  label: string;
  required: boolean;
  hint: string;
  type: FieldType;
  /** Nomes de coluna que costumam trazer este dado, para a sugestão automática. */
  aliases: string[];
}

interface KindSpec {
  label: string;
  description: string;
  fields: FieldSpec[];
}

const f = (key: string, label: string, type: FieldType, required: boolean, hint: string, aliases: string[]): FieldSpec => ({ key, label, type, required, hint, aliases });

export const KIND_SPECS: Record<ImportKind, KindSpec> = {
  orders: {
    label: 'Vendas, tarifas e repasses',
    description: 'Relatório de vendas ou extrato financeiro exportado do painel do seller: uma linha por item vendido, com o que foi cobrado e o que foi repassado.',
    fields: [
      f('orderId', 'Número do pedido', 'text', true, 'Identificador do pedido ou da venda no marketplace.', ['n.º de venda', 'no de venda', 'numero da venda', 'numero do pedido', 'id do pedido', 'pedido', 'order id', 'order_sn', 'venda']),
      f('saleDate', 'Data da venda', 'date', true, 'Data em que o pedido foi feito.', ['data da venda', 'data de criacao do pedido', 'data do pedido', 'data de criacao', 'data', 'order creation date']),
      f('sku', 'SKU', 'text', true, 'Código do produto, igual ao do seu ERP.', ['sku', 'numero de referencia sku', 'sku da variacao', 'codigo do produto', 'seller sku', 'sku reference no.']),
      f('quantity', 'Quantidade', 'int', true, 'Unidades vendidas na linha.', ['unidades', 'quantidade', 'qtd', 'qtde']),
      f('grossCents', 'Valor da venda', 'money', true, 'Valor total dos produtos da linha, antes de tarifas.', ['receita por produtos (brl)', 'receita por produtos', 'valor total', 'subtotal do produto', 'valor da venda', 'total do pedido', 'preco total', 'product subtotal']),
      f('commissionCents', 'Comissão cobrada', 'money', false, 'Tarifa de venda ou comissão debitada.', ['tarifa de venda e impostos', 'tarifa de venda', 'taxa de comissao', 'comissao', 'taxa de servico']),
      f('feeCents', 'Tarifa fixa ou taxa de transação', 'money', false, 'Custo fixo por unidade ou taxa de transação, se vier separado.', ['custo fixo', 'tarifa fixa', 'taxa de transacao']),
      f('shippingChargedCents', 'Frete cobrado do seller', 'money', false, 'Valor do envio debitado de você.', ['tarifas de envio', 'custo de envio', 'frete', 'taxa de envio', 'valor do frete']),
      f('billedWeightKg', 'Peso cobrado (kg)', 'weightKg', false, 'Peso que o marketplace usou para calcular o frete.', ['peso cobrado', 'peso tarifado', 'peso cubado', 'peso (kg)', 'peso']),
      f('settledCents', 'Valor repassado', 'money', false, 'Valor líquido efetivamente creditado.', ['total (brl)', 'valor liquido', 'valor a receber', 'valor repassado', 'renda do pedido', 'valor liberado']),
      f('settledAt', 'Data do repasse', 'date', false, 'Data em que o dinheiro foi liberado.', ['data de liberacao', 'data do repasse', 'data de pagamento', 'data de conclusao do pagamento']),
      f('itemId', 'Código do anúncio', 'text', false, 'MLB no Mercado Livre, Item ID na Shopee.', ['n.º de anuncio', 'no de anuncio', 'id do anuncio', 'mlb', 'item id', 'id do item']),
      f('shipmentId', 'Código do envio', 'text', false, 'Identificador do envio ou do pacote.', ['id do envio', 'n.º do envio', 'numero do envio', 'numero do pacote']),
      f('trackingCode', 'Código de rastreio', 'text', false, 'Rastreamento da transportadora.', ['numero de rastreamento', 'codigo de rastreio', 'rastreio', 'rastreamento', 'tracking']),
      f('categoryId', 'Categoria', 'text', false, 'Categoria do anúncio; usada para conferir a comissão.', ['categoria', 'id da categoria', 'category']),
      f('listingType', 'Tipo de anúncio', 'text', false, 'Clássico ou Premium (Mercado Livre).', ['tipo de anuncio', 'tipo de publicacao', 'listing type']),
    ],
  },
  incidents: {
    label: 'Extravios e avarias',
    description: 'Ocorrências de perda ou dano sob responsabilidade do marketplace: no centro de distribuição, em trânsito ou na logística reversa.',
    fields: [
      f('id', 'Código da ocorrência', 'text', true, 'Identificador da ocorrência ou do caso.', ['id da ocorrencia', 'ocorrencia', 'id', 'codigo', 'caso']),
      f('kind', 'Tipo de ocorrência', 'text', true, 'Texto que indique extravio ou avaria, e onde (armazém, trânsito, reversa).', ['tipo', 'motivo', 'tipo de ocorrencia', 'status', 'descricao']),
      f('sku', 'SKU', 'text', true, 'Código do produto.', ['sku', 'codigo do produto']),
      f('quantity', 'Quantidade', 'int', true, 'Unidades afetadas.', ['quantidade', 'unidades', 'qtd']),
      f('occurredAt', 'Data da ocorrência', 'date', true, 'Quando a perda ou o dano foi registrado.', ['data da ocorrencia', 'data', 'data do evento']),
      f('orderId', 'Número do pedido', 'text', false, 'Se a ocorrência é de um pedido já vendido.', ['pedido', 'numero do pedido', 'n.º de venda', 'order id']),
      f('inboundId', 'Lote de envio', 'text', false, 'Se a ocorrência é de um lote enviado ao centro de distribuição.', ['lote', 'envio full', 'inbound', 'id do envio']),
      f('compensatedCents', 'Indenização já recebida', 'money', false, 'Quanto o marketplace já creditou por esta ocorrência.', ['indenizacao', 'valor reembolsado', 'valor creditado', 'compensacao', 'reembolso']),
    ],
  },
  returns: {
    label: 'Devoluções e mediações',
    description: 'Devoluções e reclamações encerradas: quem ganhou, quanto foi devolvido ao comprador e se o produto voltou.',
    fields: [
      f('id', 'Código da devolução', 'text', true, 'Identificador da devolução, reclamação ou mediação.', ['id da reclamacao', 'reclamacao', 'id da devolucao', 'devolucao', 'mediacao', 'id']),
      f('orderId', 'Número do pedido', 'text', true, 'Pedido ao qual a devolução se refere.', ['pedido', 'numero do pedido', 'n.º de venda', 'order id']),
      f('sku', 'SKU', 'text', true, 'Código do produto.', ['sku', 'codigo do produto']),
      f('quantity', 'Quantidade', 'int', true, 'Unidades devolvidas.', ['quantidade', 'unidades', 'qtd']),
      f('closedAt', 'Data de encerramento', 'date', true, 'Quando a devolução ou mediação foi encerrada.', ['data de encerramento', 'data de fechamento', 'data de conclusao', 'data']),
      f('refundedToBuyerCents', 'Valor devolvido ao comprador', 'money', true, 'Quanto foi reembolsado ao comprador.', ['valor reembolsado', 'valor devolvido', 'reembolso ao comprador', 'valor do reembolso']),
      f('resolution', 'A favor de quem', 'text', false, 'Texto que indique comprador ou vendedor. Em branco = comprador.', ['resolucao', 'resultado', 'a favor de', 'decisao']),
      f('returnedToStock', 'Produto voltou?', 'text', false, 'Sim ou não. Em branco = não voltou.', ['produto devolvido', 'retornou', 'devolvido ao estoque', 'status da devolucao']),
      f('returnedCondition', 'Condição do produto', 'text', false, 'Texto que indique se voltou em bom estado ou avariado.', ['condicao', 'estado do produto', 'condicao do produto']),
      f('compensatedCents', 'Valor já restituído ao seller', 'money', false, 'Quanto o marketplace já devolveu a você.', ['valor restituido', 'indenizacao', 'compensacao', 'valor creditado']),
    ],
  },
  receipts: {
    label: 'Recebimento de lotes no centro de distribuição',
    description: 'Conferência dos envios ao fulfillment: quantas unidades o centro de distribuição recebeu de cada lote. Cruza com as NF-e de remessa.',
    fields: [
      f('inboundId', 'Lote de envio', 'text', true, 'Número do envio ao centro de distribuição — o mesmo informado no pedido (xPed) da NF-e de remessa.', ['lote', 'envio', 'id do envio', 'numero do envio', 'inbound']),
      f('sku', 'SKU', 'text', true, 'Código do produto.', ['sku', 'codigo do produto']),
      f('receivedQty', 'Unidades recebidas', 'int', true, 'Quantidade conferida no centro de distribuição.', ['unidades recebidas', 'quantidade recebida', 'recebido', 'recebidas']),
      f('receivedAt', 'Data do recebimento', 'date', true, 'Quando o lote foi conferido.', ['data de recebimento', 'data da conferencia', 'data de entrada', 'data']),
    ],
  },
};

export const normalize = (text: string): string =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Palpite de coluna para cada campo: nome igual a um apelido, depois nome que contém o apelido. */
export function suggestMapping(kind: ImportKind, headers: string[]): Record<string, string | null> {
  const available = headers.filter(Boolean).map((header) => ({ header, name: normalize(header) }));
  const taken = new Set<string>();
  const result: Record<string, string | null> = {};
  for (const exact of [true, false]) {
    for (const field of KIND_SPECS[kind].fields) {
      if (result[field.key]) continue;
      const aliases = field.aliases.map(normalize);
      const match = available.find((h) => !taken.has(h.header) && aliases.some((alias) => (exact ? h.name === alias : h.name.includes(alias))));
      result[field.key] = match?.header ?? null;
      if (match) taken.add(match.header);
    }
  }
  return result;
}

// ───────────── Conversão de valores ─────────────

/** "R$ 1.234,56", "1234.56", "-12,5" → centavos (sempre o valor absoluto: tarifas vêm negativas em extratos). */
export function parseMoney(raw: string): number | null {
  const text = raw.replace(/[R$\s ]/g, '');
  if (!text) return null;
  // Com os dois separadores, o último é o decimal: "1.234,56" (brasileiro) e "1,234.56" (americano,
  // que aparece em algumas exportações da Shopee) dão o mesmo valor.
  const comma = text.lastIndexOf(',');
  const dot = text.lastIndexOf('.');
  const normalized = comma > dot ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
  const value = Number(normalized);
  return Number.isFinite(value) ? Math.abs(Math.round(value * 100)) : null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Aceita dd/mm/aaaa (com hora opcional), aaaa-mm-dd, ISO e número de série do Excel. Horário de Brasília. */
export function parseDate(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  let match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T]+(\d{1,2}):(\d{2}))?/.exec(text);
  if (match) return toIso(Number(match[3]), Number(match[2]), Number(match[1]), Number(match[4] ?? 12), Number(match[5] ?? 0));
  match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec(text);
  if (match) return toIso(Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4] ?? 12), Number(match[5] ?? 0));
  if (/^\d{5}(\.\d+)?$/.test(text)) {
    // Número de série do Excel: dias desde 30/12/1899.
    const date = new Date(Date.UTC(1899, 11, 30) + Number(text) * 86_400_000);
    return toIso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours() || 12, date.getUTCMinutes());
  }
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function toIso(year: number, month: number, day: number, hour: number, minute: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > 2100) return null;
  const date = new Date(`${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00-03:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function convert(field: FieldSpec, raw: string): { value: string | number | null; ok: boolean } {
  const text = raw.trim();
  if (!text) return { value: null, ok: true };
  if (field.type === 'text') return { value: text, ok: true };
  if (field.type === 'money') { const value = parseMoney(text); return { value, ok: value !== null }; }
  if (field.type === 'date') { const value = parseDate(text); return { value, ok: value !== null }; }
  const number = Number(text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text);
  if (!Number.isFinite(number) || number < 0) return { value: null, ok: false };
  return { value: field.type === 'weightKg' ? Math.round(number * 1000) : Math.round(number), ok: true };
}

const yes = (text: string) => /^(s|sim|yes|y|true|1|devolvido|retornou|recebido)/.test(normalize(text));

function incidentKind(text: string): IncidentKind {
  const name = normalize(text);
  const damage = /avari|dano|danific|quebr/.test(name);
  if (/revers|devolu/.test(name)) return 'REVERSE_LOSS';
  if (/transit|transporte|entrega|transportadora|caminho/.test(name)) return 'TRANSIT_LOSS';
  return damage ? 'WAREHOUSE_DAMAGE' : 'WAREHOUSE_LOSS';
}

export type ImportedRecord = MarketplaceOrder | LogisticsIncident | ReturnCase | WarehouseReceipt;

export interface MapResult {
  records: { key: string; record: ImportedRecord }[];
  errors: { line: number; reason: string }[];
}

/** Aplica o mapeamento de colunas a cada linha e devolve os registros no modelo do motor. */
export function mapRows(kind: ImportKind, table: Table, mapping: Record<string, string>, marketplace: BrMarketplace): MapResult {
  const spec = KIND_SPECS[kind];
  const column = new Map(table.headers.map((header, index) => [header, index]));
  const missing = spec.fields.filter((field) => field.required && !column.has(mapping[field.key] ?? ''));
  if (missing.length) {
    return { records: [], errors: [{ line: 1, reason: `Mapeie as colunas obrigatórias: ${missing.map((field) => field.label).join(', ')}.` }] };
  }

  const result: MapResult = { records: [], errors: [] };
  table.rows.forEach((row, index) => {
    const line = index + 2;
    const values: Record<string, string | number | null> = {};
    for (const field of spec.fields) {
      const position = column.get(mapping[field.key] ?? '');
      const converted = position === undefined ? { value: null, ok: true } : convert(field, row[position] ?? '');
      if (!converted.ok) return void result.errors.push({ line, reason: `Valor inválido em "${field.label}": ${(row[position!] ?? '').slice(0, 40)}` });
      if (field.required && (converted.value === null || converted.value === '')) return void result.errors.push({ line, reason: `"${field.label}" está vazio.` });
      values[field.key] = converted.value;
    }
    const text = (key: string) => (values[key] as string | null) ?? '';
    const number = (key: string) => (values[key] as number | null) ?? 0;

    if (kind === 'orders') {
      const quantity = number('quantity');
      if (quantity < 1) return void result.errors.push({ line, reason: 'Quantidade deve ser pelo menos 1.' });
      const record: MarketplaceOrder = {
        marketplace, orderId: text('orderId'), shipmentId: text('shipmentId'), trackingCode: text('trackingCode'), itemId: text('itemId'), sku: text('sku'),
        quantity, saleDate: text('saleDate'), grossCents: number('grossCents'), categoryId: text('categoryId') || '*',
        listingType: /premium|gold_pro/.test(normalize(text('listingType'))) ? 'premium' : 'classico',
        commissionCents: number('commissionCents'), feeCents: number('feeCents'), shippingChargedCents: number('shippingChargedCents'), billedWeightG: number('billedWeightKg'),
        // Sem data de repasse, o valor repassado não é considerado liquidado.
        settledAt: (values.settledAt as string | null) ?? null,
        settledCents: values.settledAt && values.settledCents !== null ? number('settledCents') : null,
      };
      result.records.push({ key: `${record.orderId}|${record.sku}`, record });
    } else if (kind === 'incidents') {
      const record: LogisticsIncident = {
        id: text('id'), marketplace, kind: incidentKind(text('kind')), sku: text('sku'), quantity: number('quantity'), occurredAt: text('occurredAt'),
        orderId: text('orderId') || undefined, inboundId: text('inboundId') || undefined, compensatedCents: number('compensatedCents'),
      };
      result.records.push({ key: record.id, record });
    } else if (kind === 'returns') {
      const returned = yes(text('returnedToStock'));
      const record: ReturnCase = {
        id: text('id'), marketplace, orderId: text('orderId'), sku: text('sku'), quantity: number('quantity'), closedAt: text('closedAt'),
        resolution: /vendedor|seller/.test(normalize(text('resolution'))) ? 'SELLER' : 'BUYER', refundedToBuyerCents: number('refundedToBuyerCents'),
        returnedToStock: returned, returnedCondition: returned ? (/avari|dano|danific|ruim/.test(normalize(text('returnedCondition'))) ? 'DAMAGED' : 'OK') : null,
        compensatedCents: number('compensatedCents'),
      };
      result.records.push({ key: record.id, record });
    } else {
      const record: WarehouseReceipt = { inboundId: text('inboundId'), sku: text('sku'), receivedQty: number('receivedQty'), receivedAt: text('receivedAt') };
      result.records.push({ key: `${record.inboundId}|${record.sku}`, record });
    }
  });
  return result;
}
