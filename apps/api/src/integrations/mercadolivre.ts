import { createHttp, type Http } from './http';

/**
 * Cliente da API do Mercado Livre (OAuth 2.0 com authorization code).
 *
 * Escrito a partir da documentação pública de desenvolvedores; ainda NÃO foi exercitado
 * contra a API real — só contra respostas simuladas nos testes. Nomes de campos e de
 * rotas devem ser conferidos na primeira conexão com uma conta de verdade.
 */
const AUTH_HOST = 'https://auth.mercadolivre.com.br';
const API_HOST = 'https://api.mercadolibre.com';

export interface MlApp {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Instante de expiração do access token (ISO). */
  expiresAt: string;
  /** Identificador da conta no marketplace: user_id (ML) ou shop_id (Shopee). */
  externalId: string;
}

export function mlAuthorizeUrl(app: MlApp, state: string): string {
  const query = new URLSearchParams({ response_type: 'code', client_id: app.clientId, redirect_uri: app.redirectUri, state });
  return `${AUTH_HOST}/authorization?${query}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id: number;
}

async function token(http: Http, app: MlApp, params: Record<string, string>): Promise<OAuthTokens> {
  const response = await http.json<TokenResponse>(`${API_HOST}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, ...params }).toString(),
  });
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    expiresAt: new Date(Date.now() + response.expires_in * 1000).toISOString(),
    externalId: String(response.user_id),
  };
}

export const mlExchangeCode = (app: MlApp, code: string, http = createHttp()) =>
  token(http, app, { grant_type: 'authorization_code', code, redirect_uri: app.redirectUri });

export const mlRefresh = (app: MlApp, refreshToken: string, http = createHttp()) =>
  token(http, app, { grant_type: 'refresh_token', refresh_token: refreshToken });

// ───────────── Recursos ─────────────

export interface MlOrder {
  id: number;
  date_created: string;
  total_amount: number;
  shipping?: { id?: number };
  order_items: {
    item: { id: string; seller_sku?: string | null; category_id?: string };
    quantity: number;
    unit_price: number;
    sale_fee?: number;
    listing_type_id?: string;
  }[];
  payments?: { status?: string; date_approved?: string | null; total_paid_amount?: number }[];
}

export interface MlShipment {
  id: number;
  status?: string;
  substatus?: string | null;
  tracking_number?: string | null;
  date_created?: string;
  /** Peso, em gramas, que a transportadora usou na cobrança. */
  dimensions?: { weight?: number } | null;
}

export interface MlShipmentCosts {
  senders?: { cost?: number }[];
}

export interface MlClaim {
  id: number;
  resource_id: number;
  type: string;
  stage?: string;
  status: string;
  date_created: string;
  last_updated: string;
  resolution?: { reason?: string; benefited?: string[]; closed_by?: string } | null;
}

export interface MercadoLivreClient {
  orders(from: string, to: string): Promise<MlOrder[]>;
  shipment(id: number): Promise<MlShipment>;
  shipmentCosts(id: number): Promise<MlShipmentCosts>;
  claims(from: string): Promise<MlClaim[]>;
}

export function mercadoLivreClient(tokens: OAuthTokens, http: Http = createHttp({ minIntervalMs: 200 })): MercadoLivreClient {
  const get = <T>(path: string, headers: Record<string, string> = {}) =>
    http.json<T>(`${API_HOST}${path}`, { headers: { authorization: `Bearer ${tokens.accessToken}`, accept: 'application/json', ...headers } });

  async function paged<T>(path: (offset: number) => string, pick: (page: any) => T[], total: (page: any) => number, limit: number): Promise<T[]> {
    const all: T[] = [];
    // Trava de segurança: nunca mais que 200 páginas em uma coleta.
    for (let offset = 0, page = 0; page < 200; page++, offset += limit) {
      const data = await get<any>(path(offset));
      all.push(...pick(data));
      if (all.length >= total(data) || pick(data).length === 0) break;
    }
    return all;
  }

  return {
    orders: (from, to) =>
      paged<MlOrder>(
        (offset) =>
          `/orders/search?${new URLSearchParams({ seller: tokens.externalId, 'order.date_created.from': from, 'order.date_created.to': to, sort: 'date_asc', offset: String(offset), limit: '50' })}`,
        (page) => page.results ?? [],
        (page) => page.paging?.total ?? 0,
        50,
      ),
    shipment: (id) => get<MlShipment>(`/shipments/${id}`, { 'x-format-new': 'true' }),
    shipmentCosts: (id) => get<MlShipmentCosts>(`/shipments/${id}/costs`),
    claims: (from) =>
      paged<MlClaim>(
        (offset) => `/post-purchase/v1/claims/search?${new URLSearchParams({ 'date_created.from': from, sort: 'date_created:asc', offset: String(offset), limit: '50' })}`,
        (page) => page.data ?? [],
        (page) => page.paging?.total ?? 0,
        50,
      ),
  };
}
