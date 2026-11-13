import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { strToU8, zipSync } from 'fflate';
import { loadConfig } from '../src/config';
import { openDb, type Db } from '../src/db';
import { mapRows, parseDate, parseMoney, suggestMapping } from '../src/imports/schema';
import { readTable } from '../src/imports/tabular';
import { buildApp } from '../src/server';

/** Planilha XLSX mínima, com textos em sharedStrings e números diretos, como o Excel grava. */
function xlsx(rows: (string | number)[][]): Buffer {
  const strings: string[] = [];
  const cell = (value: string | number, r: number, c: number) => {
    const ref = `${String.fromCharCode(65 + c)}${r + 1}`;
    if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`;
    strings.push(value);
    return `<c r="${ref}" t="s"><v>${strings.length - 1}</v></c>`;
  };
  const sheet = rows.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => (value === '' ? '' : cell(value, r, c))).join('')}</row>`).join('');
  const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return Buffer.from(zipSync({
    'xl/workbook.xml': strToU8('<workbook/>'),
    'xl/sharedStrings.xml': strToU8(`<sst>${strings.map((s) => `<si><t>${escape(s)}</t></si>`).join('')}</sst>`),
    'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>${sheet}</sheetData></worksheet>`),
  }));
}

describe('leitura de arquivos', () => {
  it('lê CSV com título acima do cabeçalho, aspas e ponto e vírgula', () => {
    const csv = 'Relatório de vendas\r\n\r\nN.º de venda;SKU;"Receita por produtos (BRL)"\r\n2000001;A-1;"1.234,56"\r\n;;\r\n2000002;"B;2";10\r\n';
    const table = readTable(Buffer.from(csv), 'vendas.csv');
    assert.deepEqual(table.headers, ['N.º de venda', 'SKU', 'Receita por produtos (BRL)']);
    assert.deepEqual(table.rows, [['2000001', 'A-1', '1.234,56'], ['2000002', 'B;2', '10']]);
  });

  it('lê CSV em Windows-1252 sem estragar os acentos', () => {
    const table = readTable(Buffer.from('Número;Descrição\r\n1;Avaria no armazém\r\n', 'latin1'), 'a.csv');
    assert.deepEqual([table.headers[1], table.rows[0][1]], ['Descrição', 'Avaria no armazém']);
  });

  it('lê XLSX com textos compartilhados, números e células vazias', () => {
    const table = readTable(xlsx([['Pedido', 'SKU', 'Valor', 'Data'], ['P-1', 'A&B', 199.9, 46327], ['P-2', '', 50, 46328]]), 'vendas.xlsx');
    assert.deepEqual(table.headers, ['Pedido', 'SKU', 'Valor', 'Data']);
    assert.deepEqual(table.rows, [['P-1', 'A&B', '199.9', '46327'], ['P-2', '', '50', '46328']]);
  });

  it('recusa arquivo sem dados e arquivo que não é planilha', () => {
    assert.throws(() => readTable(Buffer.from('a;b\r\n'), 'vazio.csv'), /nenhuma linha de dados/);
    assert.throws(() => readTable(Buffer.from('PK não é um zip de verdade'), 'falso.xlsx'), /Não foi possível abrir/);
  });
});

describe('conversão e mapeamento', () => {
  it('entende dinheiro e datas nos formatos usuais', () => {
    assert.deepEqual(['R$ 1.234,56', '-15,00', '1234.5', '12', ''].map(parseMoney), [123_456, 1_500, 123_450, 1_200, null]);
    assert.equal(parseDate('05/10/2026 14:30'), '2026-10-05T17:30:00.000Z');
    assert.equal(parseDate('2026-10-05'), '2026-10-05T15:00:00.000Z');
    assert.equal(parseDate('46300')?.slice(0, 10), '2026-10-05');
    assert.deepEqual([parseDate('31/13/2026'), parseDate('ontem')], [null, null]);
  });

  it('sugere colunas por nome, sem usar a mesma coluna duas vezes', () => {
    const suggested = suggestMapping('orders', ['N.º de venda', 'Data da venda', 'SKU', 'Unidades', 'Receita por produtos (BRL)', 'Tarifa de venda e impostos', 'Coluna estranha']);
    assert.deepEqual(
      [suggested.orderId, suggested.saleDate, suggested.sku, suggested.quantity, suggested.grossCents, suggested.commissionCents, suggested.trackingCode],
      ['N.º de venda', 'Data da venda', 'SKU', 'Unidades', 'Receita por produtos (BRL)', 'Tarifa de venda e impostos', null],
    );
  });

  it('aponta linha e motivo dos registros inválidos e aproveita os demais', () => {
    const table = { headers: ['ped', 'dt', 'sku', 'qtd', 'valor'], rows: [['P1', '05/10/2026', 'A', '2', '200,00'], ['P2', 'xx', 'A', '1', '10'], ['', '05/10/2026', 'A', '1', '10']] };
    const mapping = { orderId: 'ped', saleDate: 'dt', sku: 'sku', quantity: 'qtd', grossCents: 'valor' };
    const result = mapRows('orders', table, mapping, 'mercadolivre');
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].key, 'P1|A');
    assert.deepEqual(result.errors.map((e) => e.line), [3, 4]);
    assert.match(mapRows('orders', table, { orderId: 'ped' }, 'mercadolivre').errors[0].reason, /Mapeie as colunas obrigatórias/);
  });

  it('interpreta tipo de ocorrência e desfecho de devolução por texto', () => {
    const incidents = mapRows('incidents', { headers: ['id', 't', 's', 'q', 'd'], rows: [['1', 'Extravio em trânsito', 'A', '1', '01/10/2026'], ['2', 'Produto avariado no armazém', 'A', '1', '01/10/2026'], ['3', 'Perdido na logística reversa', 'A', '1', '01/10/2026']] },
      { id: 'id', kind: 't', sku: 's', quantity: 'q', occurredAt: 'd' }, 'mercadolivre');
    assert.deepEqual(incidents.records.map((r) => (r.record as { kind: string }).kind), ['TRANSIT_LOSS', 'WAREHOUSE_DAMAGE', 'REVERSE_LOSS']);
    const returns = mapRows('returns', { headers: ['id', 'p', 's', 'q', 'd', 'v', 'volta', 'cond'], rows: [['M1', 'P1', 'A', '1', '01/10/2026', '100', 'Sim', 'Avariado'], ['M2', 'P2', 'A', '1', '01/10/2026', '100', '', '']] },
      { id: 'id', orderId: 'p', sku: 's', quantity: 'q', closedAt: 'd', refundedToBuyerCents: 'v', returnedToStock: 'volta', returnedCondition: 'cond' }, 'mercadolivre');
    assert.deepEqual(returns.records.map((r) => { const x = r.record as { returnedToStock: boolean; returnedCondition: string | null; resolution: string }; return [x.returnedToStock, x.returnedCondition, x.resolution]; }),
      [[true, 'DAMAGED', 'BUYER'], [false, null, 'BUYER']]);
  });
});

describe('aplicação com dados reais (modo de demonstração desligado)', () => {
  let app: FastifyInstance;
  let db: Db;
  let seller: { cookie: string; csrf: string };
  let other: { cookie: string; csrf: string };
  let storeId: string;

  const signup = async (email: string) => {
    const response = await app.inject({
      method: 'POST', url: '/api/auth/signup',
      payload: { firstName: 'Ana', lastName: 'Lima', phone: '+55 11 98888-7777', companyName: email, isAgency: false, country: 'BR', revenueBand: '1M_3M', email, password: 'Senha-Forte-2026!', acceptTerms: true },
    });
    return { cookie: String(response.headers['set-cookie']).split(';')[0], csrf: response.json().csrfToken as string };
  };
  const get = (who: typeof seller, url: string) => app.inject({ method: 'GET', url, headers: { cookie: who.cookie } });
  const post = (who: typeof seller, url: string, payload: object = {}) => app.inject({ method: 'POST', url, payload, headers: { cookie: who.cookie, 'x-csrf-token': who.csrf } });
  const send = (who: typeof seller, method: 'POST' | 'PUT', url: string, body: Buffer) =>
    app.inject({ method, url, payload: body, headers: { cookie: who.cookie, 'x-csrf-token': who.csrf, 'content-type': 'application/octet-stream' } });

  const day = (daysAgo: number) => {
    const d = new Date(Date.now() - daysAgo * 86_400_000);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  };
  // P-1: tarifa de R$ 15 sobre R$ 100 (a tabela carregada prevê 12% no Clássico). P-2: tarifa correta.
  const report = () => Buffer.from(
    'N.º de venda;Data da venda;SKU;Unidades;Receita por produtos (BRL);Tarifa de venda e impostos;N.º de anúncio\r\n' +
    `P-1;${day(5)};SKU-A;1;100,00;-15,00;MLB111\r\n` +
    `P-2;${day(6)};SKU-A;1;100,00;-12,00;MLB111\r\n` +
    `P-3;data ruim;SKU-A;1;100,00;-12,00;MLB111\r\n`,
  );
  const mapping = { orderId: 'N.º de venda', saleDate: 'Data da venda', sku: 'SKU', quantity: 'Unidades', grossCents: 'Receita por produtos (BRL)', commissionCents: 'Tarifa de venda e impostos', itemId: 'N.º de anúncio' };
  const importUrl = (kind: string) => `/api/stores/${storeId}/imports/${kind}?filename=vendas.csv&mapping=${encodeURIComponent(JSON.stringify(mapping))}`;

  before(async () => {
    const config = loadConfig({ NODE_ENV: 'test', UPLOAD_DIR: mkdtempSync(join(tmpdir(), 'grandir-test-')) });
    assert.equal(config.demoMode, false);
    db = openDb(':memory:');
    app = await buildApp({ config, db, mailer: { send: async () => undefined } });
    seller = await signup('real@exemplo.test');
    other = await signup('outro-real@exemplo.test');
  });
  after(async () => {
    await app.close();
    db.close();
  });

  it('cria loja vazia, sem nenhum dado sintético, e deixa Amazon e Magalu como "em breve"', async () => {
    assert.equal((await app.inject({ method: 'GET', url: '/api/meta' })).json().demoMode, false);
    const soon = await post(seller, '/api/stores', { name: 'Loja Amazon', marketplace: 'amazon', region: 'BR' });
    assert.deepEqual([soon.statusCode, soon.json().error.code], [400, 'MARKETPLACE_EM_BREVE']);

    const created = await post(seller, '/api/stores', { name: 'Loja ML', marketplace: 'mercadolivre', region: 'BR' });
    assert.equal(created.statusCode, 201, created.body);
    assert.equal(created.json().audit, null);
    storeId = created.json().id;

    const [store] = (await get(seller, '/api/stores')).json().stores;
    assert.deepEqual([store.connector, store.status, store.discrepancyCount], ['mercadolivre-import', 'AGUARDANDO_DADOS', 0]);
    assert.equal((await get(seller, '/api/discrepancies')).json().discrepancies.length, 0);
    assert.equal((await get(seller, '/api/claims')).json().claims.length, 0);
    assert.equal((await get(seller, '/api/auth/me')).json().tenant.demoData, false);
  });

  it('mostra cabeçalhos, amostra e sugestão antes de importar, sem gravar nada', async () => {
    const preview = await send(seller, 'POST', `/api/stores/${storeId}/imports/orders/preview?filename=vendas.csv`, report());
    assert.equal(preview.statusCode, 200, preview.body);
    const data = preview.json();
    assert.equal(data.totalRows, 3);
    assert.equal(data.headers.length, 7);
    assert.deepEqual(data.sample[0].slice(0, 3), ['P-1', day(5), 'SKU-A']);
    assert.deepEqual(data.suggested, { ...Object.fromEntries(Object.keys(data.suggested).map((k) => [k, null])), ...mapping });
    assert.equal((await get(seller, `/api/stores/${storeId}/imports`)).json().kinds[0].rowCount, 0);
  });

  it('importa o relatório, audita os dados reais e encontra a tarifa cobrada a maior', async () => {
    const imported = await send(seller, 'PUT', importUrl('orders'), report());
    assert.equal(imported.statusCode, 200, imported.body);
    const result = imported.json();
    assert.deepEqual([result.imported, result.updated, result.errors.map((e: { line: number }) => e.line)], [2, 0, [4]]);
    assert.equal(result.audit.discrepanciesFound, 1);

    const { discrepancies } = (await get(seller, '/api/discrepancies')).json();
    assert.deepEqual(discrepancies.map((d: { type: string; sku: string; estimatedValueCents: number; referenceId: string }) => [d.type, d.sku, d.estimatedValueCents, d.referenceId]), [['ML_COMMISSION_OVERCHARGE', 'SKU-A', 300, 'P-1']]);

    const state = (await get(seller, `/api/stores/${storeId}/imports`)).json();
    assert.equal(state.kinds[0].rowCount, 2);
    assert.deepEqual(state.kinds[0].mapping, mapping);
    assert.equal(state.store.connector, 'mercadolivre-import');
    assert.equal((await get(seller, '/api/stores')).json().stores[0].status, 'CONNECTED');
  });

  it('reimportar atualiza em vez de duplicar', async () => {
    const again = (await send(seller, 'PUT', importUrl('orders'), report())).json();
    assert.deepEqual([again.imported, again.updated], [0, 2]);
    assert.equal((await get(seller, '/api/discrepancies')).json().discrepancies.length, 1);
  });

  it('gera dossiê a partir da divergência real', async () => {
    const { groups } = (await get(seller, '/api/dossiers')).json();
    assert.equal(groups.length, 1);
    const text = (await get(seller, `/api/dossiers/${encodeURIComponent(groups[0].key)}?format=txt`)).body;
    assert.match(text, /Pedido P-1/);
    assert.match(text, /Anúncio MLB111/);
  });

  it('recusa mapeamento incompleto, outro tenant e quem não é administrador', async () => {
    const partial = `/api/stores/${storeId}/imports/orders?filename=v.csv&mapping=${encodeURIComponent(JSON.stringify({ orderId: 'N.º de venda' }))}`;
    const missing = await send(seller, 'PUT', partial, report());
    assert.equal(missing.statusCode, 400);
    assert.match(missing.json().error.message, /Mapeie as colunas obrigatórias/);
    assert.equal((await get(other, `/api/stores/${storeId}/imports`)).statusCode, 404);
    assert.equal((await send(other, 'PUT', importUrl('orders'), report())).statusCode, 404);
  });
});
