// Cópia de segurança do banco e dos anexos, segura com a aplicação no ar.
// O banco é copiado com VACUUM INTO, que gera um arquivo íntegro mesmo durante escritas.
//
// Uso:  node scripts/backup.mjs <pasta-de-destino>
// Origem: DATABASE_PATH e UPLOAD_DIR (padrão: data/grandir.db e data/uploads).
// O destino deve ficar FORA da máquina ou do volume da aplicação (outro disco, bucket montado etc.).
import { cpSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const target = process.argv[2];
if (!target) {
  console.error('Informe a pasta de destino: node scripts/backup.mjs <pasta>');
  process.exit(1);
}
const database = resolve(process.env.DATABASE_PATH ?? 'data/grandir.db');
const uploads = resolve(process.env.UPLOAD_DIR ?? 'data/uploads');
if (!existsSync(database)) {
  console.error(`Banco não encontrado: ${database}`);
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23);
const folder = resolve(target, `grandir-${stamp}`);
mkdirSync(folder, { recursive: true });

const copy = join(folder, 'grandir.db');
const db = new DatabaseSync(database);
db.prepare('VACUUM INTO ?').run(copy);
db.close();

// Confere a cópia antes de dar o backup como feito.
const check = new DatabaseSync(copy, { readOnly: true });
const integrity = check.prepare('PRAGMA integrity_check').get();
check.close();
if (Object.values(integrity)[0] !== 'ok') {
  console.error('A cópia do banco falhou na verificação de integridade.');
  process.exit(1);
}

if (existsSync(uploads)) cpSync(uploads, join(folder, 'uploads'), { recursive: true });
console.log(`Backup gravado em ${folder} (banco: ${(statSync(copy).size / 1024).toFixed(0)} kB${existsSync(uploads) ? ', anexos incluídos' : ', sem anexos'}).`);
