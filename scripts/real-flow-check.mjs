// Exercita o caminho real pela interface, em 1440x900 (Edge headless via DevTools):
// conta nova → loja vazia → envio de relatório → mapeamento de colunas → auditoria.
// Uso (com `npm run dev` rodando):  node scripts/real-flow-check.mjs . <pasta-de-saída>
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [, , projectDir = '.', outDir = './data/checks'] = process.argv;
const out = resolve(outDir);
mkdirSync(out, { recursive: true });
const BASE = 'http://localhost:5173';
const PORT = 9300 + Math.floor(Math.random() * 500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Conta de teste local, criada a cada execução; as credenciais ficam fora do Git.
const email = `teste-${Date.now()}@grandir.test`;
const password = `Gd!${randomBytes(9).toString('base64url')}9a`;
mkdirSync(join(resolve(projectDir), 'data'), { recursive: true });
writeFileSync(join(resolve(projectDir), 'data', 'conta-de-teste-local.txt'), `E-mail: ${email}\nSenha: ${password}\n`);

// Relatório de vendas de exemplo: um pedido com tarifa acima da regra e um com frete por peso maior que o do cadastro.
const day = (n) => { const d = new Date(Date.now() - n * 86_400_000); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`; };
const reportPath = join(out, 'relatorio-de-vendas.csv');
writeFileSync(reportPath, [
  'Relatório de vendas — período selecionado',
  '',
  'N.º de venda;Data da venda;SKU;Unidades;Receita por produtos (BRL);Tarifa de venda e impostos;Tarifas de envio;Peso cobrado;N.º de anúncio;Número de rastreamento;Total (BRL);Data de liberação',
  `2000011223344;${day(6)};FONE-01;1;399,90;-55,99;-12,95;0,48;MLB1234567890;ME123456789BR;330,96;${day(2)}`,
  `2000011223355;${day(8)};FONE-01;1;399,90;-47,99;-12,95;0,48;MLB1234567890;ME123456790BR;338,96;${day(3)}`,
  `2000011223366;${day(9)};CABO-02;2;59,80;-7,18;-5,65;0,20;MLB2234567890;ME123456791BR;33,47;${day(4)}`,
  `2000011223377;${day(11)};FONE-01;1;399,90;-47,99;-19,95;2,40;MLB1234567890;ME123456792BR;331,96;${day(5)}`,
].join('\r\n'));
const erpPath = join(out, 'produtos-erp.csv');
writeFileSync(erpPath, 'Código;Descrição;GTIN/EAN;Preço de custo;Peso bruto (kg);Largura;Altura;Profundidade\r\nFONE-01;Fone bluetooth;7891234567895;189,00;0,31;18;8;20\r\nCABO-02;Cabo USB-C 1 m;7891234567901;9,50;0,05;10;2;12\r\n');

const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = spawn(edge, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(out, `edge-perfil-${Date.now()}`)}`, '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
let target;
for (let i = 0; i < 40 && !target; i++) {
  await sleep(250);
  try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page'); } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (event) => { const m = JSON.parse(event.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
  const reply = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (reply.result?.exceptionDetails) throw new Error(reply.result.exceptionDetails.exception?.description ?? 'erro na página');
  return reply.result?.result?.value;
};
const fail = (error) => { console.error(String(error)); browser.kill(); process.exit(1); };
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);

const go = async (path, wait = 1500) => { await send('Page.navigate', { url: BASE + path }); await sleep(wait); };
const shot = async (name) => { const { result } = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(out, `real-${name}.png`), Buffer.from(result.data, 'base64')); };
const metrics = `JSON.stringify({ pageOverflow: document.documentElement.scrollWidth - innerWidth, tables: [...document.querySelectorAll('.table-wrap')].map((w) => w.scrollWidth - w.clientWidth), demoText: /demonstra|sint[eé]tic/i.test(document.body.innerText), errors: [...document.querySelectorAll('.alert.error')].map((e) => e.innerText.slice(0, 160)) })`;
const report = [];
const check = async (name) => { report.push({ name, ...JSON.parse(await evaluate(metrics)) }); await shot(name); };
const setFile = async (selector, index, path) => {
  const { result: doc } = await send('DOM.getDocument', { depth: 0 });
  const { result: found } = await send('DOM.querySelectorAll', { nodeId: doc.root.nodeId, selector });
  await send('DOM.setFileInputFiles', { nodeId: found.nodeIds[index], files: [path] });
};
const clickButton = (text) => evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim().startsWith(${JSON.stringify(text)}) && !x.disabled); if (!b) return false; b.click(); return true; })()`);

await send('Page.enable');
await send('DOM.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

// 1. Conta nova e loja vazia.
await go('/criar-conta');
const signup = await evaluate(`(async () => {
  const r = await fetch('/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ firstName: 'Teste', lastName: 'Local', phone: '+55 11 90000-0000', companyName: 'Loja de Teste Local', isAgency: false, country: 'BR', revenueBand: 'ATE_1M', email: ${JSON.stringify(email)}, password: ${JSON.stringify(password)}, acceptTerms: true }) });
  return r.status;
})()`);
if (signup !== 201) throw new Error(`cadastro falhou: ${signup}`);
await go('/app');
await check('1-painel-vazio');
await go('/app/lojas');
await check('2-lojas-vazio');
const storeId = await evaluate(`(async () => {
  const me = await (await fetch('/api/auth/me')).json();
  const r = await fetch('/api/stores', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': me.csrfToken }, body: JSON.stringify({ name: 'Minha loja no Mercado Livre', marketplace: 'mercadolivre', region: 'BR' }) });
  return (await r.json()).id;
})()`);

// 2. Dados da loja: cadastro do ERP e relatório de vendas pela interface.
await go(`/app/lojas/${storeId}/dados`);
await check('3-dados-da-loja');
const inputs = JSON.parse(await evaluate(`JSON.stringify([...document.querySelectorAll('input[type=file]')].map((i) => i.accept + (i.multiple ? ' (vários)' : '')))`));
console.log('campos de arquivo na tela:', inputs.join(' | '));
const erpIndex = inputs.findIndex((accept) => /csv/.test(accept) && !/xlsx/.test(accept));
if (erpIndex >= 0) { await setFile('input[type=file]', erpIndex, erpPath); await sleep(2500); await check('4-erp-importado'); }
const ordersIndex = inputs.findIndex((accept) => /xlsx/.test(accept));
await setFile('input[type=file]', ordersIndex, reportPath);
await sleep(2500);
await check('5-mapeamento');
const selects = JSON.parse(await evaluate(`JSON.stringify([...document.querySelectorAll('select')].map((s) => s.value).filter(Boolean))`));
console.log('colunas pré-mapeadas:', selects.length, '→', selects.join(', '));
if (!(await clickButton('Importar'))) throw new Error('botão "Importar" indisponível: há campo obrigatório sem coluna');
await sleep(3500);
await check('6-resultado');
console.log('resultado na tela:', (await evaluate(`[...document.querySelectorAll('[role=status]')].map((e) => e.innerText.replace(/\\s+/g, ' ')).join(' || ').slice(0, 500)`)));

// 3. O que a auditoria encontrou nos dados importados.
await go('/app/divergencias');
await check('7-divergencias');
console.log('divergências:', await evaluate(`JSON.stringify([...document.querySelectorAll('tbody tr')].filter((r) => r.querySelector('.tag')).map((r) => r.querySelector('.tag').innerText + ' ' + r.querySelectorAll('td')[2].innerText))`));
await go('/app/dossies');
await check('8-dossies');
await go('/app/lojas');
await check('9-lojas');

console.log(JSON.stringify(report));
ws.close();
browser.kill();
process.exit(0);
