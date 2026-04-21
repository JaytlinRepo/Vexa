# Video Processing with Metrics Framework

## Implementation Complete ✅

### What We Built

**Three measurement systems to evaluate video clipping quality:**

1. **Style Replication Quality**
   - Compares edited clip against creator's existing posts
   - Measures: color accuracy, lighting accuracy, overall vibe match
   - Score: 0-1 (target: >0.85)
   - Uses Claude Vision API

2. **Clipping Quality**
   - Evaluates the clip itself (not the style)
   - Measures: hook strength, pacing, value delivered, narrative flow, engagement
   - Score: 0-1 (target: >0.80)
   - Uses Claude Opus for detailed analysis

3. **Processing Time**
   - Tracks time from upload to final clip
   - Breaks down by stage: Descript upload, transcription, clipping, Runway styling, S3 save
   - Target: <6 minutes total
   - Identifies bottlenecks

### Architecture

```
User uploads video (POST /api/video/upload)
    ↓
Background job starts
    ├─ Stage 1: Upload to Descript (45s typical)
    ├─ Stage 2: Transcription (2-3 min typical)
    ├─ Stage 3: Generate Magic Shortforms (40s typical)
    ├─ Stage 4: Download clip (5s typical)
    ├─ Stage 5: Apply style with Runway (1-2 min typical)
    ├─ Stage 6: Save to S3 (7s typical)
    └─ Stage 7: Measure metrics
         ├─ Style replication (uses Vision)
         ├─ Clipping quality (uses Opus)
         └─ Timing breakdown
    ↓
Emit SSE events with results
    ↓
UI updates with metrics dashboard
    ↓
Clip stored and ready to post
```

### Database Schema

```typescript
VideoUpload {
  id, companyId, sourceVideoUrl, fileName, duration
  clips: VideoClip[]
}

VideoClip {
  id, uploadId, companyId, clippedUrl, duration, hook
  status, processedWith, adjustments
}

ProcessingMetric {
  id, companyId, metricType, value, details
  metricType: "style_replication" | "clipping_quality" | "processing_time"
}
```

### Files Created

**Services:**
- `src/lib/descript.service.ts` - Descript API client
- `src/lib/runway.service.ts` - Runway API client
- `src/lib/videoMetrics.service.ts` - Metrics measurement
- `src/lib/videoProcessing.service.ts` - Orchestration

**Routes:**
- `src/routes/video.ts` - Upload, metrics, SSE stream endpoints

**Database:**
- `prisma/schema.prisma` - Updated with 3 new models

## Testing Plan

### Phase 1: Manual Testing (This Week)
1. **Upload test videos** — 5-10 real creator videos of varying lengths
   - 5-minute tutorial
   - 15-minute vlog
   - 30-minute podcast snippet
   - etc.

2. **Collect metrics** for each:
   ```
   Video 1: Tutorial (5 min)
   ├─ Style Match: 0.89 ✅ (excellent)
   ├─ Clipping Quality: 0.85 ✅ (good)
   └─ Processing Time: 4m 32s ✅ (acceptable)
   
   Video 2: Vlog (15 min)
   ├─ Style Match: 0.82 ⚠️ (slightly off)
   ├─ Clipping Quality: 0.78 ⚠️ (below target)
   └─ Processing Time: 5m 45s ✅ (good)
   ```

3. **Dashboard view** — Visit GET `/api/video/metrics?companyId=xyz`
   ```json
   {
     "styleReplication": {
       "average": 0.87,
       "trend": "improving",
       "samples": 10
     },
     "clippingQuality": {
       "average": 0.84,
       "trend": "stable",
       "samples": 10
     },
     "processingTime": {
       "average": "4m 42s",
       "trend": "faster",
       "samples": 10
     },
     "recommendation": "✅ READY TO SHIP"
   }
   ```

### Phase 2: Decision Point
After 10-20 test videos:

**✅ IF metrics are good (style >0.85, clipping >0.80, time <6min):**
- Ship Descript-only approach
- Start allowing real users
- Continue measuring with live data

**⚠️ IF metrics are borderline (style 0.80-0.85, clipping 0.75-0.80):**
- Run 10 more videos
- Monitor trends
- Make go/no-go decision

**❌ IF metrics are poor (style <0.80, clipping <0.75):**
- Add Opus evaluation layer (Week 2)
- Opus ranks multiple clip options
- Descript generates, Opus picks best one
- Re-test

## Key Metrics to Monitor

### Style Replication
- **Good** (>0.85): "Color grading perfectly matches their aesthetic"
- **OK** (0.80-0.85): "Slight tone difference but acceptable"
- **Poor** (<0.80): "Doesn't match their style, needs adjustment"

### Clipping Quality
- **Hook** (>0.85): "Opening grabs attention immediately"
- **Pacing** (>0.80): "Smooth cuts, doesn't feel choppy"
- **Value** (>0.80): "Keeps key information, no dead time"
- **Flow** (>0.80): "Narrative makes sense, not jarring"
- **Engagement** (>0.80): "Would watch to the end"

### Processing Time
- **Upload to Descript**: 30-60s (network)
- **Transcription**: 1.5-3 min (Descript's ML)
- **Magic Shortforms**: 30-60s (Descript's AI clipping)
- **Runway styling**: 1-2 min (color grading)
- **S3 save**: <10s (upload)
- **Total target**: <6 minutes

## Next Steps

1. **Deploy** — Get schema migrations run on database
2. **Integrate into API** — Wire video routes into main Express app
3. **Test uploads** — Upload test videos, collect metrics
4. **Monitor results** — Track 10-20 samples
5. **Decide** — Ship as-is or add Opus refinement
6. **Iterate** — Based on real user feedback

## Success Criteria

✅ **Go-to-Market Checklist:**
- [ ] Style match >0.85 average
- [ ] Clipping quality >0.80 average
- [ ] Processing time <6 min average
- [ ] Zero errors in 20 test videos
- [ ] Runway API integration working
- [ ] Descript Magic Shortforms generating good clips
- [ ] Metrics dashboard showing real data
- [ ] SSE events flowing to UI

## Rollback Plan

If metrics are poor:
1. Pause user uploads
2. Add Opus evaluation layer
3. Have Descript generate 3 clip options
4. Opus ranks by: hook + style match + value
5. Auto-select best option
6. Re-test with same videos
7. Compare metrics before/after Opus

This keeps the codebase intact while improving quality.

## Cost Estimates

**Per 100 videos processed:**
- Descript: ~$0 (included in API tier)
- Runway: ~$20-30 (varies by video length/complexity)
- Claude Vision: ~$0.30 (5 image comparisons)
- Claude Opus: ~$0 if we don't add it yet
- **Total: ~$20-30 per 100 videos**

## Open Questions

1. Where does S3 upload happen? Need to integrate with existing S3 setup
2. Do we have Runway API key? Need to set `RUNWAY_API_KEY` env var
3. Do we have Descript API key? Need to set `DESCRIPT_API_KEY` env var
4. Should we save original uploaded video, or just the processed clip?
5. What's the UI for showing clip previews and metrics?
