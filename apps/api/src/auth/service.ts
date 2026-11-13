import { randomUUID } from 'node:crypto';
import { nowIso, type Db } from '../db';
import { randomToken, sha256 } from '../security/crypto';
import { TenantScope } from '../tenant';

export type Role = 'OWNER' | 'ADMIN' | 'ANALYST' | 'VIEWER';

export const ROLE_RANK: Record<Role, number> = { VIEWER: 0, ANALYST: 1, ADMIN: 2, OWNER: 3 };

export interface AuthUser {
  id: string;
  tenantId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  mfaEnabled: boolean;
}

export interface AuthContext {
  user: AuthUser;
  sessionId: string;
  csrfToken: string;
  scope: TenantScope;
}

const SESSION_HOURS = 12;
const REMEMBER_DAYS = 30;

export interface NewSession {
  token: string;
  csrfToken: string;
  /** Duração do cookie; `undefined` = cookie de sessão do navegador. */
  maxAgeSeconds: number | undefined;
}

/**
 * Sessões são tokens opacos de 256 bits guardados no banco apenas como SHA-256:
 * um vazamento do banco não permite sequestrar sessões, e a revogação é imediata.
 */
export function createSession(
  db: Db,
  user: { id: string; tenantId: string },
  meta: { remember: boolean; ip: string; userAgent: string | undefined },
): NewSession {
  const token = randomToken();
  const csrfToken = randomToken(24);
  const now = new Date();
  const lifetimeMs = meta.remember ? REMEMBER_DAYS * 86_400_000 : SESSION_HOURS * 3_600_000;
  db.prepare(
    `INSERT INTO sessions (id, token_hash, user_id, tenant_id, csrf_token, created_at, last_seen_at, expires_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    sha256(token),
    user.id,
    user.tenantId,
    csrfToken,
    now.toISOString(),
    now.toISOString(),
    new Date(now.getTime() + lifetimeMs).toISOString(),
    meta.ip,
    (meta.userAgent ?? '').slice(0, 300),
  );
  return { token, csrfToken, maxAgeSeconds: meta.remember ? REMEMBER_DAYS * 86_400 : undefined };
}

interface SessionJoin {
  session_id: string;
  csrf_token: string;
  expires_at: string;
  last_seen_at: string;
  id: string;
  tenant_id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: Role;
  active: number;
  mfa_enabled: number;
}

export function resolveSession(db: Db, token: string | undefined): AuthContext | null {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT s.id AS session_id, s.csrf_token, s.expires_at, s.last_seen_at,
              u.id, u.tenant_id, u.email, u.first_name, u.last_name, u.role, u.active, u.mfa_enabled
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?`,
    )
    .get(sha256(token)) as SessionJoin | undefined;
  if (!row) return null;

  const now = nowIso();
  if (row.expires_at <= now || !row.active) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(row.session_id);
    return null;
  }
  if (Date.parse(now) - Date.parse(row.last_seen_at) > 60_000) {
    db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(now, row.session_id);
  }

  return {
    sessionId: row.session_id,
    csrfToken: row.csrf_token,
    scope: new TenantScope(db, row.tenant_id),
    user: {
      id: row.id,
      tenantId: row.tenant_id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      role: row.role,
      mfaEnabled: row.mfa_enabled === 1,
    },
  };
}

export function revokeSession(db: Db, sessionId: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function revokeUserSessions(db: Db, userId: string, exceptSessionId?: string): void {
  if (exceptSessionId) {
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(userId, exceptSessionId);
  } else {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }
}

/** Cria um token de uso único para redefinição de senha ou aceite de convite. */
export function createPasswordResetToken(db: Db, userId: string, validHours: number): string {
  const token = randomToken();
  db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
    sha256(token),
    userId,
    new Date(Date.now() + validHours * 3_600_000).toISOString(),
  );
  return token;
}

export function logActivity(
  db: Db,
  entry: { tenantId: string; userId?: string | null; actor: string; action: string; target?: string | null; ip?: string | null },
): void {
  db.prepare(
    'INSERT INTO audit_log (id, tenant_id, user_id, actor, action, target, ip, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    randomUUID(),
    entry.tenantId,
    entry.userId ?? null,
    entry.actor,
    entry.action,
    entry.target ?? null,
    entry.ip ?? null,
    nowIso(),
  );
}
