FROM node:22-alpine AS dependencies
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/ai/package.json packages/ai/package.json
COPY packages/db/package.json packages/db/package.json
RUN npm ci

FROM dependencies AS builder
COPY apps apps
COPY packages packages
COPY config config
COPY tsconfig.json tsconfig.json
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs
EXPOSE 3000

CMD ["node", "apps/web/server.js"]

FROM dependencies AS worker
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 worker

COPY --chown=worker:nodejs packages packages
COPY --chown=worker:nodejs scripts scripts
COPY --chown=worker:nodejs config config
COPY --chown=worker:nodejs tsconfig.json tsconfig.json

USER worker
CMD ["node", "--import", "tsx", "scripts/process-analysis-queue.ts", "--apply", "--daemon", "--concurrency=2"]
