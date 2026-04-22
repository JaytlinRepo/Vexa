-- Create Knowledge enums
CREATE TYPE "KnowledgeType" AS ENUM ('insight', 'pattern', 'learning', 'trend_summary', 'content_angle', 'audience_signal', 'competitive_advantage');
CREATE TYPE "KnowledgeSource" AS ENUM ('feed_item', 'brand_memory', 'trend_report', 'user_feedback', 'performance_metric', 'ai_analysis');

-- Create Knowledge table
CREATE TABLE "knowledge" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "company_id" TEXT NOT NULL,
  "type" "KnowledgeType" NOT NULL,
  "source" "KnowledgeSource" NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "details" JSONB,
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "source_url" TEXT,
  "related_item_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "relevance_score" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "is_archived" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "knowledge_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE CASCADE
);

-- Create indexes for efficient querying
CREATE INDEX "knowledge_company_id_idx" ON "knowledge"("company_id");
CREATE INDEX "knowledge_type_idx" ON "knowledge"("type");
CREATE INDEX "knowledge_source_idx" ON "knowledge"("source");
CREATE INDEX "knowledge_created_at_idx" ON "knowledge"("created_at");
CREATE INDEX "knowledge_is_archived_idx" ON "knowledge"("is_archived");
