# Vexa stacks — test vs production

Two completely separate deployments. Same code, different infrastructure.

## TL;DR

| | TEST PREVIEW (today) | PRODUCTION (planned) |
|---|---|---|
| **Status** | ✅ Live | 🟡 Architecture defined, not deployed |
| **Web** | Vercel Hobby | AWS Amplify Hosting |
| **API** | Railway container | AWS ECS Fargate |
| **Database** | Neon (serverless Postgres) | AWS RDS Postgres Multi-AZ |
| **Phyllo** | Staging API | Production API |
| **Bedrock** | Disabled (mocks only) | Enabled |
| **Stripe** | Test mode | Live mode |
| **Domain** | `*.vercel.app` / `*.railway.app` | `sovexa.ai` / `api.sovexa.ai` |
| **`VEXA_MODE`** | `test` | `prod` |
| **Cost** | ~$0–10/month | scales with usage |
| **Setup guide** | [DEPLOY-TEST.md](./DEPLOY-TEST.md) | [DEPLOY-PROD.md](./DEPLOY-PROD.md) |

## Why two stacks

The test stack exists to **iterate fast and demo cheaply**:
- Free tiers everywhere
- Auto-deploy on every push to `main`
- Phyllo staging means we can test the OAuth flow with a real account
  that won't pollute production data
- `VEXA_MODE=test` skips the Phyllo cron, skips Bedrock, skips Stripe
  webhooks — so missing prod creds never crash anything

Production exists for **real users + real money**:
- AWS gives us one trust boundary (compliance, audit logs, IAM)
- RDS Multi-AZ + Bedrock-region proximity = SLA we can sell
- Real Phyllo = real Instagram data
- Live Stripe = real payments
- Predictable cost model at scale

## How `VEXA_MODE` gates behavior

The API reads `process.env.VEXA_MODE`. When set to `test`:
- Phyllo daily cron does not register (no scheduled syncs)
- Bedrock invocations short-circuit to mock generators (no AWS spend)
- Stripe webhook handler treats events as test events
- A startup log line announces the mode prominently

When unset or set to anything else, the API runs in production mode
and assumes all integrations are live.

See `apps/api/src/lib/mode.ts` for the implementation. There is also
a `GET /api/mode` endpoint that returns the current mode for the
client.

## Migration plan (test → prod)

1. Provision AWS infra via the CDK in `infrastructure/aws/cdk`
2. Push the API container to ECR (same Dockerfile that runs on Railway)
3. Run Prisma migrations against RDS
4. Wire Phyllo prod creds + Bedrock IAM via Secrets Manager
5. Cut DNS (Route53) over to AWS
6. Drop Railway + Vercel preview environments — or keep them as
   PR-preview infra against the test DB

The test stack stays useful even after prod ships — it's the
preview-deploy environment for PRs.
