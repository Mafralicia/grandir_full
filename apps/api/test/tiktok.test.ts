import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/config';
import { openDb, type Db } from '../src/db';
import { runtime } from '../src/integrations/http';
import { tiktokAuthorizeUrl, tiktokSign, type TikTokApp } from '../src/integrations/tiktok';
import { buildApp } from '../src/server';

const app0: TikTokApp = { appKey: 'chave', appSecret: 'segredo', serviceId: '7001', authHost: 'https://services.tiktokshop.com', tokenHost: 'https://auth.tiktok-shops.com', apiHost: 'https://open-api.tiktokglobalshop.com' };
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('TikTok Shop: assinatura e autorização', () => {
  it('assina com o segredo antes e depois de caminho, parâmetros ordenados e corpo', () => {
    const params = { timestamp: '1700000000', app_key: 'chave', shop_cipher: 'CIFRA', sign: 'ignorado', access_token: 'ignorado' };
    const expected = createHmac('sha256', 'segredo').update('segredo/order/202309/orders/searchapp_keychaveshop_cipherCIFRAtimestamp1700000000{"a":1}segredo').digest('hex');
    assert.equal(tiktokSign(app0, '/order/202309/orders/search', params, '{"a":1}'), expected);
  });

  it('monta a URL de autorização com o serviço e o state', () => {
    const url = new URL(tiktokAuthorizeUrl(app0, 'estado'));
    assert.deepEqual([url.origin, url.pathname, url.searchParams.get('service_id'), url.searchParams.get('state')], ['https://services.tiktokshop.com', '/open/authorize', '7001', 'estado']);
  });
});

describe('TikTok Shop: OAuth e coleta (API simulada)', () => {
  let app: FastifyInstance;
  let db: Db;
  let seller: { cookie: string; csrf: string };
  let storeId: string;
  const calls: { url: URL; init?: RequestInit }[] = [];
  const realFetch = runtime.fetch;
  const realSleep = runtime.sleep;
  const created = Math.floor(Date.now() / 1000) - 20 * 86_400;

  before(async () => {
    runtime.sleep = async () => undefined;
    runtime.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push({ url, init });
      if (url.pathname === '/api/v2/token/get') return json({ code: 0, data: { access_token: 'TTS-ACESSO', access_token_expire_in: Math.floor(Date.now() / 1000) + 7 * 86_400, refresh_token: 'TTS-RENOVACAO', open_id: 'abc' } });
      if (url.pathname === '/authorization/202309/shops') return json({ code: 0, data: { shops: [{ id: '55', cipher: 'CIFRA-DA-LOJA', name: 'Loja', region: 'BR' }] } });
      if (url.pathname === '/order/202309/orders/search') return json({ code: 0, data: { orders: [{ id: 'TT-900', create_time: created, tracking_number: 'BR77', line_items: [{ product_id: 'P1', seller_sku: 'SKU-T', sale_price: '100.00', quantity: 1 }], packages: [{ id: 'PKG-1' }] }] } });
      return json({ code: 36009004, message: 'rota não simulada' });
    }) as typeof fetch;

    const config = loadConfig({
      NODE_ENV: 'test', UPLOAD_DIR: mkdtempSync(join(tmpdir(), 'grandir-test-')),
      TIKTOK_APP_KEY: 'chave', TIKTOK_APP_SECRET: 'segredo', TIKTOK_SERVICE_ID: '7001',
    });
    db = openDb(':memory:');
    app = await buildApp({ config, db, mailer: { send: async () => undefined } });
    const signup = await app.inject({
      method: 'POST', url: '/api/auth/signup',
      payload: { firstName: 'Ana', lastName: 'Lima', phone: '+55 11 98888-7777', companyName: 'TT', isAgency: false, country: 'BR', revenueBand: '1M_3M', email: 'tt@exemplo.test', password: 'Senha-Forte-2026!', acceptTerms: true },
    });
    seller = { cookie: String(signup.headers['set-cookie']).split(';')[0], csrf: signup.json().csrfToken };
    storeId = (await post('/api/stores', { name: 'Loja TikTok', marketplace: 'tiktok', region: 'BR' })).json().id;
  });
  after(async () => {
    runtime.fetch = realFetch;
    runtime.sleep = realSleep;
    await app.close();
    db.close();
  });

  const get = (url: string) => app.inject({ method: 'GET', url, headers: { cookie: seller.cookie } });
  const post = (url: string, payload: object = {}) => app.inject({ method: 'POST', url, payload, headers: { cookie: seller.cookie, 'x-csrf-token': seller.csrf } });

  it('conecta a loja, guarda o shop_cipher e cifra os tokens', async () => {
    assert.equal((await app.inject({ method: 'GET', url: '/api/meta' })).json().oauth.tiktok, true);
    const state = new URL((await post(`/api/stores/${storeId}/oauth/start`)).json().url).searchParams.get('state')!;
    const callback = await get(`/api/oauth/tiktok/callback?code=CODIGO-TT&state=${state}`);
    assert.equal(callback.statusCode, 302, callback.body);

    const exchange = calls.find((c) => c.url.pathname === '/api/v2/token/get')!;
    assert.deepEqual([exchange.url.origin, exchange.url.searchParams.get('auth_code'), exchange.url.searchParams.get('grant_type')], ['https://auth.tiktok-shops.com', 'CODIGO-TT', 'authorized_code']);
    const shops = calls.find((c) => c.url.pathname === '/authorization/202309/shops')!;
    assert.equal((shops.init?.headers as Record<string, string>)['x-tts-access-token'], 'TTS-ACESSO');
    assert.ok(shops.url.searchParams.get('sign'));

    const row = db.prepare('SELECT connector, credentials_enc FROM stores WHERE id = ?').get(storeId) as { connector: string; credentials_enc: string };
    assert.equal(row.connector, 'tiktok');
    assert.ok(!/TTS-ACESSO|TTS-RENOVACAO|CIFRA-DA-LOJA/.test(row.credentials_enc));
  });

  it('coleta os pedidos assinando com o shop_cipher e cruza com o extrato importado', async () => {
    // O extrato do pedido chega por arquivo: 100,00 − 6,00 − 10,00 = 84,00, mas só 80,00 foram liquidados.
    const day = (n: number) => { const d = new Date(Date.now() - n * 86_400_000); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`; };
    const csv = `pedido;data;sku;qtd;valor;comissao;frete;liquidado;data liquidacao\r\nTT-900;${day(20)};SKU-T;1;100,00;6,00;10,00;80,00;${day(12)}\r\n`;
    const mapping = { orderId: 'pedido', saleDate: 'data', sku: 'sku', quantity: 'qtd', grossCents: 'valor', commissionCents: 'comissao', shippingChargedCents: 'frete', settledCents: 'liquidado', settledAt: 'data liquidacao' };
    const imported = await app.inject({
      method: 'PUT', url: `/api/stores/${storeId}/imports/orders?filename=extrato.csv&mapping=${encodeURIComponent(JSON.stringify(mapping))}`,
      payload: Buffer.from(csv), headers: { cookie: seller.cookie, 'x-csrf-token': seller.csrf, 'content-type': 'application/octet-stream' },
    });
    assert.equal(imported.statusCode, 200, imported.body);

    const search = calls.find((c) => c.url.pathname === '/order/202309/orders/search')!;
    assert.equal(search.url.searchParams.get('shop_cipher'), 'CIFRA-DA-LOJA');
    assert.equal(search.init?.method, 'POST');
    const { discrepancies } = (await get('/api/discrepancies')).json();
    assert.deepEqual(discrepancies.map((d: { type: string; referenceId: string; estimatedValueCents: number }) => [d.type, d.referenceId, d.estimatedValueCents]), [['TIKTOK_PAYOUT_SHORTFALL', 'TT-900', 400]]);
  });
});
