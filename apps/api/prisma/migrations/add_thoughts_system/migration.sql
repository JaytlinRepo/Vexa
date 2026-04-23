-- CreateTable Thought
CREATE TABLE "thoughts" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "thoughts_pkey" PRIMARY KEY ("id")
);

-- CreateTable ThoughtResponse
CREATE TABLE "thought_responses" (
    "id" TEXT NOT NULL,
    "thought_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "thought_responses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "thoughts_company_id_idx" ON "thoughts"("company_id");

-- CreateIndex
CREATE INDEX "thoughts_created_at_idx" ON "thoughts"("created_at");

-- CreateIndex
CREATE INDEX "thought_responses_thought_id_idx" ON "thought_responses"("thought_id");

-- CreateIndex
CREATE INDEX "thought_responses_company_id_idx" ON "thought_responses"("company_id");

-- CreateIndex
CREATE INDEX "thought_responses_employee_id_idx" ON "thought_responses"("employee_id");

-- AddForeignKey
ALTER TABLE "thoughts" ADD CONSTRAINT "thoughts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thought_responses" ADD CONSTRAINT "thought_responses_thought_id_fkey" FOREIGN KEY ("thought_id") REFERENCES "thoughts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thought_responses" ADD CONSTRAINT "thought_responses_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thought_responses" ADD CONSTRAINT "thought_responses_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
