import { loadConfig } from './config';
import { openDb } from './db';
import { buildApp } from './server';
import { startScheduler } from './services/scheduler';

const config = loadConfig();
const db = openDb(config.databasePath);
const app = await buildApp({ config, db });

if (!config.isProd && !process.env.DATA_ENCRYPTION_KEY) {
  app.log.warn('DATA_ENCRYPTION_KEY não definida: usando chave fixa de desenvolvimento. Não use com dados reais.');
}

await app.listen({ port: config.port, host: config.host });
const stopScheduler = startScheduler(db, config, (message) => app.log.info(message));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    stopScheduler();
    await app.close();
    db.close();
    process.exit(0);
  });
}
