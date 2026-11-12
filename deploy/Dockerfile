# ---- web build ----
FROM node:22-slim AS web
WORKDIR /app
RUN corepack enable pnpm
COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY shared/package.json shared/package.json
COPY web/package.json web/package.json
RUN pnpm install --filter @ferry/web --filter @ferry/shared
COPY shared/ shared/
COPY web/ web/
RUN pnpm --filter @ferry/web build

# ---- server build ----
FROM node:22-slim AS server
WORKDIR /app
RUN corepack enable pnpm
COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY shared/package.json shared/package.json
COPY server/package.json server/package.json
RUN pnpm install --filter @ferry/server --filter @ferry/shared
COPY shared/ shared/
COPY server/ server/
RUN pnpm --filter @ferry/server build \
 && pnpm deploy --legacy --filter @ferry/server --prod /out/server

# ---- runtime ----
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
RUN groupadd -r ferry && useradd -r -g ferry ferry \
 && mkdir -p /data && chown ferry:ferry /data
COPY --from=server /out/server/node_modules ./node_modules
COPY --from=server /out/server/dist ./dist
COPY --from=server /out/server/package.json ./package.json
COPY --from=web /app/web/dist ./web/dist
USER ferry
EXPOSE 3000
VOLUME /data
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:3000/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
