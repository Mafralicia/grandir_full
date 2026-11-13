// Valida as telas do portal em 1440x900 com o Edge headless, via protocolo DevTools.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [, , projectDir, outDir] = process.argv;
const BASE = 'http://localhost:5173';
const PORT = 9300 + Math.floor(Math.random() * 500);
const credentials = readFileSync(join(projectDir, 'data/demo-credentials.txt'), 'utf8');
const email = /E-mail: (.+)/.exec(credentials)[1].trim();
const password = /Senha: (.+)/.exec(credentials)[1].trim();

const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = spawn(edge, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(outDir, 'edge-cdp')}`, '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let target;
for (let i = 0; i < 40 && !target; i++) {
  await sleep(250);
  try {
    target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page');
  } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => ws.addEventListener('open', resolve));
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
});
const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
  const reply = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (reply.result?.exceptionDetails) throw new Error(reply.result.exceptionDetails.exception?.description ?? 'erro na página');
  return reply.result?.result?.value;
};
const go = async (path, wait = 1500) => { await send('Page.navigate', { url: BASE + path }); await sleep(wait); };
const shot = async (name) => {
  const { result } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(outDir, `desk-${name}.png`), Buffer.from(result.data, 'base64'));
};

process.on('uncaughtException', (error) => { console.error(String(error)); browser.kill(); process.exit(1); });
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

// Login na conta de demonstração local.
await go('/entrar');
await evaluate(`(async () => {
  if (!document.querySelector('input[type=email]')) return;
  const set = (el, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); };
  set(document.querySelector('input[type=email]'), ${JSON.stringify(email)});
  set(document.querySelector('input[type=password]'), ${JSON.stringify(password)});
  document.querySelector('form').requestSubmit();
})()`);
await sleep(2500);

/** Mede o que quebraria o layout: rolagem horizontal da página e tabelas mais largas que o cartão. */
const metrics = `JSON.stringify({
  path: location.pathname,
  viewport: innerWidth + 'x' + innerHeight,
  pageOverflow: document.documentElement.scrollWidth - innerWidth,
  tables: [...document.querySelectorAll('.table-wrap')].map((w) => ({ cols: w.querySelectorAll('thead th').length, rows: w.querySelectorAll('tbody tr').length, overflow: w.scrollWidth - w.clientWidth })),
  wrappedHeaders: [...document.querySelectorAll('.table th')].filter((th) => th.getBoundingClientRect().height > 48).length,
  clippedButtons: [...document.querySelectorAll('.btn')].filter((b) => b.scrollWidth > b.clientWidth + 1).length,
})`;

const report = [];
const visit = async (name, path) => { await go(path); report.push({ name, ...JSON.parse(await evaluate(metrics)) }); await shot(name); };

await visit('dossies', '/app/dossies');
// Cria um chamado a partir do maior dossiê, para validar a tela de detalhe com dados.
const caseId = await evaluate(`(async () => {
  const me = await (await fetch('/api/auth/me')).json();
  const { cases } = await (await fetch('/api/cases')).json();
  if (cases.length) return cases[0].id;
  const { groups } = await (await fetch('/api/dossiers')).json();
  const group = groups.find((g) => g.count >= 3) ?? groups[0];
  const created = await (await fetch('/api/dossiers/' + encodeURIComponent(group.key) + '/case', { method: 'POST', headers: { 'X-CSRF-Token': me.csrfToken } })).json();
  return created.id;
})()`);
await visit('dossies-com-chamado', '/app/dossies');
await visit('chamado-de-dossie', `/app/dossies/${caseId}`);
await evaluate(`(() => { const s = document.querySelector('form select'); if (!s) return; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, s.options[1].value); s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
await sleep(400);
await shot('chamado-de-dossie-form');
await visit('ocorrencias', '/app/chamados');
await visit('lojas', '/app/lojas');
await visit('divergencias', '/app/divergencias');
await visit('visao-geral', '/app');

console.log(JSON.stringify(report, null, 1));
ws.close();
browser.kill();
process.exit(0);
