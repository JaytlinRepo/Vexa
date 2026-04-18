import axios from 'axios'
import * as xml2js from 'xml2js'

// ─── TYPES ────────────────────────────────────────────────────────────────────

export type FeedItemType =
  | 'article'
  | 'research'
  | 'reddit'
  | 'youtube'
  | 'news'
  | 'forum'

export interface FeedItem {
  id: string
  type: FeedItemType
  title: string
  summary: string
  url: string
  source: string
  sourceLogo?: string
  author?: string
  publishedAt: string
  niche: string
  tags: string[]
  mayaInsight?: string       // Added by Maya after AI analysis
  contentScore?: number      // 0-100, how useful for content creation
}

export interface NicheFeed {
  niche: string
  items: FeedItem[]
  fetchedAt: Date
  totalSources: number
}

// ─── NICHE SOURCE CONFIG ──────────────────────────────────────────────────────

interface NicheSourceConfig {
  rssFeeds: Array<{ url: string; sourceName: string }>
  redditSubs: string[]
  youtubeChannelIds?: string[]
  pubmedKeywords?: string[]
}

const NICHE_SOURCES: Record<string, NicheSourceConfig> = {
  fitness: {
    rssFeeds: [
      { url: 'https://www.menshealth.com/rss/all.xml/', sourceName: 'Men\'s Health' },
      { url: 'https://www.womenshealthmag.com/rss/all.xml/', sourceName: 'Women\'s Health' },
      { url: 'https://breakingmuscle.com/feed/', sourceName: 'Breaking Muscle' },
      { url: 'https://www.t-nation.com/feed/', sourceName: 'T-Nation' },
      { url: 'https://www.acefitness.org/resources/rss/', sourceName: 'ACE Fitness' },
    ],
    redditSubs: ['r/fitness', 'r/weightlifting', 'r/bodyweightfitness', 'r/xxfitness', 'r/nutrition'],
    pubmedKeywords: ['exercise physiology', 'strength training', 'sports nutrition'],
  },
  finance: {
    rssFeeds: [
      { url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml', sourceName: 'Wall Street Journal' },
      { url: 'https://feeds.bloomberg.com/markets/news.rss', sourceName: 'Bloomberg' },
      { url: 'https://www.investopedia.com/feedbuilder/feed/getfeed/?feedName=rss_headline', sourceName: 'Investopedia' },
      { url: 'https://www.nerdwallet.com/blog/feed/', sourceName: 'NerdWallet' },
      { url: 'https://affordanything.com/feed/', sourceName: 'Afford Anything' },
    ],
    redditSubs: ['r/personalfinance', 'r/investing', 'r/financialindependence', 'r/stocks', 'r/wallstreetbets'],
  },
  food: {
    rssFeeds: [
      { url: 'https://www.seriouseats.com/feed/all', sourceName: 'Serious Eats' },
      { url: 'https://food52.com/blog/feed', sourceName: 'Food52' },
      { url: 'https://www.bonappetit.com/feed/rss', sourceName: 'Bon Appétit' },
      { url: 'https://www.eater.com/rss/index.xml', sourceName: 'Eater' },
      { url: 'https://smittenkitchen.com/feed/', sourceName: 'Smitten Kitchen' },
    ],
    redditSubs: ['r/food', 'r/Cooking', 'r/MealPrepSunday', 'r/EatCheapAndHealthy', 'r/AskCulinary'],
  },
  coaching: {
    rssFeeds: [
      { url: 'https://www.inc.com/rss/', sourceName: 'Inc Magazine' },
      { url: 'https://hbr.org/feeds/topics/leadership', sourceName: 'Harvard Business Review' },
      { url: 'https://feeds.feedburner.com/tonyrobbins', sourceName: 'Tony Robbins' },
      { url: 'https://www.entrepreneur.com/latest.rss', sourceName: 'Entrepreneur' },
    ],
    redditSubs: ['r/Entrepreneur', 'r/lifecoach', 'r/selfimprovement', 'r/productivity'],
  },
  lifestyle: {
    rssFeeds: [
      { url: 'https://www.wellandgood.com/feed/', sourceName: 'Well+Good' },
      { url: 'https://www.mindbodygreen.com/rss.xml', sourceName: 'mindbodygreen' },
      { url: 'https://www.refinery29.com/rss.xml', sourceName: 'Refinery29' },
      { url: 'https://goop.com/feed/', sourceName: 'goop' },
    ],
    redditSubs: ['r/lifestyle', 'r/wellness', 'r/minimalism', 'r/zerowaste'],
  },
  personal_development: {
    rssFeeds: [
      { url: 'https://jamesclear.com/feed', sourceName: 'James Clear' },
      { url: 'https://markmanson.net/feed', sourceName: 'Mark Manson' },
      { url: 'https://zenhabits.net/feed/', sourceName: 'Zen Habits' },
      { url: 'https://www.scotthyoung.com/blog/feed/', sourceName: 'Scott H Young' },
      { url: 'https://tim.blog/feed/', sourceName: 'Tim Ferriss' },
    ],
    redditSubs: ['r/selfimprovement', 'r/getdisciplined', 'r/habits', 'r/DecidingToBeBetter'],
    pubmedKeywords: ['habit formation', 'behavior change', 'cognitive behavioral'],
  },
}

// ─── SUB-NICHE SOURCES (curated overrides per sub-niche) ─────────────────────
// When a sub-niche matches a key here, its feeds + subs are MERGED with the
// parent niche config — giving more targeted content while keeping the base.

const SUB_NICHE_SOURCES: Record<string, Record<string, Partial<NicheSourceConfig>>> = {
  lifestyle: {
    'travel': {
      rssFeeds: [
        { url: 'https://feeds.feedburner.com/nomadicmatt', sourceName: 'Nomadic Matt' },
        { url: 'https://www.lonelyplanet.com/news/feed', sourceName: 'Lonely Planet' },
      ],
      redditSubs: ['r/travel', 'r/solotravel', 'r/digitalnomad', 'r/backpacking'],
    },
    'college': {
      rssFeeds: [
        { url: 'https://www.hercampus.com/rss.xml', sourceName: 'Her Campus' },
      ],
      redditSubs: ['r/college', 'r/collegeinfogeek', 'r/GetStudying', 'r/frugal'],
    },
    'mom': {
      rssFeeds: [
        { url: 'https://www.scarymommy.com/feed', sourceName: 'Scary Mommy' },
        { url: 'https://cupofjo.com/feed/', sourceName: 'Cup of Jo' },
      ],
      redditSubs: ['r/Mommit', 'r/Parenting', 'r/beyondthebump', 'r/workingmoms'],
    },
    'minimalism': {
      rssFeeds: [
        { url: 'https://www.theminimalists.com/feed/', sourceName: 'The Minimalists' },
        { url: 'https://becomingminimalist.com/feed/', sourceName: 'Becoming Minimalist' },
      ],
      redditSubs: ['r/minimalism', 'r/declutter', 'r/simpleliving', 'r/zerowaste'],
    },
    'wellness': {
      rssFeeds: [
        { url: 'https://www.wellandgood.com/feed/', sourceName: 'Well+Good' },
        { url: 'https://www.mindbodygreen.com/rss.xml', sourceName: 'mindbodygreen' },
      ],
      redditSubs: ['r/wellness', 'r/Meditation', 'r/selfcare', 'r/HealthyFood'],
    },
  },
  fitness: {
    'weight loss': {
      redditSubs: ['r/loseit', 'r/progresspics', 'r/CICO', 'r/intermittentfasting'],
    },
    'bodybuilding': {
      rssFeeds: [
        { url: 'https://www.t-nation.com/feed/', sourceName: 'T-Nation' },
      ],
      redditSubs: ['r/bodybuilding', 'r/naturalbodybuilding', 'r/powerlifting'],
    },
    'yoga': {
      redditSubs: ['r/yoga', 'r/flexibility', 'r/Meditation'],
    },
    'running': {
      redditSubs: ['r/running', 'r/C25K', 'r/AdvancedRunning', 'r/trailrunning'],
    },
  },
  finance: {
    'investing': {
      redditSubs: ['r/investing', 'r/stocks', 'r/ValueInvesting', 'r/dividends'],
    },
    'budgeting': {
      redditSubs: ['r/personalfinance', 'r/povertyfinance', 'r/Frugal', 'r/ynab'],
    },
    'crypto': {
      redditSubs: ['r/CryptoCurrency', 'r/Bitcoin', 'r/ethereum', 'r/defi'],
    },
  },
  food: {
    'baking': {
      redditSubs: ['r/Baking', 'r/Breadit', 'r/cakedecorating', 'r/ArtisanBread'],
    },
    'meal prep': {
      redditSubs: ['r/MealPrepSunday', 'r/EatCheapAndHealthy', 'r/slowcooking'],
    },
    'vegan': {
      redditSubs: ['r/vegan', 'r/veganrecipes', 'r/PlantBasedDiet'],
    },
  },
}

/** Find the best matching sub-niche key from the detected sub-niche string */
function matchSubNiche(niche: string, detectedSubNiche: string): string | null {
  const subMap = SUB_NICHE_SOURCES[niche]
  if (!subMap) return null
  const lower = detectedSubNiche.toLowerCase()
  // Exact key match first
  if (subMap[lower]) return lower
  // Fuzzy: check if any key appears in the detected string
  for (const key of Object.keys(subMap)) {
    if (lower.includes(key) || key.includes(lower.split(' ')[0])) return key
  }
  return null
}

/** Merge parent niche config with sub-niche overrides */
function mergedConfig(niche: string, subNicheKey: string | null): NicheSourceConfig {
  const base = NICHE_SOURCES[niche.toLowerCase()] || NICHE_SOURCES.lifestyle!
  if (!subNicheKey) return base
  const sub = SUB_NICHE_SOURCES[niche]?.[subNicheKey]
  if (!sub) return base
  return {
    rssFeeds: [...(sub.rssFeeds || []), ...base.rssFeeds],
    redditSubs: [...new Set([...(sub.redditSubs || []), ...base.redditSubs])],
    youtubeChannelIds: [...(sub.youtubeChannelIds || []), ...(base.youtubeChannelIds || [])],
    pubmedKeywords: [...(sub.pubmedKeywords || []), ...(base.pubmedKeywords || [])],
  }
}

// ─── MAIN FEED AGGREGATOR ─────────────────────────────────────────────────────

export async function aggregateNicheFeed(
  niche: string,
  subNiche?: string,
  limit = 20
): Promise<NicheFeed> {
  const subKey = subNiche ? matchSubNiche(niche.toLowerCase(), subNiche) : null
  const config = mergedConfig(niche.toLowerCase(), subKey)
  if (subKey) console.log(`[feed] using sub-niche '${subKey}' sources for ${niche}`)
  const allItems: FeedItem[] = []

  const results = await Promise.allSettled([
    fetchRSSFeeds(config.rssFeeds, niche),
    fetchRedditPosts(config.redditSubs, niche, subNiche),
    config.pubmedKeywords ? fetchPubMedArticles(config.pubmedKeywords, niche) : Promise.resolve([]),
  ])

  for (const result of results) {
    if (result.status === 'fulfilled') {
      allItems.push(...result.value)
    }
  }

  // Deduplicate by URL
  const seen = new Set<string>()
  const deduped = allItems.filter(item => {
    if (seen.has(item.url)) return false
    seen.add(item.url)
    return true
  })

  // Sort by date, most recent first
  const sorted = deduped.sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  )

  return {
    niche,
    items: sorted.slice(0, limit),
    fetchedAt: new Date(),
    totalSources: config.rssFeeds.length + config.redditSubs.length,
  }
}

// ─── RSS FEED FETCHER ─────────────────────────────────────────────────────────

async function fetchRSSFeeds(
  feeds: Array<{ url: string; sourceName: string }>,
  niche: string
): Promise<FeedItem[]> {
  const results = await Promise.allSettled(
    feeds.map(feed => fetchSingleRSS(feed.url, feed.sourceName, niche))
  )

  return results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => (r as PromiseFulfilledResult<FeedItem[]>).value)
}

async function fetchSingleRSS(
  url: string,
  sourceName: string,
  niche: string
): Promise<FeedItem[]> {
  const response = await axios.get(url, {
    timeout: 6000,
    headers: { 'User-Agent': 'Sovexa/1.0 (content aggregator)' },
  })

  const parsed = await xml2js.parseStringPromise(response.data, { explicitArray: false })
  const channel = parsed?.rss?.channel || parsed?.feed

  if (!channel) return []

  const rawItems = channel.item || channel.entry || []
  const items = Array.isArray(rawItems) ? rawItems : [rawItems]

  return items.slice(0, 5).map((item: Record<string, unknown>, idx: number) => {
    const title = extractText(item.title)
    const description = extractText(item.description || item.summary || item['content:encoded'])
    const link = extractText(item.link || item.id) || ''
    const pubDate = extractText(item.pubDate || item.published || item.updated) || new Date().toISOString()
    const author = extractText(item.author || item['dc:creator'])

    return {
      id: `rss-${sourceName}-${idx}-${Date.now()}`,
      type: 'article' as FeedItemType,
      title: title.slice(0, 120),
      summary: stripHtml(description).slice(0, 280),
      url: link,
      source: sourceName,
      author: typeof author === 'string' ? author : undefined,
      publishedAt: new Date(pubDate).toISOString(),
      niche,
      tags: [niche, 'article'],
    }
  })
}

// ─── REDDIT FETCHER (no auth needed for public JSON) ─────────────────────────

async function fetchRedditPosts(
  subreddits: string[],
  niche: string,
  subNiche?: string
): Promise<FeedItem[]> {
  const results = await Promise.allSettled(
    subreddits.slice(0, 3).map(sub => fetchSubreddit(sub, niche))
  )

  return results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => (r as PromiseFulfilledResult<FeedItem[]>).value)
}

async function fetchSubreddit(subreddit: string, niche: string): Promise<FeedItem[]> {
  const sub = subreddit.replace('r/', '')
  const response = await axios.get(`https://www.reddit.com/r/${sub}/hot.json?limit=5`, {
    timeout: 6000,
    headers: { 'User-Agent': 'Sovexa/1.0' },
  })

  const posts = response.data?.data?.children || []

  return posts
    .filter((p: { data: { is_self: boolean; score: number; stickied: boolean } }) =>
      p.data.score > 100 && !p.data.stickied
    )
    .slice(0, 4)
    .map((post: { data: Record<string, unknown> }) => {
      const d = post.data
      return {
        id: `reddit-${d.id}`,
        type: 'reddit' as FeedItemType,
        title: String(d.title || '').slice(0, 120),
        summary: String(d.selftext || d.url || '').slice(0, 280),
        url: `https://reddit.com${d.permalink}`,
        source: `r/${d.subreddit}`,
        author: String(d.author || 'reddit'),
        publishedAt: new Date(Number(d.created_utc) * 1000).toISOString(),
        niche,
        tags: [niche, 'community', 'reddit'],
        contentScore: Math.min(100, Math.floor(Number(d.score) / 100)),
      }
    })
}

// ─── PUBMED FETCHER (free, no key needed) ────────────────────────────────────

async function fetchPubMedArticles(keywords: string[], niche: string): Promise<FeedItem[]> {
  const query = keywords.slice(0, 2).join('+AND+')
  const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=5&sort=pub+date&retmode=json`

  const searchResponse = await axios.get(searchUrl, { timeout: 6000 })
  const ids: string[] = searchResponse.data?.esearchresult?.idlist || []

  if (!ids.length) return []

  const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`
  const summaryResponse = await axios.get(summaryUrl, { timeout: 6000 })
  const result = summaryResponse.data?.result || {}

  return ids
    .filter(id => result[id])
    .map(id => {
      const article = result[id]
      return {
        id: `pubmed-${id}`,
        type: 'research' as FeedItemType,
        title: String(article.title || '').slice(0, 120),
        summary: `Published in ${article.source || 'PubMed'}. Authors: ${(article.authors || []).slice(0, 2).map((a: { name: string }) => a.name).join(', ')}`,
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
        source: 'PubMed Research',
        author: (article.authors || [])[0]?.name,
        publishedAt: article.pubdate ? new Date(article.pubdate).toISOString() : new Date().toISOString(),
        niche,
        tags: [niche, 'research', 'science'],
        contentScore: 90, // Research always high content score
      }
    })
}

// ─── MAYA INSIGHT ENRICHMENT ──────────────────────────────────────────────────

/**
 * Takes raw feed items and formats them as context for Maya to analyze.
 * Maya then adds her insight and content score to each item.
 */
export function formatFeedForMaya(items: FeedItem[], niche: string): string {
  return `Here are the latest articles and discussions in the ${niche} space. For each item, provide:
1. A one-sentence insight on why this matters for a ${niche} content creator
2. A content opportunity score (0-100) based on how easily this could become viral content
3. One specific content angle this could become

Items to analyze:
${items.map((item, i) => `
[${i + 1}] "${item.title}"
Source: ${item.source} (${item.type})
Summary: ${item.summary}
`).join('\n')}

Return ONLY valid JSON array:
[
  {
    "index": number,
    "mayaInsight": "string (Maya's take — direct, specific, why it matters NOW)",
    "contentScore": number,
    "contentAngle": "string (one specific content idea this could become)"
  }
]`
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function extractText(val: unknown): string {
  if (!val) return ''
  if (typeof val === 'string') return val
  if (typeof val === 'object' && val !== null) {
    const obj = val as Record<string, unknown>
    return String(obj._ || obj.$t || obj['#text'] || Object.values(obj)[0] || '')
  }
  return String(val)
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}
