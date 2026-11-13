// Build de produção da API: um único arquivo JavaScript em apps/api/dist/index.js.
// O código da API e os motores (@grandir/engines, com as tabelas de tarifas em JSON) entram
// no pacote; as dependências instaladas pelo npm continuam em node_modules.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const api = resolve(dirname(fileURLToPath(import.meta.url)), '../apps/api');
const pkg = JSON.parse(readFileSync(resolve(api, 'package.json'), 'utf8'));
const external = Object.keys(pkg.dependencies).filter((name) => !name.startsWith('@grandir/'));

const result = await build({
  entryPoints: [resolve(api, 'src/index.ts')],
  outfile: resolve(api, 'dist/index.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external,
  logLevel: 'warning',
  metafile: true,
});
const bytes = Object.values(result.metafile.outputs).find((output) => output.entryPoint)?.bytes ?? 0;
console.log(`API compilada em apps/api/dist/index.js (${(bytes / 1024).toFixed(0)} kB).`);
