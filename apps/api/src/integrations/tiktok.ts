import { createHmac } from 'node:crypto';
import { createHttp, IntegrationError, type Http } from './http';
import type { OAuthTokens } from './mercadolivre';

/**
 * Cliente da TikTok Shop Partner API.
 *
 * Escrito a partir de descrições públicas da API; ainda NÃO foi exercitado contra a API
 * real — só contra respostas simuladas nos testes. Hosts, versão dos caminhos e nomes de
 * campos devem ser conferidos no Partner Center ao registrar o aplicativo.
 */
export interface TikTokApp {
  appKey: string;
  appSecret: string;
  /** Identificador do serviço no Partner Center; é ele que vai na URL de autorização. */
  serviceId: string;
  authHost: string;
  tokenHost: string;
  apiHost: string;
}

const now = () => Math.floor(Date.now() / 1000);

/** A URL de retorno é a cadastrada no Partner Center; a autorização só leva o serviço e o state. */
export function tiktokAuthorizeUrl(app: TikTokApp, state: string): string {
  return `${app.authHost}/open/authorize?${new URLSearchParams({ service_id: app.serviceId, state })}`;
}

/**
 * Assinatura: HMAC-SHA256, com o segredo do app, sobre
 * segredo + caminho + (chave+valor de cada parâmetro, em ordem alfabética, sem `sign` e
 * sem `access_token`) + corpo + segredo.
 */
export function tiktokSign(app: TikTokApp, path: string, params: Record<string, string>, body = ''): string {
  const joined = Object.keys(params)
    .filter((key) => key !== 'sign' && key !== 'access_token')
    .sort()
    .map((key) => key + params[key])
    .join('');
  return createHmac('sha256', app.appSecret).update(`${app.appSecret}${path}${joined}${body}${app.appSecret}`).digest('hex');
}

interface Envelope<T> {
  code: number;
  message?: string;
  data?: T;
}

function unwrap<T>(response: Envelope<T>, what: string): T {
  if (response.code !== 0 || response.data === undefined) {
    throw new IntegrationError(400, `TikTok Shop recusou ${what}: ${response.message ?? `código ${response.code}`}.`, response);
  }
  return response.data;
}

interface TokenData {
  access_token: string;
  access_token_expire_in: number;
  refresh_token: string;
  open_id?: string;
}

/** A validade vem como instante absoluto (segundos Unix); aceita também duração, por segurança. */
const expiry = (value: number) => new Date((value > 1_000_000_000 ? value : now() + value) * 1000).toISOString();

async function token(http: Http, app: TikTokApp, path: string, params: Record<string, string>, shopCipher: string): Promise<OAuthTokens> {
  const query = new URLSearchParams({ app_key: app.appKey, app_secret: app.appSecret, ...params });
  const data = unwrap(await http.json<Envelope<TokenData>>(`${app.tokenHost}${path}?${query}`), 'a autorização');
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: expiry(data.access_token_expire_in), externalId: shopCipher };
}

/** Troca o código por tokens e descobre a loja autorizada (o shop_cipher identifica a loja nas chamadas). */
export async function tiktokExchangeCode(app: TikTokApp, authCode: string, http = createHttp()): Promise<OAuthTokens> {
  const tokens = await token(http, app, '/api/v2/token/get', { auth_code: authCode, grant_type: 'authorized_code' }, '');
  const shops = await tiktokClient(app, tokens, http).shops();
  if (shops.length === 0) throw new IntegrationError(400, 'A conta do TikTok Shop autorizada não tem nenhuma loja.', null);
  return { ...tokens, externalId: shops[0].cipher };
}

export const tiktokRefresh = (app: TikTokApp, refreshToken: string, shopCipher: string, http = createHttp()) =>
  token(http, app, '/api/v2/token/refresh', { refresh_token: refreshToken, grant_type: 'refresh_token' }, shopCipher);

// ───────────── Recursos ─────────────

export interface TikTokShop {
  id: string;
  cipher: string;
  name?: string;
  region?: string;
}

export interface TikTokOrder {
  id: string;
  create_time: number;
  status?: string;
  tracking_number?: string;
  line_items: { id?: string; product_id?: string; seller_sku?: string; sale_price?: string; quantity?: number }[];
  packages?: { id?: string }[];
}

export interface TikTokClient {
  shops(): Promise<TikTokShop[]>;
  orders(from: Date, to: Date): Promise<TikTokOrder[]>;
}

export function tiktokClient(app: TikTokApp, tokens: OAuthTokens, http: Http = createHttp({ minIntervalMs: 250 })): TikTokClient {
  async function call<T>(method: 'GET' | 'POST', path: string, params: Record<string, string>, body?: object): Promise<T> {
    const payload = body ? JSON.stringify(body) : '';
    const signed: Record<string, string> = { app_key: app.appKey, timestamp: String(now()), ...params };
    signed.sign = tiktokSign(app, path, signed, payload);
    const response = await http.json<Envelope<T>>(`${app.apiHost}${path}?${new URLSearchParams(signed)}`, {
      method,
      headers: { 'x-tts-access-token': tokens.accessToken, 'content-type': 'application/json' },
      body: body ? payload : undefined,
    });
    return unwrap(response, `a chamada ${path}`);
  }

  return {
    async shops() {
      return (await call<{ shops?: TikTokShop[] }>('GET', '/authorization/202309/shops', {})).shops ?? [];
    },
    async orders(from, to) {
      const all: TikTokOrder[] = [];
      for (let pageToken = '', page = 0; page < 200; page++) {
        const data = await call<{ orders?: TikTokOrder[]; next_page_token?: string }>(
          'POST',
          '/order/202309/orders/search',
          { shop_cipher: tokens.externalId, page_size: '100', ...(pageToken ? { page_token: pageToken } : {}) },
          { create_time_ge: Math.floor(from.getTime() / 1000), create_time_lt: Math.floor(to.getTime() / 1000) },
        );
        all.push(...(data.orders ?? []));
        if (!data.next_page_token) break;
        pageToken = data.next_page_token;
      }
      return all;
    },
  };
}
