import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/config';
import { openDb, type Db } from '../src/db';
import { discardMailer } from '../src/mailer';
import { buildApp } from '../src/server';

describe('Produção: a API serve o front-end na mesma origem', () => {
  let app: FastifyInstance;
  let db: Db;
  const dist = mkdtempSync(join(tmpdir(), 'grandir-dist-'));

  before(async () => {
    mkdirSync(join(dist, 'assets'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Grandir</title><div id="root"></div>');
    writeFileSync(join(dist, 'assets', 'app-abc123.js'), 'console.log(1)');
    const config = loadConfig({ NODE_ENV: 'test', WEB_DIST: dist, UPLOAD_DIR: mkdtempSync(join(tmpdir(), 'grandir-test-')) });
    db = openDb(join(mkdtempSync(join(tmpdir(), 'grandir-db-')), 'grandir.db'));
    app = await buildApp({ config, db, mailer: { send: async () => undefined } });
  });
  after(async () => {
    await app.close();
    db.close();
  });

  it('entrega o index.html na raiz e em rotas do site, sem cache e com CSP restrita à própria origem', async () => {
    for (const url of ['/', '/entrar', '/app/dossies/123']) {
      const page = await app.inject({ method: 'GET', url });
      assert.equal(page.statusCode, 200, url);
      assert.match(String(page.headers['content-type']), /text\/html/);
      assert.match(page.body, /id="root"/);
      assert.equal(page.headers['cache-control'], 'no-store');
      const csp = String(page.headers['content-security-policy']).split(';');
      for (const directive of ["default-src 'self'", "script-src 'self'", "frame-ancestors 'none'", "object-src 'none'"]) assert.ok(csp.includes(directive), directive);
    }
  });

  it('entrega os arquivos de /assets com cache longo', async () => {
    const asset = await app.inject({ method: 'GET', url: '/assets/app-abc123.js' });
    assert.equal(asset.statusCode, 200);
    assert.equal(asset.headers['cache-control'], 'public, max-age=31536000, immutable');
  });

  it('não devolve o index.html para rota de API inexistente, arquivo ausente ou caminho fora da pasta', async () => {
    const api = await app.inject({ method: 'GET', url: '/api/nao-existe' });
    assert.deepEqual([api.statusCode, api.json().error.code], [404, 'NAO_ENCONTRADO']);
    assert.equal((await app.inject({ method: 'GET', url: '/assets/sumiu.js' })).statusCode, 404);
    const escape = await app.inject({ method: 'GET', url: '/..%2f..%2fpackage.json' });
    assert.ok(escape.statusCode >= 400 && !escape.body.includes('"workspaces"'), escape.body.slice(0, 80));
    assert.equal((await app.inject({ method: 'POST', url: '/entrar' })).statusCode, 404);
  });

  it('health check consulta o banco, que em arquivo usa WAL', async () => {
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    assert.deepEqual([health.statusCode, health.json()], [200, { status: 'ok' }]);
    assert.equal((db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode, 'wal');
  });

  it('em produção, não inicia sem provedor de e-mail a menos que o envio seja desligado explicitamente', () => {
    const prod = { NODE_ENV: 'production', DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') };
    assert.throws(() => loadConfig(prod), /EMAIL_DELIVERY/);
    assert.throws(() => loadConfig({ ...prod, EMAIL_DELIVERY: '' }), /EMAIL_DELIVERY/);
    assert.equal(loadConfig({ ...prod, EMAIL_DELIVERY: 'disabled' }).emailDelivery, 'disabled');
    assert.equal(loadConfig({ NODE_ENV: 'development' }).emailDelivery, 'console');
  });

  it('com o envio desligado, o log recebe destinatário e assunto, nunca o corpo com o token', async () => {
    const lines: string[] = [];
    const mail = { to: 'pessoa@exemplo.test', subject: 'Redefinição de senha', text: 'https://app.test/redefinir-senha?token=SEGREDO-123' };
    await discardMailer((line) => lines.push(line)).send(mail);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /pessoa@exemplo\.test.*Redefinição de senha/);
    assert.ok(!lines[0].includes('SEGREDO-123') && !lines[0].includes('token='));
  });

  it('recusa WEB_DIST que não tem index.html', () => {
    assert.throws(() => loadConfig({ NODE_ENV: 'test', WEB_DIST: join(dist, 'assets') }), /WEB_DIST/);
  });
});
