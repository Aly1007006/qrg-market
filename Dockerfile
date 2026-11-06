# syntax=docker/dockerfile:1
FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install --global pnpm@11.26.0
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
ARG QRG_MEDIA_ORIGIN=""
ENV QRG_MEDIA_ORIGIN=$QRG_MEDIA_ORIGIN
COPY . .
RUN pnpm build

# Isolated, disposable fixture source for the read-only public demonstration.
FROM build AS public-preview
RUN node -e "require('node:fs').cpSync('/app/apps/web', '/fixture-source', { recursive: true, verbatimSymlinks: true, filter: p => !p.startsWith('/app/apps/web/.next') && !p.endsWith('.tsbuildinfo') })"
USER 1000:1000
CMD ["node", "scripts/public-preview-gateway.mjs"]

FROM base AS api-dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm --filter @qrg/api install --prod --frozen-lockfile

FROM gcr.io/distroless/cc-debian13:nonroot@sha256:08476c244888bfb425bae1ae4dd7c17f093e972aab8426883d97f3c6f280f7c1 AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=base /usr/local/bin/node /nodejs/bin/node
COPY --from=api-dependencies --chown=65532:65532 /app/node_modules ./node_modules
COPY --from=api-dependencies --chown=65532:65532 /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=65532:65532 /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=65532:65532 /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=65532:65532 /app/apps/api/drizzle ./apps/api/drizzle
USER 65532:65532
EXPOSE 3001
STOPSIGNAL SIGTERM
ENTRYPOINT ["/nodejs/bin/node"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:3001/api/v1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["apps/api/dist/main.js"]

FROM gcr.io/distroless/cc-debian13:nonroot@sha256:08476c244888bfb425bae1ae4dd7c17f093e972aab8426883d97f3c6f280f7c1 AS web
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /app
COPY --from=base /usr/local/bin/node /nodejs/bin/node
COPY --from=build --chown=65532:65532 /app/apps/web/.next/standalone ./
COPY --from=build --chown=65532:65532 /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=65532:65532 /app/apps/web/public ./apps/web/public
USER 65532:65532
EXPOSE 3000
STOPSIGNAL SIGTERM
ENTRYPOINT ["/nodejs/bin/node"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:3000/').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["apps/web/server.js"]

