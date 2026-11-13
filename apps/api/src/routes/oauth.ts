import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { logActivity, ROLE_RANK } from '../auth/service';
import type { Config } from '../config';
import { nowIso, type Db } from '../db';
import { badRequest, forbidden, notFound } from '../errors';
import { mlAuthorizeUrl, mlExchangeCode } from '../integrations/mercadolivre';
import { shopeeAuthorizeUrl, shopeeExchangeCode } from '../integrations/shopee';
import { tiktokAuthorizeUrl, tiktokExchangeCode } from '../integrations/tiktok';
import { LIVE_MARKETPLACES, requireApp, saveTokens, type LiveMarketplace } from '../integrations/tokens';
import { randomToken, sha256 } from '../security/crypto';

const STATE_MINUTES = 10;

/**
 * OAuth 2.0 (authorization code) com Mercado Livre e Shopee.
 *
 * O `state` é um token aleatório de uso único, guardado apenas como hash e preso ao
 * tenant, à loja e ao usuário que iniciou o fluxo: um retorno forjado, repetido ou
 * iniciado por outra conta é recusado.
 */
export async function oauthRoutes(
  app: FastifyInstance,
  deps: { db: Db; config: Config; requireAuth: (request: FastifyRequest) => Promise<void> },
): Promise<void> {
  const { db, config, requireAuth } = deps;
  const admin = [
    requireAuth,
    async (request: FastifyRequest) => {
      if (ROLE_RANK[request.auth!.user.role] < ROLE_RANK.ADMIN) throw forbidden();
    },
  ];

  app.post('/api/stores/:id/oauth/start', { preHandler: admin }, async (request) => {
    const { scope, user } = request.auth!;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const store = scope.get<{ marketplace: string }>('SELECT marketplace FROM stores WHERE tenant_id = :tenantId AND id = :id', { id });
    if (!store) throw notFound('Loja não encontrada.');
    if (!LIVE_MARKETPLACES.includes(store.marketplace as LiveMarketplace)) {
      throw badRequest('A conexão por API está disponível para lojas do Mercado Livre, da Shopee e do TikTok Shop.');
    }
    const marketplace = store.marketplace as LiveMarketplace;
    const state = randomToken();
    const url = marketplace === 'mercadolivre'
      ? mlAuthorizeUrl(requireApp(config.integrations, 'mercadolivre'), state)
      : marketplace === 'shopee'
        ? shopeeAuthorizeUrl(requireApp(config.integrations, 'shopee'), state)
        : tiktokAuthorizeUrl(requireApp(config.integrations, 'tiktok'), state);
    scope.run(
      `INSERT INTO oauth_states (state_hash, tenant_id, store_id, user_id, marketplace, expires_at)
       VALUES (:hash, :tenantId, :storeId, :userId, :marketplace, :expiresAt)`,
      { hash: sha256(state), storeId: id, userId: user.id, marketplace, expiresAt: new Date(Date.now() + STATE_MINUTES * 60_000).toISOString() },
    );
    return { url };
  });

  // Retorno do marketplace: navegação de topo do navegador, com o cookie de sessão do portal.
  app.get('/api/oauth/:marketplace/callback', { preHandler: requireAuth }, async (request, reply) => {
    const { scope, user } = request.auth!;
    const { marketplace } = z.object({ marketplace: z.enum(['mercadolivre', 'shopee', 'tiktok']) }).parse(request.params);
    // O TikTok Shop devolve o código como `code` ou `auth_code`, conforme a versão do fluxo.
    const raw = z
      .object({ code: z.string().min(1).max(1000).optional(), auth_code: z.string().min(1).max(1000).optional(), state: z.string().min(20).max(200), shop_id: z.string().regex(/^\d+$/).optional() })
      .parse(request.query);
    const code = raw.code ?? raw.auth_code;
    if (!code) throw badRequest('O marketplace não devolveu o código de autorização.');
    const query = { ...raw, code };

    const hash = sha256(query.state);
    const pending = scope.get<{ store_id: string; user_id: string; marketplace: string; expires_at: string }>(
      'SELECT store_id, user_id, marketplace, expires_at FROM oauth_states WHERE tenant_id = :tenantId AND state_hash = :hash',
      { hash },
    );
    // Uso único: o state é apagado antes de qualquer chamada externa.
    scope.run('DELETE FROM oauth_states WHERE tenant_id = :tenantId AND state_hash = :hash', { hash });
    if (!pending || pending.user_id !== user.id || pending.marketplace !== marketplace || pending.expires_at <= nowIso()) {
      throw badRequest('Autorização inválida ou expirada. Inicie a conexão novamente em Lojas.', 'STATE_INVALIDO');
    }

    let tokens;
    if (marketplace === 'mercadolivre') {
      tokens = await mlExchangeCode(requireApp(config.integrations, 'mercadolivre'), query.code);
    } else if (marketplace === 'tiktok') {
      tokens = await tiktokExchangeCode(requireApp(config.integrations, 'tiktok'), query.code);
    } else {
      if (!query.shop_id) throw badRequest('A Shopee não informou a loja autorizada.');
      tokens = await shopeeExchangeCode(requireApp(config.integrations, 'shopee'), query.code, query.shop_id);
    }

    scope.transaction(() => {
      saveTokens(scope, config, pending.store_id, tokens);
      scope.run("UPDATE stores SET connector = :connector, status = 'CONNECTED' WHERE tenant_id = :tenantId AND id = :storeId", { connector: marketplace, storeId: pending.store_id });
      // Os dados sintéticos de demonstração saem de cena: o que já virou chamado é preservado.
      scope.run("DELETE FROM discrepancies WHERE tenant_id = :tenantId AND store_id = :storeId AND status = 'OPEN'", { storeId: pending.store_id });
      scope.run('DELETE FROM sku_reconciliation WHERE tenant_id = :tenantId AND store_id = :storeId', { storeId: pending.store_id });
    });
    logActivity(db, { tenantId: user.tenantId, userId: user.id, actor: user.email, action: 'CONTA_DE_MARKETPLACE_CONECTADA', target: marketplace, ip: request.ip });
    return reply.redirect(`${config.webOrigins[0]}/app/lojas?conectada=${marketplace}`);
  });
}
