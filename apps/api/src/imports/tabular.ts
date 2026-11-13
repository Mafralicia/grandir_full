import { XMLParser } from 'fast-xml-parser';
import { strFromU8, unzipSync } from 'fflate';
import { badRequest } from '../errors';

/** Tabela lida de um arquivo: cabeçalhos e linhas, tudo como texto. */
export interface Table {
  headers: string[];
  rows: string[][];
}

const MAX_ROWS = 50_000;

/** Lê CSV ou XLSX conforme a extensão e o conteúdo do arquivo. */
export function readTable(content: Buffer, filename: string): Table {
  const isZip = content[0] === 0x50 && content[1] === 0x4b;
  const table = isZip || /\.xlsx$/i.test(filename) ? readXlsx(content) : readCsv(content);
  // Colunas sem cabeçalho não podem ser mapeadas; linhas totalmente vazias não são dados.
  const headers = table.headers.map((header) => header.trim());
  const rows = table.rows.filter((row) => row.some((cell) => cell.trim() !== ''));
  if (headers.filter(Boolean).length === 0) throw badRequest('Não encontramos uma linha de cabeçalho no arquivo.');
  if (rows.length === 0) throw badRequest('O arquivo tem cabeçalho, mas nenhuma linha de dados.');
  if (rows.length > MAX_ROWS) throw badRequest(`O arquivo tem mais de ${MAX_ROWS.toLocaleString('pt-BR')} linhas. Divida a exportação por período.`);
  return { headers, rows };
}

// ───────────── CSV ─────────────

function decode(content: Buffer): string {
  const utf8 = content.toString('utf8');
  // Relatórios exportados em Windows-1252 aparecem com o caractere de substituição em UTF-8.
  return (utf8.includes('�') ? content.toString('latin1') : utf8).replace(/^﻿/, '');
}

export function readCsv(content: Buffer): Table {
  const text = decode(content);
  const head = text.split(/\r?\n/, 15);
  const count = (char: string) => Math.max(...head.map((line) => line.split(char).length - 1));
  const delimiter = [';', '\t', ','].sort((a, b) => count(b) - count(a))[0];

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) { row.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += char;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return splitHeader(rows);
}

// ───────────── XLSX ─────────────

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', parseTagValue: false, parseAttributeValue: false, processEntities: true, trimValues: false });
const list = <T,>(value: T | T[] | undefined): T[] => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

/** Texto de um nó de string do Excel: simples (<t>) ou formatado em trechos (<r><t>). */
function richText(node: any): string {
  if (node === undefined || node === null) return '';
  if (typeof node === 'string') return node;
  const direct = node.t !== undefined ? [node.t] : list<any>(node.r).map((run) => run.t);
  return direct.map((t) => (typeof t === 'object' && t !== null ? (t['#text'] ?? '') : (t ?? ''))).join('');
}

function columnIndex(ref: string): number {
  let index = 0;
  for (const char of ref.replace(/\d+/g, '')) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

export function readXlsx(content: Buffer): Table {
  let files: Record<string, Uint8Array>;
  try {
    // Só as partes necessárias são descompactadas, com teto de tamanho contra arquivos-bomba.
    files = unzipSync(new Uint8Array(content), {
      filter: (file) => /^xl\/(workbook\.xml|sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/.test(file.name) && file.originalSize < 80 * 1024 * 1024,
    });
  } catch {
    throw badRequest('Não foi possível abrir a planilha. Salve como .xlsx ou .csv e tente de novo.');
  }
  const sheetName = Object.keys(files).filter((name) => name.startsWith('xl/worksheets/')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))[0];
  if (!sheetName) throw badRequest('A planilha não tem nenhuma aba com dados.');

  const shared = files['xl/sharedStrings.xml'] ? list<any>(xml.parse(strFromU8(files['xl/sharedStrings.xml'])).sst?.si).map(richText) : [];
  const sheet = xml.parse(strFromU8(files[sheetName]));
  const rows: string[][] = [];
  for (const row of list<any>(sheet.worksheet?.sheetData?.row)) {
    const cells: string[] = [];
    list<any>(row.c).forEach((cell, position) => {
      const index = cell['@r'] ? columnIndex(cell['@r']) : position;
      const raw = typeof cell.v === 'object' && cell.v !== null ? (cell.v['#text'] ?? '') : (cell.v ?? '');
      cells[index] = cell['@t'] === 's' ? (shared[Number(raw)] ?? '') : cell['@t'] === 'inlineStr' ? richText(cell.is) : String(raw);
    });
    rows.push(Array.from(cells, (value) => value ?? ''));
  }
  return splitHeader(rows);
}

/**
 * O cabeçalho é a primeira linha "larga": com pelo menos duas células preenchidas e pelo menos
 * metade das colunas da linha mais larga do início do arquivo. Isso pula linhas de título e
 * de filtros que os relatórios trazem em cima da tabela.
 */
function splitHeader(rows: string[][]): Table {
  const filled = (row: string[]) => row.filter((cell) => cell.trim() !== '').length;
  const widest = Math.max(0, ...rows.slice(0, 30).map(filled));
  const headerIndex = rows.findIndex((row) => filled(row) >= 2 && filled(row) >= widest / 2);
  if (headerIndex < 0) return { headers: [], rows: [] };
  const headers = rows[headerIndex];
  return { headers, rows: rows.slice(headerIndex + 1).map((row) => headers.map((_, index) => row[index] ?? '')) };
}
