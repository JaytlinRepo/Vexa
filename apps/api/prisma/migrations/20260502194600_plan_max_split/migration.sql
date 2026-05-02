-- Plan: add `max` (mid tier). Migrate existing Stripe-backed "pro" users to "max".
-- Entry paid SKU is now "pro".

CREATE TYPE "Plan_new" AS ENUM ('free', 'pro', 'max', 'agency');

ALTER TABLE "users" ALTER COLUMN "plan" DROP DEFAULT;

ALTER TABLE "users" ALTER COLUMN "plan" TYPE "Plan_new" USING (
  CASE
    WHEN "plan"::text = 'pro' THEN 'max'::"Plan_new"
    ELSE ("plan"::text)::"Plan_new"
  END
);

DROP TYPE "Plan";

ALTER TYPE "Plan_new" RENAME TO "Plan";

ALTER TABLE "users" ALTER COLUMN "plan" SET DEFAULT 'free'::"Plan";
