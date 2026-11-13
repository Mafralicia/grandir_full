# Colocar o Grandir no ar

Um único processo serve a API e o front-end na mesma origem. Os dados (banco SQLite e anexos)
ficam em uma pasta, que precisa de disco persistente e de backup.

> **O que foi verificado.** O pacote compilado (`npm run build:all` + `npm start`) foi executado em
> modo de produção e respondeu site, rotas, arquivos estáticos e health check; há testes para isso
> em `apps/api/test/deploy.test.ts`. A **imagem Docker e o `docker-compose.yml` não foram
> construídos nesta máquina** (o Docker Desktop não respondeu); o CI constrói a imagem a cada PR.

## 1. Variáveis de ambiente

| Variável | Obrigatória | Para quê |
| --- | --- | --- |
| `NODE_ENV=production` | sim | Liga cookie `__Host-` com `Secure`, HSTS e a confiança no proxy |
| `DATA_ENCRYPTION_KEY` | sim | Cifra tokens de marketplace e segredos de MFA. **Perder a chave é perder esses dados**: guarde uma cópia fora do servidor |
| `WEB_ORIGIN` | sim | Origem pública, por exemplo `https://app.seudominio.com.br`. Requisições de outra origem são recusadas |
| `EMAIL_DELIVERY=disabled` | sim, enquanto não houver provedor de e-mail | Declara que a instância roda sem enviar e-mail. Sem ela, a aplicação recusa iniciar em produção |
| `DATABASE_PATH`, `UPLOAD_DIR` | recomendadas | Apontam para o disco persistente (na imagem: `/data`) |
| `HOST`, `API_PORT` | conforme o ambiente | Na imagem: `0.0.0.0` e `4000` |
| `WEB_DIST` | não | Pasta do build do front. Em produção, `apps/web/dist` é usada automaticamente |
| `OAUTH_REDIRECT_BASE` | não | Padrão: a primeira origem de `WEB_ORIGIN` |
| `SYNC_INTERVAL_HOURS` | não | Padrão 24; `0` desliga a sincronização automática |
| `ML_*`, `SHOPEE_*`, `TIKTOK_*` | não | Ver [INTEGRACOES.md](INTEGRACOES.md) |

Gere a chave com:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## 2. Opção A — uma máquina com Docker (recomendada para o piloto)

Requisitos: uma máquina Linux com Docker, portas 80 e 443 abertas e um domínio apontando para ela.

1. Clone o repositório e crie um `.env` ao lado do `docker-compose.yml`:

   ```
   DOMAIN=app.seudominio.com.br
   DATA_ENCRYPTION_KEY=<a chave gerada>
   EMAIL_DELIVERY=disabled
   ```

2. Suba:

   ```bash
   docker compose up -d --build
   ```

O Caddy emite e renova o certificado HTTPS sozinho e encaminha para o Grandir. Os dados ficam no
volume `grandir-data`.

## 3. Opção B — sem Docker

```bash
npm ci
```

```bash
npm run build:all
```

```bash
npm start
```

Defina as variáveis da seção 1 no ambiente (o `npm start` não lê `.env`) e coloque um proxy com
HTTPS na frente: o cookie de sessão de produção só é aceito pelo navegador em HTTPS.

## 4. Backup

```bash
node scripts/backup.mjs /caminho/para/backups
```

Gera uma pasta datada com uma cópia íntegra do banco (pode rodar com a aplicação no ar) e os
anexos. Com Docker:

```bash
docker compose exec grandir node scripts/backup.mjs /data/backups
```

Depois copie a pasta para **fora** da máquina (bucket, outro servidor): um backup no mesmo disco
não protege contra a perda do disco. Agende diariamente (cron) e teste a restauração ao menos uma
vez — restaurar é parar a aplicação, repor `grandir.db` e `uploads` e subir de novo.

## 5. Limites desta forma de deploy

- **Uma instância só.** O banco é um arquivo e a sincronização automática roda dentro do processo:
  duas instâncias duplicariam a sincronização e disputariam o arquivo. Escalar exige PostgreSQL e
  uma fila de tarefas.
- **E-mail não é enviado.** Com `EMAIL_DELIVERY=disabled`, redefinição de senha e convites não
  chegam a ninguém: o log registra só destinatário e assunto, nunca o link. Até o adaptador de
  e-mail ser ligado (`apps/api/src/mailer.ts`), quem esquecer a senha não consegue recuperá-la
  sozinho e convites de equipe não funcionam.
- **Sem monitoramento de erros.** Os logs saem em JSON na saída padrão; ligue-os a um coletor.
- **Health check:** `GET /api/health` responde 200 só se o banco responder.

## 6. CI

`.github/workflows/ci.yml` roda, a cada PR e a cada push na `main`: tipos, testes, build do front
e da API, auditoria de dependências e a construção da imagem Docker.
