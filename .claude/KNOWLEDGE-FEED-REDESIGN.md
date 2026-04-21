# Knowledge Feed Redesign: Complete Implementation Map

## Executive Summary
Transform Knowledge Feed from "signal library" to "visual discovery + inspiration + learning" tool that shows:
1. Similar successful content (explore by format/voice)
2. Real-time trending in niche
3. Educational articles tied to content pillars
4. Creator profiles to study
5. Format trends with your performance

---

## 1. DATA SOURCES NEEDED

### A. User's Own Content (Already Have)
- PlatformPost data (your posts, metrics, formats)
- Performance metrics (ER, reach, saves, shares by format)
- Content pillars tagged to posts
- Posting times, captions, formats

### B. Similar Creator Content (Need to Fetch)
**Sources:**
- Instagram Graph API (public creator posts, engagement)
- TikTok Open API (trending creators, sounds)
- YouTube Data API (trending videos by niche)
- NewsAPI/RapidAPI (trending creators mentioned in niche articles)

**Data needed per creator:**
- Profile (followers, niche, posting frequency)
- Top 10 posts (format, engagement, captions)
- Growth trajectory (30d, 7d)
- Audience overlap estimation

### C. Trending Content in Niche (Real-time)
**Sources:**
- Google Trends API (keywords, growth curves)
- TikTok Trends API (sounds, hashtags, creators)
- Reddit API (subreddits in niche, rising posts, sentiment)
- Twitter/X API (trending topics in niche, discourse)
- YouTube (trending shorts/long form in category)
- NewsAPI (articles trending in niche)

**Metrics to track:**
- Search volume growth (day-over-day, week-over-week)
- Post velocity (how many creators using sound/hashtag)
- Engagement momentum (average ER on trending content)
- Age of trend (new, peaking, declining)

### D. Articles & Educational Resources
**Sources:**
1. **Niche-specific publications** (API or RSS)
   - Medium (query by niche tags)
   - Substack (RSS feeds for newsletters in niche)
   - Blog feeds (industry-specific sites)

2. **Academic/Research**
   - ScienceDirect API
   - PubMed (health/wellness niches)
   - SSRN (social science papers)

3. **YouTube Educational**
   - YouTube Data API (educational videos tagged by niche)
   - TED Talks (relevant talks)

4. **Books/Guides**
   - Google Books API
   - Goodreads API

**Matching strategy:**
- Article + user's content pillars (keyword match + NLP)
- Article publication date (recent > old)
- Citation/engagement (how many shared this)

---

## 2. TECHNICAL ARCHITECTURE

### Frontend Components Needed
```
KnowledgeExplore/
├── Tabs (Similar Content | Trending | Articles | Creators | Formats)
├── SimilarContentGrid
│   ├── Post card (thumbnail, creator, ER%, voice match%)
│   ├── Filter (format, pillar, performance level)
│   └── Actions (save, study, share)
├── TrendingFeed
│   ├── Heat map (growth curve for each trend)
│   ├── Creator examples (3-5 using each trend)
│   └── Your performance on similar
├── ArticleCard
│   ├── Thumbnail, title, source
│   ├── Related pillar badges
│   ├── Save/Send to Alex
│   └── Keywords/themes extracted
├── CreatorProfile
│   ├── Bio, followers, growth
│   ├── Top 3 posts grid
│   ├── Strategy summary
│   └── Watch/unwatch button
└── FormatTrend
    ├── Format name (POV, carousel, static, etc.)
    ├── Your performance stats
    ├── Trending momentum
    └── 5 examples grid
```

### Backend Services to Create/Modify
```
1. NEW: ContentSimilarityService
   - Input: User's recent posts (format, caption, pillar)
   - Find similar posts from 500+ creators in niche
   - Score by: format match, voice match (NLP), pillar match
   - Return top 50 ranked by engagement

2. NEW: TrendingAnalyzerService
   - Runs 4x daily (6am, 12pm, 6pm, 10pm UTC)
   - Pulls from: Google Trends, TikTok API, YouTube, Reddit
   - Scores by: growth momentum, creator velocity, engagement avg
   - Returns: top 15 trends + examples

3. NEW: ArticleAggregatorService
   - Runs 2x daily
   - Scrapes Medium, Substack, NewsAPI, Google Scholar
   - Matches to user's pillars via NLP
   - Ranks by: relevance score, publication date, social signals

4. NEW: CreatorIntelligenceService
   - Runs weekly
   - Identifies top 20 similar creators in niche
   - Tracks their posts, growth, format preferences
   - Identifies patterns (their trending early indicators)

5. MODIFY: ExistingBrandMemoryService
   - Store which articles/trends were saved
   - Track which saved content led to high-performing posts
   - Use for feedback loop

6. MODIFY: ExistingMetricsService
   - Add: format trend analysis
   - Add: voice pattern scoring
   - Add: pillar momentum tracking
```

### Database Schema Additions
```
CreatorReference {
  id, userId, creatorId, platform, handle, followers,
  followerGrowth7d, followerGrowth30d, topPostsAvgER,
  niche, strategy, lastScanned, isWatching
}

TrendingContent {
  id, trendId, niche, trendName, category (sound|hashtag|topic|format),
  growthMomentum (%), searchVolume24h, postVelocity,
  examplePosts (JSON: post_id, creator, ER, platform),
  age, peakingAt, confidence
}

ArticleReference {
  id, userId, title, source, url, authorDomain,
  publishedDate, relatedPillars (JSON), keywordMatches,
  savedByUser, isSentToAgent (Alex/Jordan), performanceLinked
}

FormatTrend {
  id, userId, format (POV|Carousel|Static|Reel|Short|Long),
  platformDefault (IG|TT|YT), userPerformance (avgER%, count),
  trendingMomentum (%), examplePosts, yourRecentPostsOfFormat
}

ContentSimilarity {
  id, userPostId, similarPostId, creatorId, similarityScore,
  matchReasons (JSON: format, voice, pillar, angle),
  similarCreatorER, yourER (for comparison)
}
```

---

## 3. DATA FLOW

```
Morning (6am UTC):
  1. Pull user's recent 20 posts
  2. ContentSimilarityService finds 50 similar posts
  3. Score them (ER, format match, voice match)
  4. Update SimilarContent table
  5. Fetch trending sounds, hashtags, topics
  6. Update TrendingContent table

Midday (12pm UTC):
  1. Pull new articles from Medium, Substack, NewsAPI
  2. Match to user's pillars
  3. Deduplicate (already saved?)
  4. Update ArticleReference table

Weekly (Monday 6am UTC):
  1. CreatorIntelligenceService scans top creators
  2. Updates their follower growth, top posts
  3. Identifies patterns in their content
  4. Flag as "watch list" if strategy aligns with user

Always (Real-time):
  1. User saves article/post → store in preferences
  2. User saves → use to train voice/format matching
  3. User mentions in brief to Alex → link to output
  4. Post ships → check if inspired by saved item → store link
  5. Post performance → feedback loop (saved article led to 12% ER)
```

---

## 4. API INTEGRATIONS & COSTS

### Essential APIs
| API | Purpose | Cost | Rate Limit |
|-----|---------|------|-----------|
| Instagram Graph API | Similar creators | Free (Meta) | 200 req/hr |
| TikTok Open API | Trending sounds/creators | Free beta | 5M req/month |
| YouTube Data API | Trending videos | Free | 10K quota/day |
| Google Trends API | Search trends | Free | ~100 req/min |
| NewsAPI | Article aggregation | ~$50-400/mo | 1000 req/day free |
| Reddit API | Subreddit trending | Free | 60 req/min |

### Optional but Valuable
| API | Purpose | Cost |
|-----|---------|------|
| RapidAPI (Twitter Trends) | Real-time topic trends | $5-50/mo |
| ScienceDirect API | Academic articles | ~$200/mo |
| Medium API | Article scraping | Free |
| Substack RSS | Newsletter articles | Free |
| LLM (Claude/GPT-4) | NLP matching + summarization | $0.50-5/day per user |

---

## 5. ML/NLP COMPONENTS

### Voice Matching Engine
- Train on user's saved posts (captions, style)
- Score new content: 0-100 voice match %
- Compare tone, vocabulary, sentence structure, humor style
- Library: Hugging Face transformers (free, open-source)

### Pillar Matching
- User defines pillars ("rest + reframe", "quiet ambition", "boundaries")
- NLP clustering of articles/posts → pillar buckets
- Keyword + semantic matching
- Library: spaCy (free) + fine-tune on user's pillar examples

### Format Classification
- Identify format from post (POV, carousel, educational, etc.)
- Track which formats perform best for user
- Score trending formats by: velocity, avg ER, growth curve
- Library: Simple rule-based classifier initially, ML later

### Trend Scoring
- Input: keyword search volume, post velocity, avg ER
- Output: confidence that this will be relevant in 3-7 days
- Account for: niche-specific cycles, seasonal patterns
- Method: Time-series forecasting (Prophet/ARIMA)

---

## 6. IMPLEMENTATION PHASES

### Phase 1 (Weeks 1-2): MVP
- [ ] Similar Content grid (basic static example creators)
- [ ] Trending topics (Google Trends + NewsAPI)
- [ ] Articles aggregation (Medium + Substack)
- [ ] No ML, manual curation first

### Phase 2 (Weeks 3-4): Intelligence Layer
- [ ] Voice matching (spaCy NLP)
- [ ] Pillar auto-tagging (keyword + semantic)
- [ ] Format trend analysis
- [ ] Creator watching (top 20 creators, track weekly)

### Phase 3 (Month 2): Feedback Loop
- [ ] Track saved articles → posted content
- [ ] If post inspired by saved article, link & measure ER impact
- [ ] Brand memory: "articles with X themes lead to +8% ER"
- [ ] Auto-recommend similar articles when Alex is writing

### Phase 4 (Month 3): Real-time Trending
- [ ] TikTok/Instagram API integration for real-time sounds
- [ ] Push notifications: "POV mirrors trending +240%, your last one got 8.2% ER"
- [ ] Heat map showing format/trend momentum
- [ ] Competitor tracking (when top creators shift strategies)

---

## 7. QUICK WINS (Can Do First)

1. **Screenshot grid from successful creators**
   - Manually curate 50 posts from 20 creators in niche
   - Tag by format + pillar + ER level
   - User can explore, save, filter

2. **Google Sheets trending tracker**
   - Pull Google Trends data (free API)
   - Show top 10 rising keywords in niche
   - Update daily via Apps Script

3. **Medium feed by tag**
   - Query Medium API for pillar-related articles
   - Display top 20 this week
   - One-click save to collection

4. **Newsletter aggregator**
   - Substack RSS feeds (free)
   - Add 5-10 niche newsletters (user configurable)
   - Show latest articles with pillar matching

5. **Creator leaderboard**
   - Manually list top 20 creators in niche
   - Pull their follower count weekly
   - Show their recent top posts via Instagram Graph API

---

## 8. RESOURCE REQUIREMENTS

**Backend:** 2-3 weeks of dev
**Frontend:** 1-2 weeks of design + build
**ML/NLP:** 1 week (using existing libraries)
**APIs:** Budget $100-200/month for APIs
**Hosting:** Minimal (cron jobs + small DB growth)

**Total:** ~4-5 weeks, 1 senior engineer + 1 designer

---

## 9. VALUE DELIVERED

- **Creators stop guessing** — See exactly what's working in their niche
- **Reduce inspiration search** — Algorithm finds similar posts, trending formats
- **Deepen content knowledge** — Articles teach WHY trends matter
- **Track competitive moves** — Know when similar creators shift strategies
- **Feedback loop** — Learn which saved content led to high-performing posts
- **Faster ideation** — Alex & Jordan have curated inspiration ready
