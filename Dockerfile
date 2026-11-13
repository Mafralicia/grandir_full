# Imagem de produção do Grandir: a API serve também o front-end, tudo na mesma origem.
#   docker build -t grandir .
#   docker run -p 4000:4000 -v grandir-data:/data -e DATA_ENCRYPTION_KEY=... -e WEB_ORIGIN=https://seu-dominio grandir

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/engines/package.json packages/engines/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY tsconfig.base.json ./
COPY scripts/build-api.mjs scripts/
COPY packages packages
COPY apps apps
RUN npm run build:all

FROM node:24-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    API_PORT=4000 \
    DATABASE_PATH=/data/grandir.db \
    UPLOAD_DIR=/data/uploads
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/engines/package.json packages/engines/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# Só as dependências de execução da API; os motores já estão dentro do pacote compilado.
RUN npm ci --omit=dev --workspace @grandir/api && npm cache clean --force
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/web/dist apps/web/dist
COPY scripts/backup.mjs scripts/
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "apps/api/dist/index.js"]
