# Sovexa — TEST PREVIEW STACK

> ⚠️ **This is the test/preview stack.** Free-tier hosts, throwaway
> databases, Phyllo's staging API. NOT production — do NOT route real
> users, real money, or sensitive data through it.
>
> Production lives on AWS. See [DEPLOY-PROD.md](./DEPLOY-PROD.md) for
> the production path. This doc covers the preview stack we use for
> development, internal demos, and pre-launch testing.

Stack:
- **Neon** — serverless Postgres (free)
- **Railway** — Express API container (free trial credit, then ~$5-10/mo)
- **Vercel** — Next.js web (free Hobby plan)
- **Phyllo staging** — `api.staging.getphyllo.com` (free)
- **Bedrock** — disabled (`VEXA_MODE=test`); mock generators only
- **Stripe** — disabled (no payment processing in test)

Total time from sign-ups to live URL: ~30 minutes.

## 1 · Neon Postgres (5 min)

1. Sign up at https://neon.tech (GitHub auth is fastest).
2. Create a project — name it `vexa-preview`, region near you.
3. From the project dashboard, copy the **pooled connection string**
   (looks like `postgresql://user:pass@ep-xxx-pooler.../neondb?sslmode=require`).
   Keep it. You'll paste it into Railway in step 2.

That's it. Schema applies automatically when the API boots (the
container runs `prisma db push` on start).

## 2 · Railway API (15 min)

1. Sign up at https://railway.app (GitHub auth).
2. Click **New Project → Deploy from GitHub repo** → pick the Sovexa repo.
3. When prompted, choose **Add a service from a Dockerfile** with the
   path `apps/api/Dockerfile` and **build context** set to the repo root.
4. Under **Variables**, add at minimum:
   - `DATABASE_URL` — the Neon string from step 1
   - `SESSION_SECRET` — generate one with `openssl rand -hex 32`
   - `CORS_ORIGINS` — fill in after step 3 (e.g. `https://vexa-preview.vercel.app`).
     Until then leave it as `https://vercel.app` — the API allows
     `*.vercel.app` automatically.
   - `VEXA_MODE` — `test` (skips Phyllo cron, no AWS calls)
   - `PORT` — `4000` (Railway will inject its own; this is a fallback)
5. Optional now / required later:
   - `PHYLLO_CLIENT_ID`, `PHYLLO_CLIENT_SECRET`, `PHYLLO_API_BASE`
   - `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (Bedrock)
   - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
6. Hit **Deploy**. Wait ~3 minutes for the first build.
7. Once green, the service shows a public URL like
   `https://vexa-api-production-abcd.up.railway.app`. Hit
   `/health` in a browser — should return `{"ok":true,...}`.
8. Copy the Railway URL. You'll paste it into Vercel in step 3.

## 3 · Vercel Web (10 min)

1. Sign up at https://vercel.com (GitHub auth).
2. **Add New → Project** → import the Sovexa repo.
3. Set **Root Directory** to `apps/web`.
4. Framework preset auto-detects as **Next.js**. Don't override
   build/install commands — the `vercel.json` in `apps/web` handles
   the monorepo install for you.
5. Under **Environment Variables**, add:
   - `NEXT_PUBLIC_API_URL` — the Railway URL from step 2 (no trailing slash)
6. Hit **Deploy**. Wait ~2 minutes.
7. You'll get a URL like `https://vexa-preview-abc.vercel.app`.
8. **Go back to Railway**, edit `CORS_ORIGINS`, set it to your Vercel
   URL exactly, then redeploy the API service. (The API also
   auto-allows `*.vercel.app`, so previews work without this — but the
   prod URL in `CORS_ORIGINS` is the explicit allowlist.)

## 4 · Verify

Open the Vercel URL. You should see the marketing site. Click **Start
free trial** → fill the signup form → you should land on the dashboard.
If anything 500s, check Railway logs first — most issues are missing
env vars or a stale `DATABASE_URL`.

## 5 · Custom domain (when ready)

- **Vercel**: Project → Settings → Domains → add `sovexa.ai`
- **Railway**: Service → Settings → Networking → Custom Domain
  → add `api.sovexa.ai`
- Update `NEXT_PUBLIC_API_URL` on Vercel + `CORS_ORIGINS` on Railway
  to use the custom domains.
- Update Phyllo, Stripe, and any other webhook destinations.

## What auto-deploys

Both platforms watch the `main` branch. Every push to `main` triggers
a build + deploy on both. Preview URLs spin up automatically on PRs.
