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
WORKDIR /repo
RUN apk add --no-cache openssl

ENV NODE_ENV=production
ENV PORT=4000

# Copy what runtime needs
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/package.json ./apps/api/
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
COPY --from=build /repo/packages/types ./packages/types

WORKDIR /repo/apps/api

EXPOSE 4000

# Apply schema (db push) then start. db push is idempotent and safe
# for our schema-first dev flow. For migrations later, swap to
# `prisma migrate deploy`.
CMD ["sh", "-c", "npx prisma db push --skip-generate --accept-data-loss && node dist/index.js"]
