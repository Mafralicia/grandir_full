import type { Nfe, NfeKind } from '@grandir/engines';
import { XMLParser } from 'fast-xml-parser';

/**
 * Importador de NF-e modelo 55 a partir do XML autorizado (nfeProc) ou da nota isolada (NFe).
 * Lê o XML que qualquer ERP ou o portal da SEFAZ entrega, o que torna a auditoria
 * independente do ERP do seller.
 */
export interface NfeItem {
  sku: string;
  ean: string;
  name: string;
  cfop: string;
  quantity: number;
  unitCents: number;
  totalCents: number;
  /** Número do pedido de compra informado no item (xPed), quando houver. */
  orderRef: string;
}

export interface ParsedNfe {
  accessKey: string;
  number: string;
  series: string;
  issuedAt: string;
  kind: NfeKind;
  /** CFOP predominante (o do item de maior valor). */
  cfop: string;
  issuerCnpj: string;
  recipientDoc: string;
  items: NfeItem[];
  grossWeightKg: number;
  netWeightKg: number;
  totals: { productsCents: number; freightCents: number; icmsCents: number; ipiCents: number; invoiceCents: number };
}

/**
 * Natureza da operação pelo CFOP. O primeiro dígito indica entrada (1, 2, 3) ou saída
 * (5, 6, 7); os três finais, a operação. A lista cobre os códigos usuais de quem vende em
 * fulfillment — o 5.949/6.949 ("outras saídas") é o que muitos sellers usam na remessa
 * para o centro de distribuição do marketplace, por isso é tratado como remessa.
 */
const CFOP_KIND: [RegExp, NfeKind][] = [
  [/^[56](905|934|949|923)$/, 'REMESSA'],
  [/^[12](906|907|949)$|^[56](906|907)$/, 'RETORNO'],
  [/^[56](10[1-9]|11[0-9]|12[0-9]|40[1-5]|933)$/, 'VENDA'],
  [/^[12](20[1-9]|41[01])$|^[56](20[1-9]|41[01])$/, 'DEVOLUCAO'],
  [/^[12](10[12]|11[0-9]|12[0-9]|40[1-7]|55[0-9])$|^3/, 'ENTRADA'],
];

export function kindFromCfop(cfop: string): NfeKind | null {
  return CFOP_KIND.find(([pattern]) => pattern.test(cfop))?.[1] ?? null;
}

/** Dígito verificador da chave de acesso (módulo 11, pesos de 2 a 9). */
export function validAccessKey(key: string): boolean {
  if (!/^\d{44}$/.test(key)) return false;
  let sum = 0;
  for (let i = 42, weight = 2; i >= 0; i--, weight = weight === 9 ? 2 : weight + 1) sum += Number(key[i]) * weight;
  const rest = sum % 11;
  return Number(key[43]) === (rest < 2 ? 0 : 11 - rest);
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  // Tudo como texto: chaves, CNPJ e EAN não podem perder zeros à esquerda.
  parseTagValue: false,
  parseAttributeValue: false,
  // Entidades e DTD não são processadas: o arquivo vem do usuário.
  processEntities: false,
  removeNSPrefix: true,
});

const list = <T,>(value: T | T[] | undefined): T[] => (value === undefined ? [] : Array.isArray(value) ? value : [value]);
const cents = (value: unknown) => Math.round(Number(value ?? 0) * 100);
const text = (value: unknown) => (value === undefined || value === null ? '' : String(value).trim());

export class NfeError extends Error {}

export function parseNfeXml(xml: string): ParsedNfe {
  let doc: any;
  try {
    doc = parser.parse(xml);
  } catch {
    throw new NfeError('O arquivo não é um XML válido.');
  }
  const inf = doc?.nfeProc?.NFe?.infNFe ?? doc?.NFe?.infNFe;
  if (!inf) throw new NfeError('O XML não contém uma NF-e (elemento infNFe ausente).');
  if (text(inf.ide?.mod) !== '55') throw new NfeError(`Modelo ${text(inf.ide?.mod) || 'desconhecido'}: apenas NF-e modelo 55 é aceita.`);

  const accessKey = text(doc?.nfeProc?.protNFe?.infProt?.chNFe) || text(inf['@Id']).replace(/^NFe/, '');
  if (!validAccessKey(accessKey)) throw new NfeError('Chave de acesso ausente ou com dígito verificador inválido.');

  const items: NfeItem[] = list<any>(inf.det).map((det) => {
    const prod = det.prod ?? {};
    const ean = text(prod.cEAN);
    return {
      sku: text(prod.cProd),
      ean: /^\d{8,14}$/.test(ean) ? ean : '',
      name: text(prod.xProd),
      cfop: text(prod.CFOP),
      quantity: Number(prod.qCom ?? 0),
      unitCents: cents(prod.vUnCom),
      totalCents: cents(prod.vProd),
      orderRef: text(prod.xPed),
    };
  });
  if (items.length === 0) throw new NfeError('A nota não tem itens.');
  if (items.some((item) => !item.sku || !(item.quantity > 0))) throw new NfeError('Há item sem código de produto ou sem quantidade.');

  const cfop = [...items].sort((a, b) => b.totalCents - a.totalCents)[0].cfop;
  const kind = kindFromCfop(cfop);
  if (!kind) throw new NfeError(`CFOP ${cfop} não corresponde a entrada, remessa, retorno, venda nem devolução.`);

  const volumes = list<any>(inf.transp?.vol);
  const total = inf.total?.ICMSTot ?? {};
  return {
    accessKey,
    number: text(inf.ide?.nNF),
    series: text(inf.ide?.serie),
    issuedAt: new Date(text(inf.ide?.dhEmi) || `${text(inf.ide?.dEmi)}T00:00:00-03:00`).toISOString(),
    kind,
    cfop,
    issuerCnpj: text(inf.emit?.CNPJ),
    recipientDoc: text(inf.dest?.CNPJ) || text(inf.dest?.CPF),
    items,
    grossWeightKg: volumes.reduce((sum, vol) => sum + Number(vol.pesoB ?? 0), 0),
    netWeightKg: volumes.reduce((sum, vol) => sum + Number(vol.pesoL ?? 0), 0),
    totals: {
      productsCents: cents(total.vProd),
      freightCents: cents(total.vFrete),
      icmsCents: cents(total.vICMS),
      ipiCents: cents(total.vIPI),
      invoiceCents: cents(total.vNF),
    },
  };
}

/**
 * Converte a nota para o formato do motor: uma linha por item. O pedido (xPed) liga a nota
 * de venda ao pedido do marketplace e a nota de remessa ao lote de envio.
 */
export function toEngineInvoices(nfe: ParsedNfe): Nfe[] {
  return nfe.items.map((item) => ({
    accessKey: nfe.accessKey,
    kind: nfe.kind,
    issuedAt: nfe.issuedAt,
    sku: item.sku,
    quantity: item.quantity,
    totalCents: item.totalCents,
    orderId: nfe.kind === 'VENDA' && item.orderRef ? item.orderRef : undefined,
    inboundId: nfe.kind === 'REMESSA' && item.orderRef ? item.orderRef : undefined,
  }));
}
