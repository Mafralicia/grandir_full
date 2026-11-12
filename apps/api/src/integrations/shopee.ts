import { createHmac } from 'node:crypto';
import { createHttp, IntegrationError, type Http } from './http';
import type { OAuthTokens } from './mercadolivre';

/**
 * Cliente da Shopee Open Platform (API v2).
 *
 * Escrito a partir da documentação pública; ainda NÃO foi exercitado contra a API real —
 * só contra respostas simuladas nos testes. O host do Brasil, os nomes de campos e os
 * limites de janela de consulta devem ser conferidos na primeira conexão real.
 */
export interface ShopeeApp {
  partnerId: string;
  partnerKey: string;
  redirectUri: string;
  host: string;
}

const now = () => Math.floor(Date.now() / 1000);

/**
 * Assinatura da Shopee: HMAC-SHA256, com a chave do parceiro, sobre
 * partner_id + caminho + timestamp (+ access_token + shop_id nas chamadas de loja).
 */
export function shopeeSign(app: ShopeeApp, path: string, timestamp: number, accessToken = '', shopId = ''): string {
  return createHmac('sha256', app.partnerKey).update(`${app.partnerId}${path}${timestamp}${accessToken}${shopId}`).digest('hex');
}

export function shopeeAuthorizeUrl(app: ShopeeApp, state: string, timestamp = now()): string {
  const path = '/api/v2/shop/auth_partner';
  // A Shopee não devolve um parâmetro state: ele viaja dentro da URL de retorno.
  const redirect = `${app.redirectUri}?${new URLSearchParams({ state })}`;
  const query = new URLSearchParams({ partner_id: app.partnerId, timestamp: String(timestamp), sign: shopeeSign(app, path, timestamp), redirect });
  return `${app.host}${path}?${query}`;
}

interface ShopeeToken {
  access_token?: string;
  refresh_token?: string;
  expire_in?: number;
  error?: string;
  message?: string;
}

async function token(http: Http, app: ShopeeApp, path: string, shopId: string, body: Record<string, unknown>): Promise<OAuthTokens> {
  const timestamp = now();
  const query = new URLSearchParams({ partner_id: app.partnerId, timestamp: String(timestamp), sign: shopeeSign(app, path, timestamp) });
  const response = await http.json<ShopeeToken>(`${app.host}${path}?${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, shop_id: Number(shopId), partner_id: Number(app.partnerId) }),
  });
  if (response.error || !response.access_token || !response.refresh_token) {
    throw new IntegrationError(400, `A Shopee recusou a autorização: ${response.message ?? response.error ?? 'resposta sem token'}.`, response);
  }
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    expiresAt: new Date(Date.now() + (response.expire_in ?? 14_400) * 1000).toISOString(),
    externalId: shopId,
  };
}

export const shopeeExchangeCode = (app: ShopeeApp, code: string, shopId: string, http = createHttp()) =>
  token(http, app, '/api/v2/auth/token/get', shopId, { code });

export const shopeeRefresh = (app: ShopeeApp, refreshToken: string, shopId: string, http = createHttp()) =>
  token(http, app, '/api/v2/auth/access_token/get', shopId, { refresh_token: refreshToken });

// ───────────── Recursos ─────────────

export interface ShopeeOrder {
  order_sn: string;
  create_time: number;
  item_list: { item_id: number; item_sku?: string; model_sku?: string; model_quantity_purchased: number; model_discounted_price: number }[];
  package_list?: { package_number?: string; logistics_status?: string }[];
}

export interface ShopeeEscrow {
  order_sn: string;
  order_income: {
    escrow_amount?: number;
    commission_fee?: number;
    service_fee?: number;
    seller_transaction_fee?: number;
    actual_shipping_fee?: number;
    escrow_release_time?: number;
  };
}

export interface ShopeeTracking {
  tracking_number?: string;
  logistics_status?: string;
}

export interface ShopeeClient {
  orders(from: Date, to: Date): Promise<ShopeeOrder[]>;
  escrow(orderSn: string): Promise<ShopeeEscrow>;
  tracking(orderSn: string): Promise<ShopeeTracking>;
}

const WINDOW_DAYS = 15;

export function shopeeClient(app: ShopeeApp, tokens: OAuthTokens, http: Http = createHttp({ minIntervalMs: 250 })): ShopeeClient {
  async function get<T>(path: string, params: Record<string, string>): Promise<T> {
    const timestamp = now();
    const query = new URLSearchParams({
      partner_id: app.partnerId,
      timestamp: String(timestamp),
      access_token: tokens.accessToken,
      shop_id: tokens.externalId,
      sign: shopeeSign(app, path, timestamp, tokens.accessToken, tokens.externalId),
      ...params,
    });
    const data = await http.json<{ error?: string; message?: string; response: T }>(`${app.host}${path}?${query}`);
    if (data.error) throw new IntegrationError(400, `Shopee: ${data.message ?? data.error}.`, data);
    return data.response;
  }

  return {
    async orders(from, to) {
      const serials: string[] = [];
      // A listagem aceita janelas de até 15 dias: percorre o período em fatias.
      for (let start = from.getTime(); start < to.getTime(); start += WINDOW_DAYS * 86_400_000) {
        const end = Math.min(start + WINDOW_DAYS * 86_400_000, to.getTime());
        for (let cursor = '', page = 0; page < 100; page++) {
          const list = await get<{ more: boolean; next_cursor: string; order_list: { order_sn: string }[] }>('/api/v2/order/get_order_list', {
            time_range_field: 'create_time', time_from: String(Math.floor(start / 1000)), time_to: String(Math.floor(end / 1000)), page_size: '100', cursor,
          });
          serials.push(...list.order_list.map((order) => order.order_sn));
          if (!list.more) break;
          cursor = list.next_cursor;
        }
      }
      const orders: ShopeeOrder[] = [];
      for (let index = 0; index < serials.length; index += 50) {
        const detail = await get<{ order_list: ShopeeOrder[] }>('/api/v2/order/get_order_detail', {
          order_sn_list: serials.slice(index, index + 50).join(','), response_optional_fields: 'item_list,package_list',
        });
        orders.push(...detail.order_list);
      }
      return orders;
    },
    escrow: (orderSn) => get<ShopeeEscrow>('/api/v2/payment/get_escrow_detail', { order_sn: orderSn }),
    tracking: (orderSn) => get<ShopeeTracking>('/api/v2/logistics/get_tracking_info', { order_sn: orderSn }),
  };
}
