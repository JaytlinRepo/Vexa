# Vexa — PRODUCTION STACK (AWS)

> ⚠️ **Not yet deployed.** This is the planned production architecture.
> Test/preview stack lives at [DEPLOY-TEST.md](./DEPLOY-TEST.md) and is
> what's actually live today.

Production runs entirely on AWS. The CDK scaffold is at
`infrastructure/aws/cdk`. Bedrock prompt assets are at
`infrastructure/aws/bedrock`.

## Why AWS for production

- **Single trust boundary** — all data, all compute, one IAM model.
- **Bedrock proximity** — agents are already calling Bedrock; running
  the API in the same region eliminates cross-cloud egress.
- **RDS for Postgres** — managed backups, point-in-time restore, IAM
  auth, multi-AZ failover. Neon is great for preview but RDS is the
  story we want to tell enterprise buyers.
- **Compliance posture** — SOC2 / HIPAA / GDPR all easier when the
  whole stack is one cloud with one set of access logs.
- **Cost predictability at scale** — Railway's per-minute compute
  pricing is great cheap-and-tiny, terrible cheap-and-busy. AWS hourly
  + reserved instances win above ~50K monthly active users.

## Architecture

| Layer | Service | Notes |
|---|---|---|
| Edge / CDN | CloudFront | Routes `vexa.ai` and `api.vexa.ai` |
| Web (Next.js) | AWS Amplify Hosting | SSR + static; auto-deploys from `main` |
| API container | ECS Fargate (or Lambda) | Container = the same `apps/api/Dockerfile` we run on Railway today |
| Container registry | ECR | Built + pushed by GitHub Actions on every `main` push |
| Database | RDS Postgres (Multi-AZ) | Currently planned: db.t4g.medium starter, scale up |
| Cache | ElastiCache (Redis) | Sessions, rate limits, brand-memory hot cache |
| Object storage | S3 | Output exports, video assets via Creatomate |
| Queue | SQS | Phyllo sync jobs, scheduled trend pulls |
| Scheduler | EventBridge | Replaces the in-process node-cron we use in test |
| Secrets | Secrets Manager | Phyllo prod creds, Stripe live keys, Bedrock IAM, Stripe webhook secret |
| Observability | CloudWatch Logs + X-Ray | Plus Sentry for client-side errors |
| WAF | AWS WAF | Throttling, bot detection on `/api/auth/signup` |
| Auth | Cognito (or stay with our JWT) | TBD — see "Open questions" |

## What changes vs. the test stack

| Concern | Test (today) | Prod (planned) |
|---|---|---|
| Web host | Vercel | AWS Amplify Hosting |
| API host | Railway container | ECS Fargate task |
| Database | Neon (auto-suspend) | RDS Multi-AZ |
| Phyllo | `api.staging.getphyllo.com` | `api.getphyllo.com` |
| Bedrock | Disabled (`VEXA_MODE=test`) | Enabled |
| Stripe | Test mode (no payments) | Live mode |
| Cron | In-process node-cron | EventBridge → SQS → Fargate worker |
| Secrets | Plain env vars on Railway/Vercel | Secrets Manager + IAM roles |
| Domain | `*.vercel.app`, `*.up.railway.app` | `vexa.ai`, `api.vexa.ai` |
| `VEXA_MODE` | `test` | `prod` |

## Deploy steps (when ready)

1. **CDK bootstrap** in target account/region:
   ```bash
   cd infrastructure/aws/cdk
   npx cdk bootstrap aws://<account-id>/us-east-1
   ```

2. **Synth** to verify the stack compiles:
   ```bash
   npx cdk synth
   ```

3. **Deploy** the base stack (VPC, RDS, ECR, Secrets Manager, IAM):
   ```bash
   npx cdk deploy VexaStack
   ```

4. **Set secrets** in Secrets Manager:
   - `vexa/prod/phyllo` — `{client_id, client_secret}`
   - `vexa/prod/bedrock` — IAM role ARN (preferred over keys)
   - `vexa/prod/stripe` — `{secret_key, webhook_secret, price_ids}`
   - `vexa/prod/session` — random 64-byte hex

5. **Push container** to ECR (GitHub Action does this automatically
   once the repo's AWS OIDC role is wired):
   ```bash
   aws ecr get-login-password | docker login --username AWS --password-stdin <ecr-uri>
   docker build -f apps/api/Dockerfile -t vexa-api .
   docker tag vexa-api:latest <ecr-uri>/vexa-api:latest
   docker push <ecr-uri>/vexa-api:latest
   ```

6. **Run migrations** against RDS via a one-off Fargate task:
   ```bash
   aws ecs run-task --task-definition vexa-api-migrate ...
   ```

7. **Connect Amplify** to the GitHub repo, set rootDirectory `apps/web`,
   wire `NEXT_PUBLIC_API_URL=https://api.vexa.ai`, deploy.

8. **DNS** — Route53 zone for `vexa.ai`, A record for the API ALB,
   CloudFront distribution for the web app.

9. **Phyllo** — switch `PHYLLO_API_BASE` to production endpoint, set
   the production callback URL in the Phyllo dashboard.

10. **Stripe** — switch to live mode keys, register webhook to
    `https://api.vexa.ai/api/stripe/webhook`.

## Open questions to settle before deploy

- **Auth**: stay with our JWT/cookie approach or move to Cognito? The
  current bcrypt + jose flow works; Cognito gets us MFA + SSO for
  enterprise but adds complexity.
- **Lambda vs Fargate** for the API: the API has long-running streaming
  endpoints (Bedrock streams + SSE). Lambda has 15-minute hard limits,
  is fine in practice; Fargate is friendlier mental model. Default is
  Fargate unless cold-start is unacceptable.
- **Bedrock region**: `us-east-1` for Claude availability + lowest
  latency, but data residency concerns may push to `us-west-2`.
- **Multi-region**: not for v1. Single region (us-east-1) until we have
  the traffic to justify failover.

## What's done already

- `infrastructure/aws/cdk` — empty CDK app scaffold (needs the actual
  stack definition)
- `apps/api/Dockerfile` — production-ready container, runs on both
  Railway and ECS
- `apps/api/prisma/schema.prisma` — `binaryTargets` includes the AWS
  Linux variants
- API CORS already supports multi-origin via `CORS_ORIGINS` env
- API exposes `/health` for ALB health checks

## What's NOT done

- The CDK stack (`infrastructure/aws/cdk/vexa-stack.ts`) is empty
- No GitHub Action for build → ECR push
- No Route53 / ACM cert config
- No Secrets Manager bindings
- No EventBridge scheduler replacing node-cron
