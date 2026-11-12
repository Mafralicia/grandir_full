import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/config';
import { parseErpProducts } from '../src/connectors/erp/sheet';
import { openDb, type Db } from '../src/db';
import { buildApp } from '../src/server';

let app: FastifyInstance;
let db: Db;

interface Client {
  cookie: string;
  csrf: string;
}

async function signup(email: string, companyName: string): Promise<Client> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    payload: {
      firstName: 'Ana', lastName: 'Lima', phone: '+55 11 98888-7777', companyName, isAgency: false, country: 'BR',
      revenueBand: '1M_3M', email, password: 'Senha-Forte-2026!', acceptTerms: true,
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  return { cookie: String(response.headers['set-cookie']).split(';')[0], csrf: response.json().csrfToken };
}

const get = (client: Client, url: string) => app.inject({ method: 'GET', url, headers: { cookie: client.cookie } });
const post = (client: Client, url: string, payload: object) =>
  app.inject({ method: 'POST', url, payload, headers: { cookie: client.cookie, 'x-csrf-token': client.csrf } });

before(async () => {
  const config = loadConfig({ NODE_ENV: 'test', UPLOAD_DIR: mkdtempSync(join(tmpdir(), 'grandir-test-')) });
  db = openDb(':memory:');
  app = await buildApp({ config, db, mailer: { send: async () => undefined } });
});

after(async () => {
  await app.close();
  db.close();
});

describe('lojas brasileiras e dossiês', () => {
  let seller: Client;
  let other: Client;
  let mlStoreId: string;
  let groups: { key: string; type: string; marketplace: string; count: number; totalCents: number; bucketLabel: string }[];

  before(async () => {
    seller = await signup('ml@exemplo.test', 'Casa Aurora');
    other = await signup('outro@exemplo.test', 'Outra Empresa');
    const ml = await post(seller, '/api/stores', { name: 'Aurora ML', marketplace: 'mercadolivre', region: 'BR' });
    assert.equal(ml.statusCode, 201, ml.body);
    mlStoreId = ml.json().id;
    const shopee = await post(seller, '/api/stores', { name: 'Aurora Shopee', marketplace: 'shopee', region: 'BR' });
    assert.equal(shopee.statusCode, 201, shopee.body);
    groups = (await get(seller, '/api/dossiers')).json().groups;
  });

  it('audita Mercado Livre e Shopee com as regras de cada um', async () => {
    const { discrepancies } = (await get(seller, '/api/discrepancies')).json();
    const types = new Set(discrepancies.map((d: { type: string }) => d.type));
    for (const expected of ['ML_FREIGHT_OVERCHARGE', 'ML_COMMISSION_OVERCHARGE', 'SHOPEE_PAYOUT_SHORTFALL', 'ERP_INBOUND_GAP']) {
      assert.ok(types.has(expected), `faltou ${expected}`);
    }
    assert.ok(![...types].some((t) => String(t).startsWith('LOST_')), 'loja brasileira não usa as regras genéricas');
    assert.ok((await get(seller, '/api/reconciliation')).json().rows.length > 0);
  });

  it('agrupa divergências em aberto em poucos dossiês', async () => {
    const open = (await get(seller, '/api/discrepancies?status=OPEN')).json().discrepancies.length;
    assert.ok(groups.length > 0 && groups.length < open, `${groups.length} dossiês para ${open} divergências`);
    assert.equal(groups.reduce((sum, g) => sum + g.count, 0), open);
    assert.equal(new Set(groups.map((g) => g.key)).size, groups.length);
  });

  it('exporta o dossiê em texto, CSV, PDF e XLSX', async () => {
    const group = groups.find((g) => g.type.startsWith('ML_'))!;
    const url = `/api/dossiers/${encodeURIComponent(group.key)}`;

    const json = (await get(seller, url)).json().dossier;
    assert.equal(json.items.length, group.count);
    assert.ok(json.items[0].details.calc.length > 0);

    const txt = await get(seller, `${url}?format=txt`);
    assert.match(txt.body, /^Assunto: Solicitação de reembolso/);
    assert.match(txt.body, /equipe Mercado Livre/);
    assert.match(txt.body, /Casa Aurora/);

    const csv = await get(seller, `${url}?format=csv`);
    assert.equal(csv.body.split('\r\n').filter(Boolean).length, group.count + 1);

    const pdf = await get(seller, `${url}?format=pdf`);
    assert.equal(pdf.headers['content-type'], 'application/pdf');
    assert.equal(pdf.rawPayload.subarray(0, 5).toString(), '%PDF-');

    const xlsx = await get(seller, `${url}?format=xlsx`);
    assert.equal(xlsx.rawPayload.subarray(0, 2).toString(), 'PK');
    assert.match(String(xlsx.headers['content-disposition']), /attachment; filename="dossie-.*\.xlsx"/);
  });

  it('não entrega dossiê de outro tenant', async () => {
    assert.deepEqual((await get(other, '/api/dossiers')).json().groups, []);
    assert.equal((await get(other, `/api/dossiers/${encodeURIComponent(groups[0].key)}`)).statusCode, 404);
    assert.equal((await app.inject({ method: 'GET', url: '/api/dossiers' })).statusCode, 401);
  });

  it('usa o cadastro do ERP importado por planilha como fonte de verdade', async () => {
    const before = (await get(seller, '/api/discrepancies?type=ML_FREIGHT_OVERCHARGE')).json().discrepancies.length;
    assert.ok(before > 0);
    // O seller informa que o fone pesa de fato 2,4 kg: o frete cobrado passa a estar correto.
    const sheet = 'Código;Descrição;Peso bruto (kg);Largura;Altura;Profundidade\r\nGRD-FON-004;Fone bluetooth;2,4;18;8;20\r\n';
    const upload = await app.inject({
      method: 'PUT',
      url: `/api/stores/${mlStoreId}/erp-products`,
      headers: { cookie: seller.cookie, 'x-csrf-token': seller.csrf, 'content-type': 'text/csv' },
      payload: sheet,
    });
    assert.equal(upload.statusCode, 200, upload.body);
    assert.equal(upload.json().imported, 1);
    const fone = (await get(seller, '/api/discrepancies?type=ML_FREIGHT_OVERCHARGE&status=OPEN')).json().discrepancies
      .filter((d: { sku: string }) => d.sku === 'GRD-FON-004');
    assert.equal(fone.length, 0);
  });
});

describe('planilha do ERP', () => {
  it('lê colunas com nomes e formatos diferentes', () => {
    const csv = '﻿SKU,GTIN/EAN,Nome,Preço de custo,Peso (kg),Largura (cm),Altura (cm),Comprimento (cm)\n' +
      'A-1,7891234567890,"Garrafa, 1 L","42,50",0.48,9,9,30\n';
    const { products, errors } = parseErpProducts(csv);
    assert.deepEqual(errors, []);
    assert.deepEqual(products[0], { sku: 'A-1', ean: '7891234567890', name: 'Garrafa, 1 L', costCents: 4250, weightG: 480, lengthCm: 30, widthCm: 9, heightCm: 9 });
  });

  it('explica o que falta em vez de importar pela metade', () => {
    assert.match(parseErpProducts('sku;nome\nA;B\n').errors[0].reason, /Colunas obrigatórias/);
    const { products, errors } = parseErpProducts('sku;peso;largura;altura;comprimento\nA;0;1;1;1\n;1;1;1;1\nB;1,5;10;10;10\n');
    assert.equal(products.length, 1);
    assert.equal(errors.length, 2);
  });
});
