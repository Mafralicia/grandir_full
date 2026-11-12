import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default('127.0.0.1'),
  DATABASE_PATH: z.string().min(1).optional(),
  UPLOAD_DIR: z.string().min(1).optional(),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  DATA_ENCRYPTION_KEY: z.string().optional(),
  DEFAULT_FEE_RATE_BPS: z.coerce.number().int().min(0).max(10_000).default(2000),
});

export interface Config {
  env: 'development' | 'test' | 'production';
  isProd: boolean;
  port: number;
  host: string;
  databasePath: string;
  uploadDir: string;
  webOrigins: string[];
  encryptionKey: Buffer;
  defaultFeeRateBps: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.parse({
    ...env,
    DATA_ENCRYPTION_KEY: env.DATA_ENCRYPTION_KEY || undefined,
    DATABASE_PATH: env.DATABASE_PATH || undefined,
    UPLOAD_DIR: env.UPLOAD_DIR || undefined,
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

  return {
    env: parsed.NODE_ENV,
    isProd,
    port: parsed.API_PORT,
    host: parsed.HOST,
    databasePath: parsed.DATABASE_PATH ?? resolve(repoRoot, 'data/grandir.db'),
    uploadDir: parsed.UPLOAD_DIR ?? resolve(repoRoot, 'data/uploads'),
    webOrigins: parsed.WEB_ORIGIN.split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean),
    encryptionKey,
    defaultFeeRateBps: parsed.DEFAULT_FEE_RATE_BPS,
  };
}
