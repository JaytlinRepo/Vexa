-- Normalize legacy subscription rows before shrinking enums
UPDATE "users" SET subscription_status = 'active' WHERE subscription_status = 'trial';

-- Paid legacy Solo/starter → Pro; remaining starter → Free
UPDATE "users"
SET plan = 'pro'
WHERE plan = 'starter'
  AND stripe_subscription_id IS NOT NULL
  AND subscription_status IN ('active', 'past_due');

UPDATE "users" SET plan = 'free' WHERE plan = 'starter';

ALTER TABLE "users" DROP COLUMN IF EXISTS "trial_ends_at";

-- SubscriptionStatus: drop `trial`
CREATE TYPE "SubscriptionStatus_new" AS ENUM ('active', 'canceled', 'past_due');
ALTER TABLE "users" ALTER COLUMN "subscription_status" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "subscription_status" TYPE "SubscriptionStatus_new" USING ("subscription_status"::text::"SubscriptionStatus_new");
DROP TYPE "SubscriptionStatus";
ALTER TYPE "SubscriptionStatus_new" RENAME TO "SubscriptionStatus";
ALTER TABLE "users" ALTER COLUMN "subscription_status" SET DEFAULT 'active'::"SubscriptionStatus";

-- Plan: drop `starter`
CREATE TYPE "Plan_new" AS ENUM ('free', 'pro', 'agency');
ALTER TABLE "users" ALTER COLUMN "plan" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "plan" TYPE "Plan_new" USING ("plan"::text::"Plan_new");
DROP TYPE "Plan";
ALTER TYPE "Plan_new" RENAME TO "Plan";
ALTER TABLE "users" ALTER COLUMN "plan" SET DEFAULT 'free'::"Plan";
