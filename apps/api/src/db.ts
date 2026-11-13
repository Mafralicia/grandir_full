import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tenants (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  country       TEXT NOT NULL,
  is_agency     INTEGER NOT NULL DEFAULT 0,
  revenue_band  TEXT,
  currency      TEXT NOT NULL DEFAULT 'BRL',
  fee_rate_bps  INTEGER NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email            TEXT NOT NULL UNIQUE,
  first_name       TEXT NOT NULL,
  last_name        TEXT NOT NULL,
  phone            TEXT,
  password_hash    TEXT NOT NULL,
  role             TEXT NOT NULL CHECK (role IN ('OWNER','ADMIN','ANALYST','VIEWER')),
  active           INTEGER NOT NULL DEFAULT 1,
  mfa_enabled      INTEGER NOT NULL DEFAULT 0,
  mfa_secret_enc   TEXT,
  mfa_last_step    INTEGER NOT NULL DEFAULT 0,
  failed_attempts  INTEGER NOT NULL DEFAULT 0,
  locked_until     TEXT,
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  token_hash   TEXT NOT NULL UNIQUE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  csrf_token   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  ip           TEXT,
  user_agent   TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at    TEXT
);

CREATE TABLE IF NOT EXISTS stores (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  marketplace     TEXT NOT NULL,
  region          TEXT NOT NULL,
  connector       TEXT NOT NULL,
  credentials_enc TEXT,
  status          TEXT NOT NULL DEFAULT 'CONNECTED',
  last_audit_at   TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stores_tenant ON stores(tenant_id);

CREATE TABLE IF NOT EXISTS audit_runs (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id            TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  started_at          TEXT NOT NULL,
  finished_at         TEXT NOT NULL,
  events_scanned      INTEGER NOT NULL,
  discrepancies_found INTEGER NOT NULL,
  new_discrepancies   INTEGER NOT NULL,
  value_found_cents   INTEGER NOT NULL,
  pending_count       INTEGER NOT NULL,
  expired_count       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_tenant ON audit_runs(tenant_id, store_id);

CREATE TABLE IF NOT EXISTS sku_reconciliation (
  id                   TEXT PRIMARY KEY,
  tenant_id            TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id             TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  sku                  TEXT NOT NULL,
  product_name         TEXT NOT NULL,
  opening              INTEGER NOT NULL,
  inbound              INTEGER NOT NULL,
  outbound             INTEGER NOT NULL,
  adjustments          INTEGER NOT NULL,
  expected_ending      INTEGER NOT NULL,
  reported_ending      INTEGER NOT NULL,
  variance             INTEGER NOT NULL,
  variance_value_cents INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recon_tenant ON sku_reconciliation(tenant_id, store_id);

CREATE TABLE IF NOT EXISTS discrepancies (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id              TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  fingerprint           TEXT NOT NULL,
  type                  TEXT NOT NULL,
  sku                   TEXT NOT NULL,
  product_name          TEXT NOT NULL,
  quantity              INTEGER NOT NULL,
  estimated_value_cents INTEGER NOT NULL,
  reference_id          TEXT NOT NULL,
  evidence_json         TEXT NOT NULL,
  occurred_at           TEXT NOT NULL,
  detected_at           TEXT NOT NULL,
  expires_at            TEXT,
  status                TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLAIMED','RESOLVED','DISMISSED')),
  UNIQUE (tenant_id, store_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_disc_tenant ON discrepancies(tenant_id, status);

CREATE TABLE IF NOT EXISTS erp_products (
  tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id     TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  sku          TEXT NOT NULL,
  product_json TEXT NOT NULL,
  imported_at  TEXT NOT NULL,
  PRIMARY KEY (tenant_id, store_id, sku)
);

CREATE TABLE IF NOT EXISTS imported_records (
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id    TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  record_key  TEXT NOT NULL,
  record_json TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, store_id, kind, record_key)
);

CREATE TABLE IF NOT EXISTS import_mappings (
  tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id     TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  mapping_json TEXT NOT NULL,
  PRIMARY KEY (tenant_id, store_id, kind)
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash  TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id    TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  marketplace TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nfe_documents (
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id    TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  access_key  TEXT NOT NULL,
  kind        TEXT NOT NULL,
  issued_at   TEXT NOT NULL,
  cfop        TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  doc_json    TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, store_id, access_key)
);

CREATE TABLE IF NOT EXISTS claims (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id            TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  discrepancy_id      TEXT NOT NULL REFERENCES discrepancies(id) ON DELETE CASCADE,
  code                TEXT NOT NULL,
  type                TEXT NOT NULL,
  status              TEXT NOT NULL,
  claimed_cents       INTEGER NOT NULL,
  approved_cents      INTEGER,
  marketplace_case_id TEXT,
  opened_at           TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  resolved_at         TEXT,
  paid_at             TEXT,
  UNIQUE (tenant_id, code),
  UNIQUE (tenant_id, discrepancy_id)
);
CREATE INDEX IF NOT EXISTS idx_claims_tenant ON claims(tenant_id, status);

CREATE TABLE IF NOT EXISTS dossier_cases (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id       TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  code           TEXT NOT NULL,
  type           TEXT NOT NULL,
  bucket_label   TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('RASCUNHO','ABERTO','EM_ANALISE','DEFERIDO','INDEFERIDO','PAGO')),
  protocol       TEXT,
  opened_at      TEXT,
  claimed_cents  INTEGER NOT NULL,
  approved_cents INTEGER,
  refunded_cents INTEGER,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS case_events (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  case_id     TEXT NOT NULL REFERENCES dossier_cases(id) ON DELETE CASCADE,
  at          TEXT NOT NULL,
  actor       TEXT NOT NULL,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  note        TEXT
);

CREATE TABLE IF NOT EXISTS claim_events (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  claim_id    TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  at          TEXT NOT NULL,
  actor       TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('STATUS','COMMENT','DOCUMENT')),
  from_status TEXT,
  to_status   TEXT,
  note        TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_claim ON claim_events(tenant_id, claim_id);

CREATE TABLE IF NOT EXISTS documents (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  claim_id     TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  filename     TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  sha256       TEXT NOT NULL,
  uploaded_by  TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_docs_claim ON documents(tenant_id, claim_id);

CREATE TABLE IF NOT EXISTS invoices (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period          TEXT NOT NULL,
  fee_rate_bps    INTEGER NOT NULL,
  recovered_cents INTEGER NOT NULL DEFAULT 0,
  fee_cents       INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  UNIQUE (tenant_id, period)
);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id      TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  claim_id        TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  recovered_cents INTEGER NOT NULL,
  fee_cents       INTEGER NOT NULL,
  created_at      TEXT NOT NULL,
  UNIQUE (tenant_id, claim_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    TEXT,
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL,
  target     TEXT,
  ip         TEXT,
  at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_log_tenant ON audit_log(tenant_id, at);
`;

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  // WAL: leituras não bloqueiam escritas, e uma queda no meio de uma escrita não corrompe o arquivo.
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  db.exec(SCHEMA);
  addColumn(db, 'discrepancies', 'details_json', 'TEXT');
  addColumn(db, 'claims', 'case_id', 'TEXT');
  return db;
}

/** Migração aditiva: cria a coluna se o banco foi criado por uma versão anterior. */
function addColumn(db: Db, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

/** Executa `fn` em uma transação; qualquer exceção desfaz todas as escritas. */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export const nowIso = (): string => new Date().toISOString();
