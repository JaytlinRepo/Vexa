# Sovexa — Production Stack (AWS)

> **Deployed and live** as of 2026-04-19.

Production runs entirely on AWS. Secrets are managed via SSM Parameter Store.

## Architecture

| Layer | Service | Details |
|---|---|---|
| Frontend | AWS Amplify | `sovexa.ai` — Next.js SSR, auto-deploys from `dev` branch |
| API | AWS App Runner | `api.sovexa.ai` — Express.js container from ECR |
| Database | AWS RDS PostgreSQL 15 | `sovexa-prod` (prod) + `sovexa_dev` (dev) on same instance |
| Storage | AWS S3 | `sovexa-outputs` — uploads, video assets |
| Secrets | AWS SSM Parameter Store | `/sovexa/dev/*` and `/sovexa/prod/*` (SecureString) |
| DNS | Route 53 | Single hosted zone for `sovexa.ai` |
| Monitoring | CloudWatch + SNS | 5xx alarm, latency alarm, $50/mo budget alert |
| Auth | Custom JWT (jose + bcrypt) | httpOnly cookie sessions, no Cognito |
| Email | Resend | `team@sovexa.ai`, verified domain |
| Payments | Stripe | 3 products, 6 prices, webhook at `api.sovexa.ai` |
| AI | AWS Bedrock | Claude Haiku for all 4 agents |
| Container Registry | AWS ECR | `sovexa-api` repository |

## Deployment Workflow

### Frontend (Amplify)
- Push to `dev` → auto-deploys to dev environment
- Merge `dev` → `main` → manually trigger build (production never auto-deploys)

### API (App Runner)
```bash
# 1. Build for amd64 (required — Mac is ARM)
docker buildx build --platform linux/amd64 -t sovexa-api -f apps/api/Dockerfile .

# 2. Push to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 322513863369.dkr.ecr.us-east-1.amazonaws.com
docker tag sovexa-api:latest 322513863369.dkr.ecr.us-east-1.amazonaws.com/sovexa-api:latest
docker push 322513863369.dkr.ecr.us-east-1.amazonaws.com/sovexa-api:latest

# 3. Trigger deployment
aws apprunner start-deployment \
  --service-arn arn:aws:apprunner:us-east-1:322513863369:service/sovexa-api-prod/be31ecaa30bc469db5cdbe3fc87273b4 \
  --region us-east-1
```

### Database
- Schema changes: `npx prisma db push` (runs automatically in Docker CMD)
- No migration files — schema-first with `db push`

## Environments

| Env | Frontend | API | Database |
|-----|----------|-----|----------|
| **Production** | `sovexa.ai` | `api.sovexa.ai` | RDS `sovexa_prod` |
| **Development** | `dev.d1y8b9qw8l1748.amplifyapp.com` | `localhost:4000` | RDS `sovexa_dev` |

## Auth Decision (Settled)

**Custom JWT + bcrypt** — not Cognito. Reasoning:
- Already built and working in production
- Simpler mental model (one middleware file, no external dependency)
- Cookie-based sessions work well with the Express + Next.js rewrite proxy
- MFA/SSO can be added later if enterprise customers need it
- Cognito adds complexity without clear benefit at current scale

Implementation: `apps/api/src/middleware/auth.ts` (jose for JWT, bcrypt for password hashing, httpOnly cookies)

## Production Hardening (Done)

- **Single PrismaClient** — shared singleton, not 22 separate instances
- **Rate limiting** — per-user: auth 10/15min, agents 20/min, general 100/min
- **Error isolation** — process-level handlers for unhandled rejections
- **Admin routes** — `/api/admin/*` gated by `ADMIN_EMAILS` env var
- **CORS** — locked to `sovexa.ai`, `dev.sovexa.ai`, `*.amplifyapp.com`

## Future Improvements

- **Redis (ElastiCache)** — for caching (currently in-memory, gracefully degrades)
- **EventBridge** — replace in-process node-cron for multi-instance scheduling
- **GitHub Actions** — CI/CD pipeline for automated build + deploy
- **Sentry** — client-side and server-side error tracking
- **Multi-region** — not needed for v1
