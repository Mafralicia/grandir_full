import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { authRoutes } from './auth/routes';
import { resolveSession, type AuthContext } from './auth/service';
import type { Config } from './config';
import type { Db } from './db';
import { AppError, forbidden, unauthorized } from './errors';
import { consoleMailer, type Mailer } from './mailer';
import { dossierRoutes } from './routes/dossiers';
import { importRoutes } from './routes/imports';
import { oauthRoutes } from './routes/oauth';
import { portalRoutes } from './routes/portal';
import { safeEqual } from './security/crypto';

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function buildApp(options: { config: Config; db: Db; mailer?: Mailer }): Promise<FastifyInstance> {
  const { config, db } = options;
  const app = Fastify({
    logger: config.env === 'test' ? false : { level: 'info' },
    bodyLimit: 256 * 1024,
    trustProxy: config.isProd,
  });
  const mailer = options.mailer ?? consoleMailer((message) => app.log.info(message));
  // O prefixo __Host- obriga o navegador a exigir Secure, Path=/ e nenhum Domain.
  const cookieName = config.isProd ? '__Host-grandir_session' : 'grandir_session';

  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    hsts: config.isProd,
    referrerPolicy: { policy: 'no-referrer' },
  });
  await app.register(cookie);
  if (config.env !== 'test') {
    await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  }

  app.decorateRequest('auth', null);

  // Requisições que alteram estado só são aceitas das origens do próprio front-end.
  app.addHook('onRequest', async (request) => {
    if (SAFE_METHODS.has(request.method)) return;
    const origin = request.headers.origin;
    if (origin && !config.webOrigins.includes(origin)) throw forbidden('Origem não autorizada.', 'ORIGEM_INVALIDA');
  });

  app.addHook('onSend', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
  });

  const requireAuth = async (request: FastifyRequest): Promise<void> => {
    const auth = resolveSession(db, request.cookies[cookieName]);
    if (!auth) throw unauthorized();
    if (!SAFE_METHODS.has(request.method)) {
      const header = request.headers['x-csrf-token'];
      if (typeof header !== 'string' || !safeEqual(header, auth.csrfToken)) {
        throw forbidden('Token de segurança ausente ou inválido. Recarregue a página.', 'CSRF_INVALIDO');
      }
    }
    request.auth = auth;
  };

  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.status).send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof ZodError) {
      const issue = error.issues[0];
      return reply.status(400).send({
        error: { code: 'VALIDACAO', message: issue?.message ?? 'Dados inválidos.', field: issue?.path.join('.') || undefined },
      });
    }
    const status = error.statusCode ?? 500;
    if (status === 429) {
      return reply.status(429).send({ error: { code: 'LIMITE_EXCEDIDO', message: 'Muitas requisições. Aguarde um instante.' } });
    }
    if (error.name === 'IntegrationError') {
      request.log.warn({ status }, error.message);
      return reply.status(502).send({ error: { code: 'MARKETPLACE_INDISPONIVEL', message: `Não foi possível falar com o marketplace: ${error.message}` } });
    }
    if (status === 413) {
      return reply.status(413).send({ error: { code: 'ARQUIVO_GRANDE', message: 'O arquivo excede o limite de 5 MB.' } });
    }
    if (status >= 400 && status < 500) {
      return reply.status(status).send({ error: { code: 'REQUISICAO_INVALIDA', message: 'Requisição inválida.' } });
    }
    request.log.error(error);
    return reply.status(500).send({ error: { code: 'ERRO_INTERNO', message: 'Erro interno. Tente novamente.' } });
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send({ error: { code: 'NAO_ENCONTRADO', message: 'Rota não encontrada.' } }),
  );

  app.get('/api/health', async () => ({ status: 'ok' }));
  await authRoutes(app, { db, config, mailer, cookieName, requireAuth });
  await portalRoutes(app, { db, config, mailer, requireAuth });
  await dossierRoutes(app, { db, requireAuth });
  await oauthRoutes(app, { db, config, requireAuth });
  await importRoutes(app, { db, config, requireAuth });
  app.get('/api/meta', async () => ({ demoMode: config.demoMode, oauth: { mercadolivre: config.integrations.mercadolivre !== null, shopee: config.integrations.shopee !== null } }));

  return app;
}
