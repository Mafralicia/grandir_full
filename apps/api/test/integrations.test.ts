import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/config';
import { kindFromCfop, parseNfeXml, toEngineInvoices, validAccessKey } from '../src/connectors/erp/nfe';
import { openDb, type Db } from '../src/db';
import { createHttp, IntegrationError, runtime } from '../src/integrations/http';
import { mlAuthorizeUrl } from '../src/integrations/mercadolivre';
import { shopeeAuthorizeUrl, shopeeSign, type ShopeeApp } from '../src/integrations/shopee';
import { buildApp } from '../src/server';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const realFetch = runtime.fetch;
const realSleep = runtime.sleep;
let calls: { url: string; init?: RequestInit }[] = [];
let sleeps: number[] = [];
function stub(handler: (url: string, init?: RequestInit) => Response) {
  runtime.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return handler(String(input), init);
  }) as typeof fetch;
}
beforeEach(() => {
  calls = [];
  sleeps = [];
  runtime.sleep = async (ms) => void sleeps.push(ms);
});
after(() => {
  runtime.fetch = realFetch;
  runtime.sleep = realSleep;
});

describe('cliente HTTP das integrações', () => {
  it('tenta de novo em 429 respeitando Retry-After e em 5xx com espera crescente', async () => {
    const replies = [json({}, 429, { 'retry-after': '2' }), json({}, 503), json({ ok: true })];
    stub(() => replies.shift()!);
    assert.deepEqual(await createHttp({ minIntervalMs: 0 }).json('https://api.exemplo.test/x'), { ok: true });
    assert.equal(calls.length, 3);
    assert.deepEqual(sleeps, [2000, 1000]);
  });

  it('desiste após o limite de tentativas e não repete erro do cliente', async () => {
    stub(() => json({ message: 'indisponível' }, 500));
    await assert.rejects(createHttp({ minIntervalMs: 0, maxRetries: 2 }).json('https://api.exemplo.test/x'), IntegrationError);
    assert.equal(calls.length, 3);

    calls = [];
    stub(() => json({ message: 'não autorizado' }, 401));
    await assert.rejects(createHttp({ minIntervalMs: 0 }).json('https://api.exemplo.test/x'), (error: IntegrationError) => error.status === 401);
    assert.equal(calls.length, 1);
  });

  it('espaça as requisições pelo intervalo mínimo', async () => {
    stub(() => json({}));
    const http = createHttp({ minIntervalMs: 300 });
    await Promise.all([http.json('https://api.exemplo.test/1'), http.json('https://api.exemplo.test/2')]);
    assert.equal(sleeps.length, 1);
    assert.ok(sleeps[0] > 200 && sleeps[0] <= 300);
  });
});

describe('assinatura e URLs de autorização', () => {
  const shopee: ShopeeApp = { partnerId: '2001887', partnerKey: 'chave-de-teste', redirectUri: 'https://app.exemplo.test/api/oauth/shopee/callback', host: 'https://openplatform.shopee.com.br' };

  it('assina chamadas da Shopee com HMAC-SHA256 sobre a base documentada', () => {
    const path = '/api/v2/order/get_order_list';
    const expected = createHmac('sha256', 'chave-de-teste').update(`2001887${path}1700000000TOKEN9988`).digest('hex');
    assert.equal(shopeeSign(shopee, path, 1_700_000_000, 'TOKEN', '9988'), expected);
    assert.notEqual(shopeeSign(shopee, path, 1_700_000_001, 'TOKEN', '9988'), expected);
  });

  it('monta as URLs de autorização com o state', () => {
    const ml = new URL(mlAuthorizeUrl({ clientId: '123', clientSecret: 's', redirectUri: 'https://app.exemplo.test/cb' }, 'estado-1'));
    assert.equal(ml.origin, 'https://auth.mercadolivre.com.br');
    assert.deepEqual([ml.searchParams.get('response_type'), ml.searchParams.get('client_id'), ml.searchParams.get('state')], ['code', '123', 'estado-1']);

    const sp = new URL(shopeeAuthorizeUrl(shopee, 'estado-2', 1_700_000_000));
    assert.equal(sp.pathname, '/api/v2/shop/auth_partner');
    assert.equal(new URL(sp.searchParams.get('redirect')!).searchParams.get('state'), 'estado-2');
    assert.equal(sp.searchParams.get('sign'), shopeeSign(shopee, '/api/v2/shop/auth_partner', 1_700_000_000));
  });
});

// ───────────────────────── OAuth de ponta a ponta ─────────────────────────

describe('OAuth e coleta de dados reais (API simulada)', () => {
  let app: FastifyInstance;
  let db: Db;
  let seller: { cookie: string; csrf: string };
  let intruder: { cookie: string; csrf: string };
  let storeId: string;
  let refreshes = 0;

  const signup = async (email: string) => {
    const response = await app.inject({
      method: 'POST', url: '/api/auth/signup',
      payload: { firstName: 'Ana', lastName: 'Lima', phone: '+55 11 98888-7777', companyName: email, isAgency: false, country: 'BR', revenueBand: '1M_3M', email, password: 'Senha-Forte-2026!', acceptTerms: true },
    });
    return { cookie: String(response.headers['set-cookie']).split(';')[0], csrf: response.json().csrfToken as string };
  };
  const post = (who: typeof seller, url: string, payload: object = {}) =>
    app.inject({ method: 'POST', url, payload, headers: { cookie: who.cookie, 'x-csrf-token': who.csrf } });
  const get = (who: typeof seller, url: string) => app.inject({ method: 'GET', url, headers: { cookie: who.cookie } });

  const saleDate = new Date(Date.now() - 5 * 86_400_000).toISOString();
  /** Mercado Livre de mentira: um pedido de R$ 100 com tarifa de R$ 15 (o correto seria 12%). */
  const fakeMercadoLivre = (expiresIn: number) => (url: string, init?: RequestInit) => {
    const { pathname } = new URL(url);
    if (pathname === '/oauth/token') {
      const grant = new URLSearchParams(String(init?.body)).get('grant_type');
      if (grant === 'refresh_token') refreshes += 1;
      return json({ access_token: `ACCESS-${grant}`, refresh_token: 'REFRESH-SECRETO', expires_in: expiresIn, user_id: 4242 });
    }
    if (pathname === '/orders/search') {
      return json({ paging: { total: 1 }, results: [{
        id: 2000001, date_created: saleDate, total_amount: 100, shipping: { id: 777 },
        order_items: [{ item: { id: 'MLB123', seller_sku: 'SKU-A', category_id: 'MLB-OUTRA' }, quantity: 1, unit_price: 100, sale_fee: 15, listing_type_id: 'gold_special' }],
        payments: [{ status: 'approved', date_approved: saleDate }],
      }] });
    }
    if (pathname === '/shipments/777') return json({ id: 777, status: 'delivered', tracking_number: 'ME999BR' });
    if (pathname === '/shipments/777/costs') return json({ senders: [{ cost: 12.95 }] });
    return json({ message: 'rota não simulada' }, 404);
  };

  before(async () => {
    const config = loadConfig({
      NODE_ENV: 'test', GRANDIR_DEMO_MODE: 'true', UPLOAD_DIR: mkdtempSync(join(tmpdir(), 'grandir-test-')),
      ML_CLIENT_ID: 'app-ml', ML_CLIENT_SECRET: 'segredo-ml', WEB_ORIGIN: 'http://localhost:5173',
    });
    db = openDb(':memory:');
    app = await buildApp({ config, db, mailer: { send: async () => undefined } });
    seller = await signup('oauth@exemplo.test');
    intruder = await signup('intruso@exemplo.test');
    storeId = (await post(seller, '/api/stores', { name: 'Loja ML', marketplace: 'mercadolivre', region: 'BR' })).json().id;
  });
  after(async () => {
    await app.close();
    db.close();
  });

  const start = async () => new URL((await post(seller, `/api/stores/${storeId}/oauth/start`)).json().url).searchParams.get('state')!;

  it('recusa integração não configurada', async () => {
    const shopeeStore = (await post(intruder, '/api/stores', { name: 'Loja Shopee', marketplace: 'shopee', region: 'BR' })).json().id;
    const response = await post(intruder, `/api/stores/${shopeeStore}/oauth/start`);
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error.code, 'INTEGRACAO_NAO_CONFIGURADA');
  });

  it('prende o state a quem iniciou e só o aceita uma vez', async () => {
    stub(fakeMercadoLivre(21_600));
    const state = await start();
    const hijack = await get(intruder, `/api/oauth/mercadolivre/callback?code=abc&state=${state}`);
    assert.equal(hijack.statusCode, 400);
    assert.equal(hijack.json().error.code, 'STATE_INVALIDO');
    assert.equal((await get(seller, `/api/oauth/mercadolivre/callback?code=abc&state=${'x'.repeat(40)}`)).statusCode, 400);
    assert.equal(calls.length, 0, 'nenhuma chamada externa com state inválido');
  });

  it('troca o código por tokens, cifra em repouso e ativa o conector real', async () => {
    stub(fakeMercadoLivre(60));
    const state = await start();
    const callback = await get(seller, `/api/oauth/mercadolivre/callback?code=CODIGO&state=${state}`);
    assert.equal(callback.statusCode, 302);
    assert.equal(callback.headers.location, 'http://localhost:5173/app/lojas?conectada=mercadolivre');

    const sent = new URLSearchParams(String(calls[0].init?.body));
    assert.deepEqual([sent.get('grant_type'), sent.get('code'), sent.get('client_secret')], ['authorization_code', 'CODIGO', 'segredo-ml']);

    const row = db.prepare('SELECT connector, credentials_enc FROM stores WHERE id = ?').get(storeId) as { connector: string; credentials_enc: string };
    assert.equal(row.connector, 'mercadolivre');
    assert.ok(!row.credentials_enc.includes('REFRESH-SECRETO') && !row.credentials_enc.includes('ACCESS-'));

    assert.equal((await get(seller, `/api/oauth/mercadolivre/callback?code=CODIGO&state=${state}`)).statusCode, 400, 'state de uso único');
    assert.equal((await get(seller, '/api/discrepancies')).json().discrepancies.length, 0, 'dados de demonstração removidos');
  });

  it('renova o token vencido e audita com os dados da API', async () => {
    stub(fakeMercadoLivre(21_600));
    const audit = await post(seller, `/api/stores/${storeId}/audit`);
    assert.equal(audit.statusCode, 200, audit.body);
    assert.equal(refreshes, 1, 'token com menos de 5 minutos de validade é renovado antes da coleta');
    const search = calls.find((call) => call.url.includes('/orders/search'))!;
    assert.equal((search.init?.headers as Record<string, string>).authorization, 'Bearer ACCESS-refresh_token');
    assert.equal(new URL(search.url).searchParams.get('seller'), '4242');

    const { discrepancies } = (await get(seller, '/api/discrepancies')).json();
    assert.deepEqual(discrepancies.map((d: { type: string; sku: string; estimatedValueCents: number }) => [d.type, d.sku, d.estimatedValueCents]), [['ML_COMMISSION_OVERCHARGE', 'SKU-A', 300]]);

    await post(seller, `/api/stores/${storeId}/audit`);
    assert.equal(refreshes, 1, 'token ainda válido não é renovado de novo');
  });

  it('devolve erro claro quando o marketplace falha', async () => {
    stub(() => json({ message: 'invalid_token' }, 401));
    const audit = await post(seller, `/api/stores/${storeId}/audit`);
    assert.equal(audit.statusCode, 502);
    assert.equal(audit.json().error.code, 'MARKETPLACE_INDISPONIVEL');
  });

  // ───────────── NF-e pela API ─────────────

  it('importa XML de NF-e em lote, ignora repetidas e explica as recusadas', async () => {
    const put = (files: { name: string; xml: string }[]) =>
      app.inject({ method: 'PUT', url: `/api/stores/${storeId}/nfe`, payload: { files }, headers: { cookie: seller.cookie, 'x-csrf-token': seller.csrf } });
    stub(fakeMercadoLivre(21_600));
    const first = await put([
      { name: 'venda.xml', xml: nfeXml({ cfop: '5102', number: 1 }) },
      { name: 'remessa.xml', xml: nfeXml({ cfop: '5949', number: 2 }) },
      { name: 'modelo65.xml', xml: nfeXml({ cfop: '5102', number: 3, model: '65' }) },
      { name: 'lixo.xml', xml: '<nada/>' },
    ]);
    assert.equal(first.statusCode, 200, first.body);
    const result = first.json();
    assert.deepEqual([result.imported, result.duplicates, result.byKind], [2, 0, { VENDA: 1, REMESSA: 1 }]);
    assert.deepEqual(result.errors.map((e: { file: string }) => e.file), ['modelo65.xml', 'lixo.xml']);
    assert.equal((await put([{ name: 'venda.xml', xml: nfeXml({ cfop: '5102', number: 1 }) }])).json().duplicates, 1);
    assert.equal((await get(seller, '/api/stores')).json().stores.find((s: { id: string }) => s.id === storeId).nfeCount, 2);
    assert.equal((await app.inject({ method: 'PUT', url: `/api/stores/${storeId}/nfe`, payload: { files: [{ name: 'a.xml', xml: nfeXml({ cfop: '5102', number: 9 }) }] }, headers: { cookie: intruder.cookie, 'x-csrf-token': intruder.csrf } })).statusCode, 404);
  });
});

// ───────────────────────── Leitor de NF-e ─────────────────────────

/** Chave de acesso válida: 43 dígitos mais o dígito verificador (módulo 11). */
function accessKey(number: number, model = '55'): string {
  const base = `352610${'11222333000181'}${model}001${String(number).padStart(9, '0')}1${String(number).padStart(8, '0')}`;
  let sum = 0;
  for (let i = 42, weight = 2; i >= 0; i--, weight = weight === 9 ? 2 : weight + 1) sum += Number(base[i]) * weight;
  const rest = sum % 11;
  return base + (rest < 2 ? 0 : 11 - rest);
}

function nfeXml(options: { cfop: string; number: number; model?: string; key?: string }): string {
  const model = options.model ?? '55';
  const key = options.key ?? accessKey(options.number, model);
  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${key}" versao="4.00">
  <ide><mod>${model}</mod><serie>1</serie><nNF>${options.number}</nNF><dhEmi>2026-10-05T14:30:00-03:00</dhEmi></ide>
  <emit><CNPJ>11222333000181</CNPJ><xNome>Casa Aurora</xNome></emit>
  <dest><CNPJ>03007331000141</CNPJ></dest>
  <det nItem="1"><prod><cProd>GRD-FON-004</cProd><cEAN>7891234567895</cEAN><xProd>Fone &amp; estojo</xProd><CFOP>${options.cfop}</CFOP><qCom>10.0000</qCom><vUnCom>189.0000</vUnCom><vProd>1890.00</vProd><xPed>INB-000123</xPed></prod></det>
  <det nItem="2"><prod><cProd>GRD-COR-015</cProd><cEAN>SEM GTIN</cEAN><xProd>Corda de pular</xProd><CFOP>${options.cfop}</CFOP><qCom>4</qCom><vUnCom>19.00</vUnCom><vProd>76.00</vProd></prod></det>
  <total><ICMSTot><vProd>1966.00</vProd><vFrete>30.00</vFrete><vICMS>353.88</vICMS><vIPI>0.00</vIPI><vNF>1996.00</vNF></ICMSTot></total>
  <transp><vol><pesoL>3.720</pesoL><pesoB>4.150</pesoB></vol></transp>
</infNFe></NFe><protNFe><infProt><chNFe>${key}</chNFe></infProt></protNFe></nfeProc>`;
}

describe('leitor de XML de NF-e (modelo 55)', () => {
  it('extrai chave, CFOP, itens, pesos e valores fiscais', () => {
    const nfe = parseNfeXml(nfeXml({ cfop: '5949', number: 7 }));
    assert.equal(nfe.accessKey, accessKey(7));
    assert.deepEqual([nfe.kind, nfe.cfop, nfe.number, nfe.issuerCnpj], ['REMESSA', '5949', '7', '11222333000181']);
    assert.equal(nfe.issuedAt, '2026-10-05T17:30:00.000Z');
    assert.deepEqual(nfe.items[0], { sku: 'GRD-FON-004', ean: '7891234567895', name: 'Fone &amp; estojo', cfop: '5949', quantity: 10, unitCents: 18_900, totalCents: 189_000, orderRef: 'INB-000123' });
    assert.equal(nfe.items[1].ean, '', '"SEM GTIN" não vira código de barras');
    assert.deepEqual([nfe.grossWeightKg, nfe.netWeightKg], [4.15, 3.72]);
    assert.deepEqual(nfe.totals, { productsCents: 196_600, freightCents: 3_000, icmsCents: 35_388, ipiCents: 0, invoiceCents: 199_600 });

    const lines = toEngineInvoices(nfe);
    assert.deepEqual([lines.length, lines[0].kind, lines[0].inboundId, lines[0].orderId], [2, 'REMESSA', 'INB-000123', undefined]);
  });

  it('classifica a operação pelo CFOP', () => {
    const cases: [string, string | null][] = [
      ['5905', 'REMESSA'], ['6949', 'REMESSA'], ['1906', 'RETORNO'], ['5102', 'VENDA'], ['6108', 'VENDA'], ['5405', 'VENDA'],
      ['1202', 'DEVOLUCAO'], ['2411', 'DEVOLUCAO'], ['1102', 'ENTRADA'], ['2403', 'ENTRADA'], ['5915', null],
    ];
    for (const [cfop, kind] of cases) assert.equal(kindFromCfop(cfop), kind, cfop);
  });

  it('recusa chave com dígito verificador errado, outros modelos e XML sem nota', () => {
    const good = accessKey(11);
    assert.ok(validAccessKey(good));
    const bad = good.slice(0, 43) + ((Number(good[43]) + 1) % 10);
    assert.ok(!validAccessKey(bad));
    assert.throws(() => parseNfeXml(nfeXml({ cfop: '5102', number: 11, key: bad })), /dígito verificador/);
    assert.throws(() => parseNfeXml(nfeXml({ cfop: '5102', number: 12, model: '65' })), /modelo 55/);
    assert.throws(() => parseNfeXml('<html></html>'), /infNFe ausente/);
    assert.throws(() => parseNfeXml(nfeXml({ cfop: '5915', number: 13 })), /CFOP 5915/);
  });

  it('não expande entidades externas declaradas no arquivo', () => {
    const xml = nfeXml({ cfop: '5102', number: 14 }).replace('<nfeProc', '<!DOCTYPE x [<!ENTITY segredo SYSTEM "file:///c:/windows/win.ini">]>\n<nfeProc').replace('Corda de pular', '&segredo;');
    let name = '';
    try {
      name = parseNfeXml(xml).items[1].name;
    } catch {
      return; // recusar o arquivo também é aceitável
    }
    assert.ok(!/\[fonts\]|extensions/i.test(name), 'conteúdo de arquivo local não pode aparecer');
  });
});
