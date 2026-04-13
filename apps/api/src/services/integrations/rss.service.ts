import axios from 'axios'
import * as xml2js from 'xml2js'

/**
 * RSS Feed Aggregator
 *
 * Cost: 100% FREE — RSS is an open standard.
 * No API keys. No rate limits (be polite though).
 * Every major publication has an RSS feed.
 * This is Maya's most reliable and cheapest signal source.
 *
 * Install: npm install xml2js
 */

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface RSSItem {
  title: string
  description: string
  url: string
  source: string
  author?: string
  publishedAt: Date
  categories?: string[]
  imageUrl?: string
}

// ─── NICHE RSS FEED REGISTRY ──────────────────────────────────────────────────

interface FeedConfig {
  url: string
  name: string
  quality: 'high' | 'medium' | 'low'
}

export const NICHE_RSS_FEEDS: Record<string, FeedConfig[]> = {
  fitness: [
    { url: 'https://www.menshealth.com/rss/all.xml/', name: "Men's Health", quality: 'high' },
    { url: 'https://www.womenshealthmag.com/rss/all.xml/', name: "Women's Health", quality: 'high' },
    { url: 'https://breakingmuscle.com/feed/', name: 'Breaking Muscle', quality: 'high' },
    { url: 'https://www.acefitness.org/resources/rss/', name: 'ACE Fitness', quality: 'medium' },
    { url: 'https://examine.com/rss.xml', name: 'Examine.com', quality: 'high' },
    { url: 'https://www.bodybuilding.com/rss/articles.xml', name: 'Bodybuilding.com', quality: 'medium' },
  ],
  finance: [
    { url: 'https://www.investopedia.com/feedbuilder/feed/getfeed/?feedName=rss_headline', name: 'Investopedia', quality: 'high' },
    { url: 'https://www.nerdwallet.com/blog/feed/', name: 'NerdWallet', quality: 'high' },
    { url: 'https://affordanything.com/feed/', name: 'Afford Anything', quality: 'high' },
    { url: 'https://feeds.feedburner.com/mrmoneymustache', name: 'Mr. Money Mustache', quality: 'high' },
    { url: 'https://www.financialsamurai.com/feed/', name: 'Financial Samurai', quality: 'medium' },
    { url: 'https://thecollegeinvestor.com/feed/', name: 'The College Investor', quality: 'medium' },
  ],
  food: [
    { url: 'https://www.seriouseats.com/feed/all', name: 'Serious Eats', quality: 'high' },
    { url: 'https://food52.com/blog/feed', name: 'Food52', quality: 'high' },
    { url: 'https://smittenkitchen.com/feed/', name: 'Smitten Kitchen', quality: 'high' },
    { url: 'https://www.eater.com/rss/index.xml', name: 'Eater', quality: 'medium' },
    { url: 'https://www.thekitchn.com/main.rss', name: 'The Kitchn', quality: 'medium' },
    { url: 'https://minimalistbaker.com/feed/', name: 'Minimalist Baker', quality: 'high' },
  ],
  coaching: [
    { url: 'https://www.inc.com/rss/', name: 'Inc Magazine', quality: 'high' },
    { url: 'https://hbr.org/feeds/topics/leadership', name: 'Harvard Business Review', quality: 'high' },
    { url: 'https://www.entrepreneur.com/latest.rss', name: 'Entrepreneur', quality: 'medium' },
    { url: 'https://zenhabits.net/feed/', name: 'Zen Habits', quality: 'high' },
    { url: 'https://www.fastcompany.com/rss', name: 'Fast Company', quality: 'medium' },
  ],
  lifestyle: [
    { url: 'https://www.wellandgood.com/feed/', name: 'Well+Good', quality: 'high' },
    { url: 'https://www.mindbodygreen.com/rss.xml', name: 'mindbodygreen', quality: 'high' },
    { url: 'https://bemorewithless.com/feed/', name: 'Be More With Less', quality: 'medium' },
    { url: 'https://mnmlist.com/feed/', name: 'mnmlist', quality: 'medium' },
    { url: 'https://www.apartmenttherapy.com/main.rss', name: 'Apartment Therapy', quality: 'medium' },
  ],
  personal_development: [
    { url: 'https://jamesclear.com/feed', name: 'James Clear', quality: 'high' },
    { url: 'https://markmanson.net/feed', name: 'Mark Manson', quality: 'high' },
    { url: 'https://zenhabits.net/feed/', name: 'Zen Habits', quality: 'high' },
    { url: 'https://www.scotthyoung.com/blog/feed/', name: 'Scott H. Young', quality: 'high' },
    { url: 'https://tim.blog/feed/', name: 'Tim Ferriss', quality: 'high' },
    { url: 'https://www.nateliason.com/feed', name: 'Nat Eliason', quality: 'medium' },
  ],
}

// ─── FETCH SINGLE FEED ────────────────────────────────────────────────────────

export async function fetchRSSFeed(
  feedConfig: FeedConfig,
  maxItems = 6
): Promise<RSSItem[]> {
  try {
    const response = await axios.get(feedConfig.url, {
      timeout: 8000,
      headers: {
        'User-Agent': 'Vexa/1.0 (content aggregator; contact@vexa.ai)',
        'Accept': 'application/rss+xml, application/xml, text/xml',
      },
      responseType: 'text',
    })

    const parsed = await xml2js.parseStringPromise(response.data, {
      explicitArray: false,
      ignoreAttrs: false,
    })

    const channel = parsed?.rss?.channel || parsed?.feed
    if (!channel) return []

    const rawItems = channel.item || channel.entry || []
    const items = Array.isArray(rawItems) ? rawItems : [rawItems]

    return items.slice(0, maxItems).map((item: Record<string, unknown>) => {
      const title = extractText(item.title)
      const description = stripHtml(
        extractText(item.description || item.summary || item['content:encoded'] || '')
      ).slice(0, 300)
      const link = extractText(item.link || item.id) || ''
      const pubDate = extractText(item.pubDate || item.published || item.updated || '')
      const author = extractText(item.author || item['dc:creator'] || '')

      // Try to extract image from content
      const content = extractText(item['content:encoded'] || item.content || '')
      const imageMatch = content.match(/<img[^>]+src=["']([^"']+)["']/i)
      const imageUrl = imageMatch ? imageMatch[1] : undefined

      // Extract categories
      const cats = item.category
      const categories = cats
        ? (Array.isArray(cats) ? cats : [cats]).map(c => extractText(c)).filter(Boolean)
        : []

      return {
        title: title.slice(0, 150),
        description,
        url: link,
        source: feedConfig.name,
        author: author || undefined,
        publishedAt: pubDate ? new Date(pubDate) : new Date(),
        categories,
        imageUrl,
      } as RSSItem
    })
  } catch (err) {
    console.warn(`RSS fetch failed for ${feedConfig.name}:`, (err as Error).message)
    return []
  }
}

// ─── FETCH ALL FEEDS FOR NICHE ────────────────────────────────────────────────

/**
 * Fetches all high-quality RSS feeds for a niche in parallel.
 * Deduplicates by URL and sorts by publish date.
 */
export async function fetchNicheRSSFeeds(
  niche: string,
  maxFeedsToFetch = 4,
  itemsPerFeed = 5
): Promise<RSSItem[]> {
  const feeds = (NICHE_RSS_FEEDS[niche.toLowerCase()] || [])
    .filter(f => f.quality === 'high') // start with high quality only
    .slice(0, maxFeedsToFetch)

  if (!feeds.length) {
    console.warn(`No RSS feeds configured for niche: ${niche}`)
    return []
  }

  const results = await Promise.allSettled(
    feeds.map(feed => fetchRSSFeed(feed, itemsPerFeed))
  )

  const allItems = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => (r as PromiseFulfilledResult<RSSItem[]>).value)

  // Deduplicate by URL
  const seen = new Set<string>()
  const deduped = allItems.filter(item => {
    if (!item.url || seen.has(item.url)) return false
    seen.add(item.url)
    return true
  })

  // Sort by publish date, newest first
  return deduped.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
}

// ─── FORMAT FOR MAYA ──────────────────────────────────────────────────────────

export function formatRSSForMaya(items: RSSItem[], niche: string): string {
  if (!items.length) return ''

  const lines = items
    .slice(0, 12)
    .map(item => {
      const age = getRelativeTime(item.publishedAt)
      return `  - [${item.source}] "${item.title}" (${age})\n    ${item.description}`
    })
    .join('\n\n')

  return `Recent articles from ${niche} publications:\n\n${lines}`
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function extractText(val: unknown): string {
  if (!val) return ''
  if (typeof val === 'string') return val.trim()
  if (typeof val === 'object' && val !== null) {
    const obj = val as Record<string, unknown>
    return String(obj._ || obj.$t || obj['#text'] || Object.values(obj).find(v => typeof v === 'string') || '').trim()
  }
  return String(val).trim()
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function getRelativeTime(date: Date): string {
  const hours = Math.floor((Date.now() - date.getTime()) / 3600000)
  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
