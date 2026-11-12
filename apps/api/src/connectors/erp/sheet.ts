import type { ErpProduct } from '@grandir/engines';

/**
 * Importador de cadastro de produtos a partir da planilha exportada pelo ERP.
 * Bling, Tiny e Omie usam nomes de coluna diferentes; os apelidos abaixo cobrem os
 * mais comuns. Aceita CSV com vírgula ou ponto e vírgula e números no padrão brasileiro.
 */
const ALIASES: Record<keyof ErpProduct, string[]> = {
  sku: ['sku', 'codigo', 'codigo (sku)', 'codigo do produto', 'codigo_produto', 'cod'],
  ean: ['ean', 'gtin', 'gtin/ean', 'codigo de barras', 'gtin/ean tributavel'],
  name: ['descricao', 'nome', 'produto', 'descricao do produto'],
  costCents: ['preco de custo', 'custo', 'valor de custo', 'preco_custo', 'custo medio'],
  weightG: ['peso bruto (kg)', 'peso bruto', 'peso_bruto', 'peso (kg)', 'peso'],
  lengthCm: ['comprimento', 'profundidade', 'comprimento (cm)', 'profundidade (cm)', 'comprimento embalagem'],
  widthCm: ['largura', 'largura (cm)', 'largura embalagem'],
  heightCm: ['altura', 'altura (cm)', 'altura embalagem'],
};

const normalize = (text: string) =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^﻿/, '').trim().toLowerCase();

/** "1.234,56" → 1234.56; "12.5" → 12.5 */
function toNumber(raw: string): number {
  const text = raw.trim().replace(/[R$\s]/g, '');
  if (!text) return NaN;
  return Number(text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text);
}

function parseLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (char === '"') quoted = false;
      else current += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) { cells.push(current); current = ''; }
    else current += char;
  }
  cells.push(current);
  return cells;
}

export interface SheetResult {
  products: ErpProduct[];
  /** Linhas ignoradas, com o motivo — para o seller corrigir a planilha. */
  errors: { line: number; reason: string }[];
}

export function parseErpProducts(csv: string): SheetResult {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length < 2) return { products: [], errors: [{ line: 1, reason: 'A planilha não tem linhas de produto.' }] };
  const delimiter = (lines[0].match(/;/g)?.length ?? 0) >= (lines[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const header = parseLine(lines[0], delimiter).map(normalize);

  const column = {} as Record<keyof ErpProduct, number>;
  for (const field of Object.keys(ALIASES) as (keyof ErpProduct)[]) {
    column[field] = header.findIndex((name) => ALIASES[field].includes(name));
  }
  const missing = (['sku', 'weightG', 'lengthCm', 'widthCm', 'heightCm'] as const).filter((field) => column[field] < 0);
  if (missing.length) {
    return { products: [], errors: [{ line: 1, reason: `Colunas obrigatórias não encontradas: ${missing.map((f) => ALIASES[f][0]).join(', ')}.` }] };
  }

  const result: SheetResult = { products: [], errors: [] };
  lines.slice(1).forEach((line, index) => {
    const cells = parseLine(line, delimiter);
    const text = (field: keyof ErpProduct) => (column[field] >= 0 ? (cells[column[field]] ?? '').trim() : '');
    const number = (field: keyof ErpProduct) => toNumber(text(field));
    const sku = text('sku');
    const weightKg = number('weightG');
    const dims = [number('lengthCm'), number('widthCm'), number('heightCm')];
    if (!sku) return void result.errors.push({ line: index + 2, reason: 'SKU vazio.' });
    if (!(weightKg > 0) || dims.some((d) => !(d > 0))) {
      return void result.errors.push({ line: index + 2, reason: `Peso ou medidas inválidos para o SKU ${sku}.` });
    }
    const cost = number('costCents');
    result.products.push({
      sku,
      ean: text('ean'),
      name: text('name') || sku,
      costCents: cost > 0 ? Math.round(cost * 100) : 0,
      weightG: Math.round(weightKg * 1000),
      lengthCm: dims[0],
      widthCm: dims[1],
      heightCm: dims[2],
    });
  });
  return result;
}
