FROM node:24-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
# --ignore-scripts: better-sqlite3 ships a prebuilt musl binary in its tarball but also carries a
# binding.gyp, so npm would otherwise run node-gyp and fail for want of a Python toolchain.
# sharp's binaries arrive as platform-specific optional packages and need no scripts either.
RUN npm ci --ignore-scripts

COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# public/ may be empty, and git does not keep empty folders.
RUN mkdir -p public && npm run build

FROM node:24-alpine AS runner
WORKDIR /app
# ffmpeg (with ffprobe) renders the free Ken Burns clips and reads videos; Alpine's build shares
# its libraries between the two, half the size of separate static binaries.
RUN apk add --no-cache tini ffmpeg

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/app/data \
    UV_THREADPOOL_SIZE=8

COPY --from=builder /app/.next/standalone ./
# Neither is part of the standalone bundle by design: static assets are served from disk.
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# better-sqlite3 resolves its prebuilt binary through a path computed at runtime, which the
# tracer cannot follow, so the traced copy lacks it. Copying the package whole settles it.
COPY --from=builder /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
# Backups and account admin, run with docker exec; they need nothing but better-sqlite3.
COPY scripts/backup.js scripts/admin.js scripts/data-paths.js ./scripts/

# Fail the build, not the first request, if a native module cannot load on this image — or if
# the build carried a data folder from wherever it was made.
RUN node -e "require('sharp'); new (require('better-sqlite3'))(':memory:').prepare('select 1').get()" \
 && ffprobe -version > /dev/null \
 && test ! -e /app/data \
 && mkdir -p /app/data && chown -R node:node /app/data

USER node
EXPOSE 3000
VOLUME /app/data

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

# Migrations run in instrumentation's register(), before the server accepts requests.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
