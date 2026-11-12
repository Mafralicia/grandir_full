import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/config';
import { openDb, type Db } from '../src/db';
import type { Mail } from '../src/mailer';
import { codeForStep, currentStep } from '../src/security/totp';
import { buildApp } from '../src/server';
import { TenantScope } from '../src/tenant';

const PASSWORD = 'Senha-Forte-2026!';
let app: FastifyInstance;
let db: Db;
const outbox: Mail[] = [];

interface Client {
  cookie: string;
  csrf: string;
}

const signupBody = (email: string, companyName: string) => ({
  firstName: 'Ana',
  lastName: 'Lima',
  phone: '+55 11 98888-7777',
  companyName,
  isAgency: false,
  country: 'BR',
  revenueBand: '1M_3M',
  email,
  password: PASSWORD,
  acceptTerms: true,
});

async function signup(email: string, companyName: string): Promise<Client> {
  const response = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: signupBody(email, companyName) });
  assert.equal(response.statusCode, 201, response.body);
  return { cookie: String(response.headers['set-cookie']).split(';')[0], csrf: response.json().csrfToken };
}

const call = (client: Client, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
  app.inject({
    method,
    url,
    payload: payload as object | undefined,
    headers: { cookie: client.cookie, ...(method === 'GET' ? {} : { 'x-csrf-token': client.csrf }) },
  });

before(async () => {
  const config = loadConfig({ NODE_ENV: 'test', UPLOAD_DIR: mkdtempSync(join(tmpdir(), 'grandir-test-')) });
  db = openDb(':memory:');
  app = await buildApp({ config, db, mailer: { send: async (mail) => void outbox.push(mail) } });
});

after(async () => {
  await app.close();
  db.close();
});

describe('autenticação', () => {
  it('rejeita senha fraca e e-mail repetido', async () => {
    const weak = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { ...signupBody('fraca@exemplo.test', 'Fraca'), password: 'curta' },
    });
    assert.equal(weak.statusCode, 400);

    await signup('dup@exemplo.test', 'Dup');
    const again = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: signupBody('dup@exemplo.test', 'Dup 2') });
    assert.equal(again.statusCode, 409);
  });

  it('emite cookie HttpOnly e não guarda o token em claro', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: signupBody('cookie@exemplo.test', 'Cookie') });
    const setCookie = String(response.headers['set-cookie']);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    const token = setCookie.split(';')[0].split('=')[1];
    const stored = db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?').get(token) as { n: number };
    assert.equal(stored.n, 0);
  });

  it('exige sessão, token CSRF e origem autorizada', async () => {
    const client = await signup('csrf@exemplo.test', 'CSRF');
    assert.equal((await app.inject({ method: 'GET', url: '/api/dashboard' })).statusCode, 401);

    const semCsrf = await app.inject({
      method: 'POST',
      url: '/api/stores',
      headers: { cookie: client.cookie },
      payload: { name: 'Loja', marketplace: 'amazon', region: 'BR' },
    });
    assert.equal(semCsrf.statusCode, 403);
    assert.equal(semCsrf.json().error.code, 'CSRF_INVALIDO');

    const outraOrigem = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'https://site-malicioso.test' },
      payload: { email: 'csrf@exemplo.test', password: PASSWORD },
    });
    assert.equal(outraOrigem.statusCode, 403);
    assert.equal(outraOrigem.json().error.code, 'ORIGEM_INVALIDA');
  });

  it('bloqueia a conta após tentativas seguidas com senha errada', async () => {
    await signup('lock@exemplo.test', 'Lock');
    const attempt = (password: string) =>
      app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'lock@exemplo.test', password } });
    for (let i = 0; i < 5; i++) assert.equal((await attempt('Errada-123456!')).statusCode, 401);
    const locked = await attempt(PASSWORD);
    assert.equal(locked.statusCode, 429);
    assert.equal(locked.json().error.code, 'CONTA_BLOQUEADA');
  });

  it('responde igual para e-mail inexistente e senha errada', async () => {
    await signup('existe@exemplo.test', 'Existe');
    const login = (email: string) =>
      app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'Errada-123456!' } });
    const [unknown, wrong] = [await login('ninguem@exemplo.test'), await login('existe@exemplo.test')];
    assert.equal(unknown.statusCode, 401);
    assert.deepEqual(unknown.json(), wrong.json());
  });

  it('redefine a senha por link de uso único e encerra as sessões antigas', async () => {
    const client = await signup('reset@exemplo.test', 'Reset');
    await app.inject({ method: 'POST', url: '/api/auth/password/forgot', payload: { email: 'reset@exemplo.test' } });
    const token = /token=([\w-]+)/.exec(outbox.at(-1)!.text)![1];

    const reset = () =>
      app.inject({ method: 'POST', url: '/api/auth/password/reset', payload: { token, password: 'Outra-Senha-2026!' } });
    assert.equal((await reset()).statusCode, 200);
    assert.equal((await reset()).statusCode, 400);
    assert.equal((await call(client, 'GET', '/api/auth/me')).statusCode, 401);

    const unknown = await app.inject({ method: 'POST', url: '/api/auth/password/forgot', payload: { email: 'nao-existe@exemplo.test' } });
    assert.equal(unknown.statusCode, 200);
  });

  it('exige o código TOTP depois de ativar a verificação em duas etapas', async () => {
    const client = await signup('mfa@exemplo.test', 'MFA');
    const { secret } = (await call(client, 'POST', '/api/auth/mfa/setup', {})).json();
    const stored = db.prepare('SELECT mfa_secret_enc FROM users WHERE email = ?').get('mfa@exemplo.test') as { mfa_secret_enc: string };
    assert.ok(!stored.mfa_secret_enc.includes(secret), 'segredo MFA deve estar cifrado em repouso');

    // Usa o passo anterior para deixar o passo atual livre para o login.
    const enable = await call(client, 'POST', '/api/auth/mfa/enable', { code: codeForStep(secret, currentStep() - 1) });
    assert.equal(enable.statusCode, 200, enable.body);

    const login = (totp?: string) =>
      app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'mfa@exemplo.test', password: PASSWORD, totp } });
    assert.equal((await login()).json().error.code, 'MFA_OBRIGATORIO');
    assert.equal((await login('000000')).json().error.code, 'MFA_INVALIDO');
    const code = codeForStep(secret, currentStep());
    assert.equal((await login(code)).statusCode, 200);
    assert.equal((await login(code)).json().error.code, 'MFA_INVALIDO', 'o mesmo código não pode ser reutilizado');
  });
});

describe('isolamento entre tenants', () => {
  let alfa: Client;
  let beta: Client;
  let alfaClaimId: string;
  let alfaDiscrepancyId: string;

  before(async () => {
    alfa = await signup('alfa@exemplo.test', 'Alfa Ltda');
    beta = await signup('beta@exemplo.test', 'Beta Ltda');
    const store = await call(alfa, 'POST', '/api/stores', { name: 'Alfa BR', marketplace: 'amazon', region: 'BR' });
    assert.equal(store.statusCode, 201, store.body);
    alfaClaimId = (await call(alfa, 'GET', '/api/claims')).json().claims[0].id;
    alfaDiscrepancyId = (await call(alfa, 'GET', '/api/discrepancies?status=OPEN')).json().discrepancies[0].id;
  });

  it('o tenant dono enxerga os próprios dados', async () => {
    const dashboard = (await call(alfa, 'GET', '/api/dashboard')).json();
    assert.ok(dashboard.totals.identifiedCents > 0);
    assert.equal((await call(alfa, 'GET', `/api/claims/${alfaClaimId}`)).statusCode, 200);
  });

  it('outro tenant não lê nem lista nada', async () => {
    assert.equal((await call(beta, 'GET', '/api/dashboard')).json().totals.identifiedCents, 0);
    assert.deepEqual((await call(beta, 'GET', '/api/claims')).json().claims, []);
    assert.deepEqual((await call(beta, 'GET', '/api/discrepancies')).json().discrepancies, []);
    assert.deepEqual((await call(beta, 'GET', '/api/reconciliation')).json().rows, []);
    assert.equal((await call(beta, 'GET', `/api/claims/${alfaClaimId}`)).statusCode, 404);
  });

  it('outro tenant não altera registros alheios', async () => {
    const transition = await call(beta, 'POST', `/api/claims/${alfaClaimId}/transition`, { to: 'CLOSED' });
    assert.equal(transition.statusCode, 404);
    const claim = await call(beta, 'POST', `/api/discrepancies/${alfaDiscrepancyId}/claim`, {});
    assert.equal(claim.statusCode, 404);
    const dismiss = await call(beta, 'POST', `/api/discrepancies/${alfaDiscrepancyId}/dismiss`, {});
    assert.equal(dismiss.statusCode, 409);
    const still = (await call(alfa, 'GET', '/api/discrepancies?status=OPEN')).json().discrepancies;
    assert.ok(still.some((d: { id: string }) => d.id === alfaDiscrepancyId));
  });

  it('a camada de acesso recusa consulta sem filtro de tenant', () => {
    const scope = new TenantScope(db, 'qualquer');
    assert.throws(() => scope.all('SELECT * FROM claims'), /:tenantId/);
  });

  it('reexecutar a auditoria não duplica divergências', async () => {
    const before = (await call(alfa, 'GET', '/api/discrepancies')).json().discrepancies.length;
    const { stores } = (await call(alfa, 'GET', '/api/stores')).json();
    const rerun = await call(alfa, 'POST', `/api/stores/${stores[0].id}/audit`, {});
    assert.equal(rerun.statusCode, 200, rerun.body);
    assert.equal(rerun.json().audit.newDiscrepancies, 0);
    assert.equal((await call(alfa, 'GET', '/api/discrepancies')).json().discrepancies.length, before);
  });

  it('cobra a taxa de sucesso apenas sobre o que foi pago', async () => {
    const billing = (await call(alfa, 'GET', '/api/billing')).json();
    const dashboard = (await call(alfa, 'GET', '/api/dashboard')).json();
    const recovered = billing.invoices.reduce((sum: number, i: { recoveredCents: number }) => sum + i.recoveredCents, 0);
    assert.equal(recovered, dashboard.totals.recoveredCents);
    for (const line of billing.lines) {
      assert.equal(line.feeCents, Math.floor((line.recoveredCents * billing.feeRateBps + 5000) / 10000));
    }
  });
});

describe('permissões por papel', () => {
  it('leitor não executa ações e administrador não altera o titular', async () => {
    const owner = await signup('dono@exemplo.test', 'Papéis');
    const invite = await call(owner, 'POST', '/api/team', {
      email: 'leitor@exemplo.test', firstName: 'Léo', lastName: 'Reis', role: 'VIEWER',
    });
    assert.equal(invite.statusCode, 201, invite.body);

    const token = /token=([\w-]+)/.exec(outbox.at(-1)!.text)![1];
    await app.inject({ method: 'POST', url: '/api/auth/password/reset', payload: { token, password: PASSWORD } });
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'leitor@exemplo.test', password: PASSWORD } });
    const viewer: Client = { cookie: String(login.headers['set-cookie']).split(';')[0], csrf: login.json().csrfToken };

    assert.equal((await call(viewer, 'GET', '/api/dashboard')).statusCode, 200);
    assert.equal((await call(viewer, 'GET', '/api/billing')).statusCode, 403);
    assert.equal((await call(viewer, 'POST', '/api/stores', { name: 'X1', marketplace: 'amazon', region: 'BR' })).statusCode, 403);

    const ownerId = (await call(owner, 'GET', '/api/auth/me')).json().user.id;
    const members = (await call(owner, 'GET', '/api/team')).json().members;
    const viewerId = members.find((m: { email: string }) => m.email === 'leitor@exemplo.test').id;
    assert.equal((await call(owner, 'PATCH', `/api/team/${ownerId}`, { role: 'VIEWER' })).statusCode, 400);
    assert.equal((await call(owner, 'PATCH', `/api/team/${viewerId}`, { active: false })).statusCode, 200);
    assert.equal((await call(viewer, 'GET', '/api/dashboard')).statusCode, 401, 'sessão do membro desativado é encerrada');
  });
});
