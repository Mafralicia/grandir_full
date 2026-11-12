import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadConfig } from './config';
import { nowIso, openDb, transaction } from './db';
import { randomToken } from './security/crypto';
import { hashPassword } from './security/password';
import { runStoreAudit } from './services/audit';
import { simulateDemoHistory } from './services/demoHistory';
import { TenantScope } from './tenant';

/**
 * Cria uma conta de demonstração com uma loja sintética já auditada.
 * A senha é gerada a cada execução e gravada em data/demo-credentials.txt (fora do Git).
 */
const DEMO_EMAIL = 'demo@grandir.test';

const config = loadConfig();
if (config.isProd) throw new Error('O seed de demonstração não roda em produção.');
const db = openDb(config.databasePath);

const existing = db.prepare('SELECT tenant_id FROM users WHERE email = ?').get(DEMO_EMAIL) as { tenant_id: string } | undefined;
if (existing) db.prepare('DELETE FROM tenants WHERE id = ?').run(existing.tenant_id);

const password = `Gd!${randomToken(12)}9a`;
const tenantId = randomUUID();
const storeId = randomUUID();
const createdAt = nowIso();
const passwordHash = await hashPassword(password);

transaction(db, () => {
  db.prepare(
    "INSERT INTO tenants (id, name, country, is_agency, revenue_band, fee_rate_bps, created_at) VALUES (?, 'Casa Aurora Comércio', 'BR', 0, '1M_3M', ?, ?)",
  ).run(tenantId, config.defaultFeeRateBps, createdAt);
  db.prepare(
    `INSERT INTO users (id, tenant_id, email, first_name, last_name, phone, password_hash, role, created_at)
     VALUES (?, ?, ?, 'Marina', 'Duarte', '+55 11 90000-0000', ?, 'OWNER', ?)`,
  ).run(randomUUID(), tenantId, DEMO_EMAIL, passwordHash, createdAt);
  db.prepare(
    "INSERT INTO stores (id, tenant_id, name, marketplace, region, connector, created_at) VALUES (?, ?, 'Casa Aurora — Amazon BR', 'amazon', 'BR', 'demo', ?)",
  ).run(storeId, tenantId, createdAt);
});

const scope = new TenantScope(db, tenantId);
const summary = await runStoreAudit(scope, config, storeId);
simulateDemoHistory(scope, storeId);
db.close();

const credentialsPath = join(dirname(config.databasePath), 'demo-credentials.txt');
writeFileSync(credentialsPath, `E-mail: ${DEMO_EMAIL}
Senha: ${password}
`, { mode: 0o600 });

console.log(`
Conta de demonstração criada.
  Divergências encontradas: ${summary.discrepanciesFound} (${(summary.valueFoundCents / 100).toFixed(2)} em valor estimado)
  Credenciais gravadas em: ${credentialsPath}

Rode "npm run seed" de novo para recriar a conta com outra senha.
`);
