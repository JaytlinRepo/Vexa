# Vexa API — production container.
# Built once, runs the same on Railway / Render / Fly / Lambda. Multi-
# stage so the final image only carries production deps + compiled JS.
#
# Build context is the monorepo ROOT — Railway/Render set their build
# context root from the repo, and we need access to package.json,
# turbo.json, and packages/types. Set the dockerfile path to
# apps/api/Dockerfile and the build context to the repo root.

FROM node:20-alpine AS deps
WORKDIR /repo

# Install all workspace deps (api + types + web's package.json for
# turbo, but no need to install web deps for the api image).
COPY package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/types/package.json packages/types/

# npm install the whole workspace tree
RUN npm install --workspaces --include-workspace-root --no-audit --no-fund

# ── Build stage ───────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /repo
RUN apk add --no-cache openssl

COPY --from=deps /repo/node_modules ./node_modules
# npm workspaces hoists deps to the root /node_modules, so the
# per-workspace node_modules dirs may or may not exist. Don't copy
# them — the hoisted root install + the COPY . . below is enough.

COPY . .

# Generate the Prisma client (needs schema.prisma)
WORKDIR /repo/apps/api
RUN npx prisma generate

# Build the API
RUN npm run build

# Build the shared types package
WORKDIR /repo/packages/types
RUN npm run build || true

# ── Runtime stage ─────────────────────────────────────────────
FROM node:20-alpine AS runtime
ARG GIT_SHA=
WORKDIR /repo
RUN apk add --no-cache openssl

ENV NODE_ENV=production
ENV PORT=4000
# Baked at image build — surfaces in GET /health as `revision` (see apps/api/src/index.ts)
ENV GIT_SHA=${GIT_SHA}

# Copy what runtime needs
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/package.json ./apps/api/
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
COPY --from=build /repo/packages/types ./packages/types

WORKDIR /repo/apps/api

EXPOSE 4000

# Skip prisma db push at boot. The runtime container's introspection was
# generating phantom enum diffs (claiming it wanted to drop `free`/`max`
# and create `starter`) even when schema.prisma + DB were already aligned
# with the new enum shape. Schema changes ship via committed migrations
# now (apps/api/prisma/migrations/*), applied out-of-band before deploy.
# If you need it back: `RUN_DB_PUSH=1` on the App Runner service.
CMD ["sh", "-c", "if [ \"$RUN_DB_PUSH\" = \"1\" ]; then npx prisma db push --skip-generate --accept-data-loss; fi && node dist/index.js"]
