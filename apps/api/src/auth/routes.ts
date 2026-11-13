import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config';
import { nowIso, transaction, type Db } from '../db';
import { AppError, badRequest, conflict, unauthorized } from '../errors';
import type { Mailer } from '../mailer';
import { decrypt, encrypt, sha256 } from '../security/crypto';
import { hashPassword, passwordIssue, verifyPassword } from '../security/password';
import { generateSecret, otpauthUri, verifyTotp } from '../security/totp';
import {
  createPasswordResetToken,
  createSession,
  logActivity,
  revokeSession,
  revokeUserSessions,
  type AuthContext,
  type NewSession,
} from './service';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const AUTH_LIMIT = { rateLimit: { max: 10, timeWindow: '1 minute' } };

const email = z.string().trim().toLowerCase().email('Informe um e-mail válido.').max(254);
const password = z.string().superRefine((value, ctx) => {
  const issue = passwordIssue(value);
  if (issue) ctx.addIssue({ code: 'custom', message: issue });
});

const signupSchema = z.object({
  firstName: z.string().trim().min(1, 'Informe seu nome.').max(80),
  lastName: z.string().trim().min(1, 'Informe seu sobrenome.').max(80),
  phone: z.string().trim().min(8, 'Informe um telefone válido.').max(30),
  companyName: z.string().trim().min(2, 'Informe o nome da empresa.').max(120),
  isAgency: z.boolean(),
  country: z.string().trim().length(2, 'Selecione o país.').toUpperCase(),
  revenueBand: z.enum(['ATE_1M', '1M_3M', '3M_5M', '5M_10M', 'ACIMA_10M']),
  email,
  password,
  acceptTerms: z.literal(true, { error: 'É preciso aceitar os Termos de Serviço.' }),
  // Campo-isca: humanos não o veem; robôs de cadastro costumam preenchê-lo.
  website: z.string().max(0).optional(),
});

const loginSchema = z.object({
  email,
  password: z.string().min(1).max(200),
  totp: z.string().trim().optional(),
  remember: z.boolean().default(false),
});

interface UserRow {
  id: string;
  tenant_id: string;
  email: string;
  first_name: string;
  last_name: string;
  password_hash: string;
  role: string;
  active: number;
  mfa_enabled: number;
  mfa_secret_enc: string | null;
  mfa_last_step: number;
  failed_attempts: number;
  locked_until: string | null;
}

export interface AuthDeps {
  db: Db;
  config: Config;
  mailer: Mailer;
  cookieName: string;
  requireAuth: (request: FastifyRequest) => Promise<void>;
}

export async function authRoutes(app: FastifyInstance, deps: AuthDeps): Promise<void> {
  const { db, config, mailer, cookieName, requireAuth } = deps;
  const invalidCredentials = () => unauthorized('E-mail ou senha incorretos.', 'CREDENCIAIS_INVALIDAS');

  // Hash de referência: iguala o tempo de resposta quando o e-mail não existe.
  const dummyHash = hashPassword(randomUUID());

  const setSessionCookie = (reply: FastifyReply, session: NewSession) => {
    reply.setCookie(cookieName, session.token, {
      httpOnly: true,
      secure: config.isProd,
      sameSite: 'lax',
      path: '/',
      maxAge: session.maxAgeSeconds,
    });
  };

  const registerFailure = (user: UserRow) => {
    const attempts = user.failed_attempts + 1;
    if (attempts >= MAX_FAILED_ATTEMPTS) {
      const lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString();
      db.prepare('UPDATE users SET failed_attempts = 0, locked_until = ? WHERE id = ?').run(lockedUntil, user.id);
      logActivity(db, { tenantId: user.tenant_id, userId: user.id, actor: user.email, action: 'CONTA_BLOQUEADA_TEMPORARIAMENTE' });
    } else {
      db.prepare('UPDATE users SET failed_attempts = ? WHERE id = ?').run(attempts, user.id);
    }
  };

  const describeMe = (auth: AuthContext) => {
    const tenant = auth.scope.get<{ name: string; currency: string; feeRateBps: number; country: string }>(
      'SELECT name, currency, fee_rate_bps AS feeRateBps, country FROM tenants WHERE id = :tenantId',
    );
    const stores = auth.scope.get<{ total: number; demo: number }>(
      "SELECT COUNT(*) AS total, COALESCE(SUM(connector LIKE '%demo%'), 0) AS demo FROM stores WHERE tenant_id = :tenantId",
    )!;
    return {
      user: auth.user,
      tenant: { id: auth.user.tenantId, ...tenant, storeCount: stores.total, demoData: stores.demo > 0 },
      csrfToken: auth.csrfToken,
    };
  };

  app.post('/api/auth/signup', { config: AUTH_LIMIT }, async (request, reply) => {
    const body = signupSchema.parse(request.body);
    if (body.website) throw badRequest('Não foi possível concluir o cadastro.');

    const passwordHash = await hashPassword(body.password);
    const tenantId = randomUUID();
    const userId = randomUUID();
    const createdAt = nowIso();

    try {
      transaction(db, () => {
        db.prepare(
          'INSERT INTO tenants (id, name, country, is_agency, revenue_band, fee_rate_bps, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ).run(tenantId, body.companyName, body.country, body.isAgency ? 1 : 0, body.revenueBand, config.defaultFeeRateBps, createdAt);
        db.prepare(
          `INSERT INTO users (id, tenant_id, email, first_name, last_name, phone, password_hash, role, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'OWNER', ?)`,
        ).run(userId, tenantId, body.email, body.firstName, body.lastName, body.phone, passwordHash, createdAt);
      });
    } catch (error) {
      if (String((error as Error).message).includes('UNIQUE')) {
        throw conflict('Já existe uma conta com este e-mail. Entre ou recupere a senha.', 'EMAIL_EM_USO');
      }
      throw error;
    }

    logActivity(db, { tenantId, userId, actor: body.email, action: 'CONTA_CRIADA', ip: request.ip });
    const session = createSession(db, { id: userId, tenantId }, { remember: false, ip: request.ip, userAgent: request.headers['user-agent'] });
    setSessionCookie(reply, session);
    reply.status(201);
    return { csrfToken: session.csrfToken };
  });

  app.post('/api/auth/login', { config: AUTH_LIMIT }, async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(body.email) as UserRow | undefined;

    if (!user || !user.active) {
      await verifyPassword(await dummyHash, body.password);
      throw invalidCredentials();
    }
    if (user.locked_until && user.locked_until > nowIso()) {
      throw new AppError(429, 'CONTA_BLOQUEADA', `Muitas tentativas. Tente novamente em até ${LOCK_MINUTES} minutos.`);
    }
    if (!(await verifyPassword(user.password_hash, body.password))) {
      registerFailure(user);
      throw invalidCredentials();
    }

    if (user.mfa_enabled) {
      if (!body.totp) throw unauthorized('Informe o código do aplicativo autenticador.', 'MFA_OBRIGATORIO');
      const secret = decrypt(user.mfa_secret_enc!, config.encryptionKey);
      const step = verifyTotp(secret, body.totp, user.mfa_last_step);
      if (step === null) {
        registerFailure(user);
        throw unauthorized('Código de verificação incorreto ou expirado.', 'MFA_INVALIDO');
      }
      db.prepare('UPDATE users SET mfa_last_step = ? WHERE id = ?').run(step, user.id);
    }

    db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(user.id);
    const session = createSession(db, { id: user.id, tenantId: user.tenant_id }, {
      remember: body.remember,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
    setSessionCookie(reply, session);
    logActivity(db, { tenantId: user.tenant_id, userId: user.id, actor: user.email, action: 'LOGIN', ip: request.ip });
    return { csrfToken: session.csrfToken };
  });

  app.post('/api/auth/logout', { preHandler: requireAuth }, async (request, reply) => {
    revokeSession(db, request.auth!.sessionId);
    reply.clearCookie(cookieName, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: requireAuth }, async (request) => describeMe(request.auth!));

  app.post('/api/auth/password/forgot', { config: AUTH_LIMIT }, async (request) => {
    const body = z.object({ email }).parse(request.body);
    const user = db.prepare('SELECT id, tenant_id, active FROM users WHERE email = ?').get(body.email) as
      | { id: string; tenant_id: string; active: number }
      | undefined;
    if (user?.active) {
      const token = createPasswordResetToken(db, user.id, 1);
      await mailer.send({
        to: body.email,
        subject: 'Redefinição de senha — Grandir',
        text: `Para criar uma nova senha, acesse (válido por 1 hora):\n${config.webOrigins[0]}/redefinir-senha?token=${token}\n\nSe você não pediu a redefinição, ignore esta mensagem.`,
      });
      logActivity(db, { tenantId: user.tenant_id, userId: user.id, actor: body.email, action: 'REDEFINICAO_SOLICITADA', ip: request.ip });
    }
    // Mesma resposta exista ou não a conta: não revela quais e-mails estão cadastrados.
    return { ok: true };
  });

  app.post('/api/auth/password/reset', { config: AUTH_LIMIT }, async (request) => {
    const body = z.object({ token: z.string().min(20).max(200), password }).parse(request.body);
    const reset = db.prepare('SELECT * FROM password_resets WHERE token_hash = ?').get(sha256(body.token)) as
      | { token_hash: string; user_id: string; expires_at: string; used_at: string | null }
      | undefined;
    if (!reset || reset.used_at || reset.expires_at <= nowIso()) {
      throw badRequest('Link inválido ou expirado. Solicite uma nova redefinição.', 'TOKEN_INVALIDO');
    }
    const passwordHash = await hashPassword(body.password);
    const user = db.prepare('SELECT tenant_id, email FROM users WHERE id = ?').get(reset.user_id) as { tenant_id: string; email: string };
    transaction(db, () => {
      db.prepare('UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?').run(passwordHash, reset.user_id);
      db.prepare('UPDATE password_resets SET used_at = ? WHERE token_hash = ?').run(nowIso(), reset.token_hash);
      revokeUserSessions(db, reset.user_id);
    });
    logActivity(db, { tenantId: user.tenant_id, userId: reset.user_id, actor: user.email, action: 'SENHA_REDEFINIDA', ip: request.ip });
    return { ok: true };
  });

  app.post('/api/auth/password/change', { preHandler: requireAuth, config: AUTH_LIMIT }, async (request) => {
    const auth = request.auth!;
    const body = z.object({ currentPassword: z.string().min(1).max(200), newPassword: password }).parse(request.body);
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(auth.user.id) as { password_hash: string };
    if (!(await verifyPassword(row.password_hash, body.currentPassword))) {
      throw badRequest('A senha atual não confere.', 'SENHA_ATUAL_INCORRETA');
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(body.newPassword), auth.user.id);
    revokeUserSessions(db, auth.user.id, auth.sessionId);
    logActivity(db, { tenantId: auth.user.tenantId, userId: auth.user.id, actor: auth.user.email, action: 'SENHA_ALTERADA', ip: request.ip });
    return { ok: true };
  });

  app.post('/api/auth/sessions/revoke-others', { preHandler: requireAuth }, async (request) => {
    const auth = request.auth!;
    revokeUserSessions(db, auth.user.id, auth.sessionId);
    logActivity(db, { tenantId: auth.user.tenantId, userId: auth.user.id, actor: auth.user.email, action: 'OUTRAS_SESSOES_ENCERRADAS', ip: request.ip });
    return { ok: true };
  });

  app.post('/api/auth/mfa/setup', { preHandler: requireAuth }, async (request) => {
    const auth = request.auth!;
    if (auth.user.mfaEnabled) throw conflict('A verificação em duas etapas já está ativa.');
    const secret = generateSecret();
    db.prepare('UPDATE users SET mfa_secret_enc = ? WHERE id = ?').run(encrypt(secret, config.encryptionKey), auth.user.id);
    return { secret, otpauthUri: otpauthUri(secret, auth.user.email) };
  });

  app.post('/api/auth/mfa/enable', { preHandler: requireAuth, config: AUTH_LIMIT }, async (request) => {
    const auth = request.auth!;
    const body = z.object({ code: z.string().trim() }).parse(request.body);
    const row = db.prepare('SELECT mfa_secret_enc FROM users WHERE id = ?').get(auth.user.id) as { mfa_secret_enc: string | null };
    if (!row.mfa_secret_enc) throw badRequest('Inicie a configuração antes de confirmar o código.');
    const step = verifyTotp(decrypt(row.mfa_secret_enc, config.encryptionKey), body.code);
    if (step === null) throw badRequest('Código incorreto. Confira o horário do seu aparelho e tente de novo.', 'MFA_INVALIDO');
    db.prepare('UPDATE users SET mfa_enabled = 1, mfa_last_step = ? WHERE id = ?').run(step, auth.user.id);
    revokeUserSessions(db, auth.user.id, auth.sessionId);
    logActivity(db, { tenantId: auth.user.tenantId, userId: auth.user.id, actor: auth.user.email, action: 'MFA_ATIVADO', ip: request.ip });
    return { ok: true };
  });

  app.post('/api/auth/mfa/disable', { preHandler: requireAuth, config: AUTH_LIMIT }, async (request) => {
    const auth = request.auth!;
    const body = z.object({ password: z.string().min(1).max(200) }).parse(request.body);
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(auth.user.id) as { password_hash: string };
    if (!(await verifyPassword(row.password_hash, body.password))) {
      throw badRequest('Senha incorreta.', 'SENHA_ATUAL_INCORRETA');
    }
    db.prepare('UPDATE users SET mfa_enabled = 0, mfa_secret_enc = NULL, mfa_last_step = 0 WHERE id = ?').run(auth.user.id);
    logActivity(db, { tenantId: auth.user.tenantId, userId: auth.user.id, actor: auth.user.email, action: 'MFA_DESATIVADO', ip: request.ip });
    return { ok: true };
  });
}
