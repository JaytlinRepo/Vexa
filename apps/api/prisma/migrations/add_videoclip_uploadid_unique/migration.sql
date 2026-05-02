-- Make video_clips.upload_id unique so the database itself prevents duplicate
-- clip rows when processVideo runs twice (BullMQ retry, queue + HTTP race).
-- This pairs with the app-layer guard added in videoProcessing.service.ts.
--
-- BEFORE RUNNING: ensure no existing duplicate rows. To check:
--   SELECT upload_id, COUNT(*) FROM video_clips GROUP BY upload_id HAVING COUNT(*) > 1;
-- If duplicates exist, decide which to keep before applying.

DROP INDEX IF EXISTS "video_clips_uploadId_idx";
CREATE UNIQUE INDEX "video_clips_uploadId_key" ON "video_clips"("upload_id");
