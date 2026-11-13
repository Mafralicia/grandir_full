import type { Config } from '../config';
import { AppError } from '../errors';
import { decrypt, encrypt } from '../security/crypto';
import type { TenantScope } from '../tenant';
import { mlRefresh, type MlApp, type OAuthTokens } from './mercadolivre';
import { shopeeRefresh, type ShopeeApp } from './shopee';
import { tiktokRefresh, type TikTokApp } from './tiktok';

export type LiveMarketplace = 'mercadolivre' | 'shopee' | 'tiktok';
export const LIVE_MARKETPLACES: readonly LiveMarketplace[] = ['mercadolivre', 'shopee', 'tiktok'];

/** Credenciais do aplicativo registrado em cada marketplace; ausentes = integração desligada. */
export interface IntegrationApps {
  mercadolivre: MlApp | null;
  shopee: ShopeeApp | null;
  tiktok: TikTokApp | null;
}

export function requireApp<M extends LiveMarketplace>(apps: IntegrationApps, marketplace: M): NonNullable<IntegrationApps[M]> {
  const app = apps[marketplace];
  if (!app) {
    throw new AppError(503, 'INTEGRACAO_NAO_CONFIGURADA', 'A integração com este marketplace ainda não foi configurada neste ambiente (credenciais do aplicativo ausentes).');
  }
  return app as NonNullable<IntegrationApps[M]>;
}

/** Tokens ficam cifrados em repouso (AES-256-GCM), junto com a loja. */
export function saveTokens(scope: TenantScope, config: Config, storeId: string, tokens: OAuthTokens): void {
  scope.run('UPDATE stores SET credentials_enc = :enc WHERE tenant_id = :tenantId AND id = :storeId', {
    enc: encrypt(JSON.stringify(tokens), config.encryptionKey),
    storeId,
  });
}

/**
 * Devolve tokens válidos para a loja, renovando o access token quando faltam menos de
 * cinco minutos para expirar. O refresh token novo substitui o antigo.
 */
export async function freshTokens(scope: TenantScope, config: Config, storeId: string, marketplace: LiveMarketplace): Promise<OAuthTokens> {
  const row = scope.get<{ credentials_enc: string | null }>('SELECT credentials_enc FROM stores WHERE tenant_id = :tenantId AND id = :storeId', { storeId });
  if (!row?.credentials_enc) throw new AppError(409, 'LOJA_SEM_AUTORIZACAO', 'Esta loja ainda não autorizou o acesso à conta do marketplace.');
  const tokens = JSON.parse(decrypt(row.credentials_enc, config.encryptionKey)) as OAuthTokens;
  if (Date.parse(tokens.expiresAt) - Date.now() > 5 * 60_000) return tokens;

  const renewed =
    marketplace === 'mercadolivre'
      ? await mlRefresh(requireApp(config.integrations, 'mercadolivre'), tokens.refreshToken)
      : marketplace === 'shopee'
        ? await shopeeRefresh(requireApp(config.integrations, 'shopee'), tokens.refreshToken, tokens.externalId)
        : await tiktokRefresh(requireApp(config.integrations, 'tiktok'), tokens.refreshToken, tokens.externalId);
  saveTokens(scope, config, storeId, renewed);
  return renewed;
}
