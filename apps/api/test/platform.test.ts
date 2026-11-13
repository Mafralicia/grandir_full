import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { REFERENCE_TABLES, REQUIRED_DOCUMENTS, runBrAudit, type BrAuditInput, type MarketplaceOrder } from '@grandir/engines';
import type { FastifyInstance } from 'fastify';
import { loadConfig, type Config } from '../src/config';
import { openDb, type Db } from '../src/db';
import { buildApp } from '../src/server';
import { syncConnectedStores } from '../src/services/scheduler';

const AS_OF = '2026-11-10T00:00:00.000Z';
const daysAgo = (n: number) => new Date(new Date(AS_OF).getTime() - n * 86_400_000).toISOString();
const order = (over: Partial<MarketplaceOrder>): MarketplaceOrder => ({
  marketplace: 'tiktok', orderId: 'T1', shipmentId: 'PKG1', trackingCode: 'BR1', itemId: '900', sku: 'SKU', quantity: 1, saleDate: daysAgo(20),
  grossCents: 10_000, categoryId: '*', listingType: 'classico', commissionCents: 600, feeCents: 300, shippingChargedCents: 1_000, billedWeightG: 9_999,
  settledCents: 8_100, settledAt: daysAgo(10), ...over,
});
const input = (over: Partial<BrAuditInput>): BrAuditInput => ({
  asOf: AS_OF, marketplace: 'tiktok', products: [{ sku: 'SKU', ean: '789', name: 'Produto', costCents: 4_000, weightG: 200, lengthCm: 10, widthCm: 10, heightCm: 5 }],
  orders: [], incidents: [], returns: [], invoices: [], receipts: [], marketplaceStock: {}, ...over,
});
const rules = (data: BrAuditInput) => runBrAudit(data, REFERENCE_TABLES).findings.map((f) => [f.rule, f.recoverableCents]);

describe('TikTok Shop e devoluções da Shopee (regras sem tabela de tarifas)', () => {
  it('confere o repasse pela aritmética do próprio extrato e não julga frete nem comissão', () => {
    // 100,00 − 6,00 − 3,00 − 10,00 = 81,00: fecha. O peso cobrado absurdo não gera regra de frete.
    assert.deepEqual(rules(input({ orders: [order({})] })), []);
    assert.deepEqual(rules(input({ orders: [order({ settledCents: 7_100 })] })), [['TIKTOK_PAYOUT_SHORTFALL', 1_000]]);
    assert.deepEqual(rules(input({ orders: [order({ settledCents: null, settledAt: null })] })), []);
  });

  it('aponta extravio sem crédito e devolução sem retorno no TikTok Shop', () => {
    const data = input({
      orders: [order({})],
      incidents: [{ id: 'I1', marketplace: 'tiktok', kind: 'TRANSIT_LOSS', sku: 'SKU', quantity: 1, occurredAt: daysAgo(18), orderId: 'T1', compensatedCents: 0 }],
      returns: [{ id: 'R1', marketplace: 'tiktok', orderId: 'T1', sku: 'SKU', quantity: 1, closedAt: daysAgo(16), resolution: 'BUYER', refundedToBuyerCents: 10_000, returnedToStock: false, returnedCondition: null, compensatedCents: 2_000 }],
    });
    assert.deepEqual(rules(data), [['TIKTOK_LOST_NO_CREDIT', 10_000], ['TIKTOK_RETURN_NOT_RESTOCKED', 8_000]]);
  });

  it('aplica as regras de devolução também à Shopee', () => {
    const data = input({
      marketplace: 'shopee',
      returns: [{ id: 'R2', marketplace: 'shopee', orderId: 'S9', sku: 'SKU', quantity: 2, closedAt: daysAgo(16), resolution: 'BUYER', refundedToBuyerCents: 20_000, returnedToStock: true, returnedCondition: 'DAMAGED', compensatedCents: 0 }],
    });
    const [finding] = runBrAudit(data, REFERENCE_TABLES).findings;
    assert.deepEqual([finding.rule, finding.recoverableCents, finding.details.ids.orderId], ['SHOPEE_RETURN_DAMAGED', 8_000, 'S9']);
  });

  it('tem lista de documentos para todos os tipos de divergência', () => {
    for (const [type, docs] of Object.entries(REQUIRED_DOCUMENTS)) assert.ok(docs.length > 0, type);
    assert.ok(REQUIRED_DOCUMENTS.ERP_INBOUND_GAP.some((doc) => /remessa/.test(doc)));
  });
});

describe('conta, portabilidade e sincronização automática', () => {
  let app: FastifyInstance;
  let db: Db;
  let config: Config;
  let owner: { cookie: string; csrf: string };
  let stranger: { cookie: string; csrf: string };
  let storeId: string;

  const signup = async (email: string) => {
    const response = await app.inject({
      method: 'POST', url: '/api/auth/signup',
      payload: { firstName: 'Ana', lastName: 'Lima', phone: '+55 11 98888-7777', companyName: `Empresa ${email}`, isAgency: false, country: 'BR', revenueBand: '1M_3M', email, password: 'Senha-Forte-2026!', acceptTerms: true },
    });
    return { cookie: String(response.headers['set-cookie']).split(';')[0], csrf: response.json().csrfToken as string };
  };
  const get = (who: typeof owner, url: string) => app.inject({ method: 'GET', url, headers: { cookie: who.cookie } });
  const post = (who: typeof owner, url: string, payload: object = {}) => app.inject({ method: 'POST', url, payload, headers: { cookie: who.cookie, 'x-csrf-token': who.csrf } });

  before(async () => {
    config = loadConfig({ NODE_ENV: 'test', UPLOAD_DIR: mkdtempSync(join(tmpdir(), 'grandir-test-')) });
    db = openDb(':memory:');
    app = await buildApp({ config, db, mailer: { send: async () => undefined } });
    owner = await signup('titular@exemplo.test');
    stranger = await signup('alheio@exemplo.test');
    storeId = (await post(owner, '/api/stores', { name: 'Loja TikTok', marketplace: 'tiktok', region: 'BR' })).json().id;
    await post(stranger, '/api/stores', { name: 'Loja alheia', marketplace: 'shopee', region: 'BR' });
  });
  after(async () => {
    await app.close();
    db.close();
  });

  it('cadastra loja do TikTok Shop vazia, pronta para receber arquivos', async () => {
    const [store] = (await get(owner, '/api/stores')).json().stores;
    assert.deepEqual([store.marketplace, store.connector, store.status], ['tiktok', 'tiktok-import', 'AGUARDANDO_DADOS']);
    assert.equal((await get(owner, `/api/stores/${storeId}/imports`)).statusCode, 200);
  });

  it('exporta os dados da conta sem segredos e só do próprio tenant', async () => {
    const response = await get(owner, '/api/account/export');
    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers['content-disposition']), /attachment; filename="grandir-dados-\d{4}-\d{2}-\d{2}\.json"/);
    const data = response.json();
    assert.equal(data.tenant.name, 'Empresa titular@exemplo.test');
    assert.deepEqual(data.stores.map((s: { name: string }) => s.name), ['Loja TikTok']);
    assert.deepEqual(data.users.map((u: { email: string }) => u.email), ['titular@exemplo.test']);
    assert.ok(!/password_hash|mfa_secret_enc|credentials_enc|token_hash|scrypt\$/.test(response.body));
    assert.ok(!response.body.includes('alheio@exemplo.test') && !response.body.includes('Loja alheia'));
    assert.equal((await app.inject({ method: 'GET', url: '/api/account/export' })).statusCode, 401);
  });

  it('a sincronização automática ignora lojas por arquivo e registra a falha das conectadas sem parar', async () => {
    assert.deepEqual(await syncConnectedStores(db, config), { stores: 0, succeeded: 0, failed: [] });
    // Loja marcada como conectada por API, mas sem autorização guardada: tem de falhar de forma contida.
    db.prepare("UPDATE stores SET connector = 'tiktok' WHERE id = ?").run(storeId);
    const report = await syncConnectedStores(db, config);
    assert.deepEqual([report.stores, report.succeeded, report.failed.length], [1, 0, 1]);
    const { entries } = (await get(owner, '/api/activity')).json();
    assert.ok(entries.some((entry: { action: string }) => entry.action === 'SINCRONIZACAO_FALHOU'));
    db.prepare("UPDATE stores SET connector = 'tiktok-import' WHERE id = ?").run(storeId);
  });

  it('avisa no painel sobre prazo de contestação vencendo', async () => {
    const dashboard = (await get(owner, '/api/dashboard')).json();
    assert.deepEqual(dashboard.expiring, { count: 0, cents: 0, firstDeadline: null });
  });
});
