-- Add studio approval workflow fields to VideoClip
ALTER TABLE "video_clips" ADD COLUMN "caption" TEXT;
ALTER TABLE "video_clips" ADD COLUMN "caption_options" JSONB;
ALTER TABLE "video_clips" ADD COLUMN "selected_caption_id" TEXT;
ALTER TABLE "video_clips" ADD COLUMN "visual_approval_status" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "video_clips" ADD COLUMN "copy_approval_status" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "video_clips" ADD COLUMN "style_metrics" JSONB;
ALTER TABLE "video_clips" ADD COLUMN "editorial_feedback" JSONB;
ALTER TABLE "video_clips" ADD COLUMN "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Create indexes for approval status queries
CREATE INDEX "video_clips_visual_approval_status_idx" ON "video_clips"("visual_approval_status");
CREATE INDEX "video_clips_copy_approval_status_idx" ON "video_clips"("copy_approval_status");
