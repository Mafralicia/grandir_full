import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/config';
import { openDb, type Db } from '../src/db';
import { buildApp } from '../src/server';

let app: FastifyInstance;
let db: Db;
let seller: { cookie: string; csrf: string };

const get = (url: string) => app.inject({ method: 'GET', url, headers: { cookie: seller.cookie } });
const post = (url: string, payload: object = {}) =>
  app.inject({ method: 'POST', url, payload, headers: { cookie: seller.cookie, 'x-csrf-token': seller.csrf } });

before(async () => {
  const config = loadConfig({ NODE_ENV: 'test', UPLOAD_DIR: mkdtempSync(join(tmpdir(), 'grandir-test-')) });
  db = openDb(':memory:');
  app = await buildApp({ config, db, mailer: { send: async () => undefined } });
  const signup = await app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    payload: {
      firstName: 'Ana', lastName: 'Lima', phone: '+55 11 98888-7777', companyName: 'Casa Aurora', isAgency: false, country: 'BR',
      revenueBand: '1M_3M', email: 'casos@exemplo.test', password: 'Senha-Forte-2026!', acceptTerms: true,
    },
  });
  seller = { cookie: String(signup.headers['set-cookie']).split(';')[0], csrf: signup.json().csrfToken };
  assert.equal((await post('/api/stores', { name: 'Aurora ML', marketplace: 'mercadolivre', region: 'BR' })).statusCode, 201);
});

after(async () => {
  await app.close();
  db.close();
});

interface Item { claimId: string; discrepancyId: string; status: string; claimedCents: number; approvedCents: number | null }

async function newCase(minItems: number) {
  const { groups } = (await get('/api/dossiers')).json();
  const group = groups.find((g: { count: number }) => g.count >= minItems);
  assert.ok(group, `precisa de um dossiê com pelo menos ${minItems} itens`);
  const created = await post(`/api/dossiers/${encodeURIComponent(group.key)}/case`);
  assert.equal(created.statusCode, 201, created.body);
  return { id: created.json().id as string, group };
}
const detail = async (id: string) => (await get(`/api/cases/${id}`)).json() as { case: Record<string, any>; items: Item[]; events: unknown[]; ticket: { text: string; warnings: string[] } };
const move = (id: string, body: object) => post(`/api/cases/${id}/transition`, body);

describe('chamado de dossiê', () => {
  it('nasce em rascunho, tira o grupo da fila e guarda o valor contestado', async () => {
    const openBefore = (await get('/api/discrepancies?status=OPEN')).json().discrepancies.length;
    const { id, group } = await newCase(2);
    const data = await detail(id);
    assert.equal(data.case.status, 'RASCUNHO');
    assert.match(data.case.code, /^DOS-\d{5}$/);
    assert.equal(data.case.claimedCents, group.totalCents);
    assert.equal(data.items.length, group.count);
    assert.ok(data.items.every((item) => item.status === 'DRAFT'));
    assert.match(data.ticket.text, /^Assunto: Solicitação de reembolso/);
    assert.equal((await get('/api/discrepancies?status=OPEN')).json().discrepancies.length, openBefore - group.count);
    assert.ok(!(await get('/api/dossiers')).json().groups.some((g: { key: string }) => g.key === group.key));
  });

  it('exige protocolo para abrir e segue a ordem dos estados', async () => {
    const { id } = await newCase(1);
    assert.equal((await move(id, { to: 'ABERTO' })).statusCode, 400);
    assert.equal((await move(id, { to: 'PAGO' })).statusCode, 409);
    assert.equal((await move(id, { to: 'ABERTO', protocol: 'ML-2026-000123' })).statusCode, 200);
    const data = await detail(id);
    assert.equal(data.case.protocol, 'ML-2026-000123');
    assert.ok(data.case.openedAt);
    assert.ok(data.items.every((item) => item.status === 'SUBMITTED'));
  });

  it('defere parcialmente por item e cobra a taxa só sobre o que foi pago', async () => {
    const { id } = await newCase(3);
    await move(id, { to: 'ABERTO', protocol: 'ML-777' });
    await move(id, { to: 'EM_ANALISE' });
    const [full, partial, denied] = (await detail(id)).items;
    const half = Math.floor(partial.claimedCents / 2);

    const acima = await move(id, { to: 'DEFERIDO', items: [{ discrepancyId: full.discrepancyId, approvedCents: full.claimedCents + 1 }] });
    assert.equal(acima.statusCode, 400);

    const deferred = await move(id, {
      to: 'DEFERIDO',
      items: [{ discrepancyId: partial.discrepancyId, approvedCents: half }, { discrepancyId: denied.discrepancyId, approvedCents: 0 }],
    });
    assert.equal(deferred.statusCode, 200, deferred.body);
    const after = await detail(id);
    const byId = Object.fromEntries(after.items.map((item) => [item.discrepancyId, item]));
    assert.equal(byId[full.discrepancyId].status, 'APPROVED');
    assert.deepEqual([byId[partial.discrepancyId].status, byId[partial.discrepancyId].approvedCents], ['PARTIALLY_APPROVED', half]);
    assert.equal(byId[denied.discrepancyId].status, 'DENIED');
    const others = after.items.filter((i) => ![full, partial, denied].some((x) => x.discrepancyId === i.discrepancyId));
    const expected = full.claimedCents + half + others.reduce((sum, i) => sum + i.claimedCents, 0);
    assert.equal(after.case.approvedCents, expected);

    const feesBefore = (await get('/api/billing')).json().lines.length;
    assert.equal((await move(id, { to: 'PAGO' })).statusCode, 200);
    const paid = await detail(id);
    assert.equal(paid.case.status, 'PAGO');
    assert.equal(paid.case.refundedCents, expected);
    assert.equal(paid.items.filter((i) => i.status === 'PAID').length, after.items.length - 1);
    const billing = (await get('/api/billing')).json();
    assert.equal(billing.lines.length - feesBefore, after.items.length - 1);
    assert.deepEqual(paid.case.nextStatuses, []);
  });

  it('permite reabrir um chamado indeferido', async () => {
    const { id } = await newCase(1);
    await move(id, { to: 'ABERTO', protocol: 'ML-9' });
    await move(id, { to: 'EM_ANALISE' });
    assert.equal((await move(id, { to: 'INDEFERIDO', note: 'Negado na primeira análise.' })).statusCode, 200);
    assert.ok((await detail(id)).items.every((item) => item.status === 'DENIED'));
    assert.equal((await move(id, { to: 'EM_ANALISE' })).statusCode, 200);
    const data = await detail(id);
    assert.ok(data.items.every((item) => item.status === 'UNDER_REVIEW'));
    assert.equal(data.events.length, 5);
  });

  it('bloqueia a alteração individual de ocorrência governada pelo dossiê', async () => {
    const { id } = await newCase(1);
    const [item] = (await detail(id)).items;
    const direct = await post(`/api/claims/${item.claimId}/transition`, { to: 'SUBMITTED' });
    assert.equal(direct.statusCode, 409);
    assert.equal(direct.json().error.code, 'GOVERNADO_PELO_DOSSIE');
  });

  it('exporta o dossiê do chamado mesmo depois de as divergências saírem da fila', async () => {
    const { cases } = (await get('/api/cases')).json();
    assert.ok(cases.length >= 5);
    const pdf = await get(`/api/cases/${cases[0].id}/export?format=pdf`);
    assert.equal(pdf.rawPayload.subarray(0, 5).toString(), '%PDF-');
    assert.match(String(pdf.headers['content-disposition']), /dossie-dos-\d{5}\.pdf/);
  });
});
