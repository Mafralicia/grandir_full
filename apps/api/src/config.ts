import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { IntegrationApps } from './integrations/tokens';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default('127.0.0.1'),
  DATABASE_PATH: z.string().min(1).optional(),
  UPLOAD_DIR: z.string().min(1).optional(),
  /** Pasta com o build do front-end (apps/web/dist). Definida, a API serve o site na mesma origem. */
  WEB_DIST: z.string().min(1).optional(),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  DATA_ENCRYPTION_KEY: z.string().optional(),
  DEFAULT_FEE_RATE_BPS: z.coerce.number().int().min(0).max(10_000).default(2000),
  /** Liga os geradores de dados sintéticos (testes e avaliação). Desligado, a aplicação só trabalha com dados reais. */
  GRANDIR_DEMO_MODE: z.enum(['true', 'false']).default('false'),
  /** Intervalo da auditoria automática das lojas conectadas por API, em horas. 0 desliga. */
  SYNC_INTERVAL_HOURS: z.coerce.number().min(0).max(720).default(24),
  ML_CLIENT_ID: z.string().optional(),
  ML_CLIENT_SECRET: z.string().optional(),
  SHOPEE_PARTNER_ID: z.string().optional(),
  SHOPEE_PARTNER_KEY: z.string().optional(),
  // Host de produção da Open Platform; o de testes é https://partner.test-stable.shopeemobile.com
  SHOPEE_API_HOST: z.string().url().default('https://partner.shopeemobile.com'),
  TIKTOK_APP_KEY: z.string().optional(),
  TIKTOK_APP_SECRET: z.string().optional(),
  TIKTOK_SERVICE_ID: z.string().optional(),
  TIKTOK_AUTH_HOST: z.string().url().default('https://services.tiktokshop.com'),
  TIKTOK_TOKEN_HOST: z.string().url().default('https://auth.tiktok-shops.com'),
  TIKTOK_API_HOST: z.string().url().default('https://open-api.tiktokglobalshop.com'),
  /** Origem pública que recebe o retorno do OAuth; padrão: a primeira origem do front-end. */
  OAUTH_REDIRECT_BASE: z.string().url().optional(),
});

export interface Config {
  env: 'development' | 'test' | 'production';
  isProd: boolean;
  port: number;
  host: string;
  databasePath: string;
  uploadDir: string;
  /** Build do front-end servido pela própria API; null quando outro servidor cuida disso. */
  webDist: string | null;
  webOrigins: string[];
  encryptionKey: Buffer;
  defaultFeeRateBps: number;
  integrations: IntegrationApps;
  demoMode: boolean;
  syncIntervalHours: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.parse({
    ...env,
    DATA_ENCRYPTION_KEY: env.DATA_ENCRYPTION_KEY || undefined,
    DATABASE_PATH: env.DATABASE_PATH || undefined,
    UPLOAD_DIR: env.UPLOAD_DIR || undefined,
    WEB_DIST: env.WEB_DIST || undefined,
  });
  const isProd = parsed.NODE_ENV === 'production';

  let encryptionKey: Buffer;
  if (parsed.DATA_ENCRYPTION_KEY) {
    encryptionKey = Buffer.from(parsed.DATA_ENCRYPTION_KEY, 'base64');
    if (encryptionKey.length !== 32) {
      throw new Error('DATA_ENCRYPTION_KEY deve ter 32 bytes codificados em base64.');
    }
  } else if (isProd) {
    throw new Error('DATA_ENCRYPTION_KEY é obrigatória em produção.');
  } else {
    // Chave fixa apenas para desenvolvimento local: nunca protege dados reais.
    encryptionKey = createHash('sha256').update('grandir-chave-somente-desenvolvimento').digest();
  }

  // Em produção, o build do front-end ao lado da API é servido automaticamente.
  const webDist = parsed.WEB_DIST ? resolve(parsed.WEB_DIST) : isProd ? resolve(repoRoot, 'apps/web/dist') : null;
  if (parsed.WEB_DIST && !existsSync(resolve(webDist!, 'index.html'))) throw new Error(`WEB_DIST não contém index.html: ${webDist}`);
  const webOrigins = parsed.WEB_ORIGIN.split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean);
  const redirectBase = (parsed.OAUTH_REDIRECT_BASE ?? webOrigins[0]).replace(/\/$/, '');
  const integrations: IntegrationApps = {
    mercadolivre: parsed.ML_CLIENT_ID && parsed.ML_CLIENT_SECRET
      ? { clientId: parsed.ML_CLIENT_ID, clientSecret: parsed.ML_CLIENT_SECRET, redirectUri: `${redirectBase}/api/oauth/mercadolivre/callback` }
      : null,
    shopee: parsed.SHOPEE_PARTNER_ID && parsed.SHOPEE_PARTNER_KEY
      ? { partnerId: parsed.SHOPEE_PARTNER_ID, partnerKey: parsed.SHOPEE_PARTNER_KEY, host: parsed.SHOPEE_API_HOST.replace(/\/$/, ''), redirectUri: `${redirectBase}/api/oauth/shopee/callback` }
      : null,
    tiktok: parsed.TIKTOK_APP_KEY && parsed.TIKTOK_APP_SECRET && parsed.TIKTOK_SERVICE_ID
      ? {
          appKey: parsed.TIKTOK_APP_KEY, appSecret: parsed.TIKTOK_APP_SECRET, serviceId: parsed.TIKTOK_SERVICE_ID,
          authHost: parsed.TIKTOK_AUTH_HOST.replace(/\/$/, ''), tokenHost: parsed.TIKTOK_TOKEN_HOST.replace(/\/$/, ''), apiHost: parsed.TIKTOK_API_HOST.replace(/\/$/, ''),
        }
      : null,
  };

  return {
    env: parsed.NODE_ENV,
    isProd,
    port: parsed.API_PORT,
    host: parsed.HOST,
    databasePath: parsed.DATABASE_PATH ?? resolve(repoRoot, 'data/grandir.db'),
    uploadDir: parsed.UPLOAD_DIR ?? resolve(repoRoot, 'data/uploads'),
    webDist: webDist && existsSync(resolve(webDist, 'index.html')) ? webDist : null,
    webOrigins,
    integrations,
    demoMode: parsed.GRANDIR_DEMO_MODE === 'true',
    syncIntervalHours: parsed.SYNC_INTERVAL_HOURS,
    encryptionKey,
    defaultFeeRateBps: parsed.DEFAULT_FEE_RATE_BPS,
  };
}
