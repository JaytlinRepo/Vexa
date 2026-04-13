import axios from 'axios'

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface RedditPost {
  id: string
  title: string
  selftext: string
  url: string
  permalink: string
  subreddit: string
  score: number
  numComments: number
  author: string
  createdUtc: number
  isVideo: boolean
  thumbnail?: string
  flair?: string
}

export interface RedditComment {
  id: string
  body: string
  score: number
  author: string
}

export interface SubredditInsight {
  subreddit: string
  topPosts: RedditPost[]
  topComments: RedditComment[]
  commonThemes: string[]
  hookOpportunities: string[]
}

// ─── NICHE → SUBREDDIT MAP ────────────────────────────────────────────────────

export const NICHE_SUBREDDITS: Record<string, string[]> = {
  fitness:            ['fitness', 'weightlifting', 'bodyweightfitness', 'xxfitness', 'nutrition', 'gainit', 'loseit'],
  finance:            ['personalfinance', 'investing', 'financialindependence', 'wallstreetbets', 'stocks', 'frugal'],
  food:               ['food', 'Cooking', 'MealPrepSunday', 'EatCheapAndHealthy', 'AskCulinary', 'recipes'],
  coaching:           ['Entrepreneur', 'selfimprovement', 'productivity', 'getdisciplined', 'DecidingToBeBetter'],
  lifestyle:          ['lifestyle', 'wellness', 'minimalism', 'selfcare', 'HealthyFood'],
  personal_development: ['selfimprovement', 'getdisciplined', 'habits', 'DecidingToBeBetter', 'CGPGrey'],
}

// ─── FETCH HOT POSTS ──────────────────────────────────────────────────────────

/**
 * Fetch hot posts from a subreddit.
 * Uses Reddit's public JSON API — no auth key required.
 */
export async function fetchSubredditHot(
  subreddit: string,
  limit = 10
): Promise<RedditPost[]> {
  const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=${limit}`

  const response = await axios.get(url, {
    timeout: 8000,
    headers: {
      'User-Agent': 'Vexa/1.0 (content research tool; contact@vexa.ai)',
    },
  })

  const children = response.data?.data?.children || []

  return children
    .filter((c: { data: { stickied: boolean; score: number } }) => !c.data.stickied && c.data.score > 50)
    .map((c: { data: Record<string, unknown> }) => {
      const d = c.data
      return {
        id: String(d.id),
        title: String(d.title || ''),
        selftext: String(d.selftext || '').slice(0, 500),
        url: String(d.url || ''),
        permalink: `https://reddit.com${String(d.permalink || '')}`,
        subreddit: String(d.subreddit || subreddit),
        score: Number(d.score || 0),
        numComments: Number(d.num_comments || 0),
        author: String(d.author || ''),
        createdUtc: Number(d.created_utc || 0),
        isVideo: Boolean(d.is_video),
        thumbnail: d.thumbnail && String(d.thumbnail).startsWith('http') ? String(d.thumbnail) : undefined,
        flair: d.link_flair_text ? String(d.link_flair_text) : undefined,
      }
    })
}

// ─── FETCH RISING POSTS ───────────────────────────────────────────────────────

/**
 * Fetch rising posts — early signal before something goes viral.
 */
export async function fetchSubredditRising(
  subreddit: string,
  limit = 10
): Promise<RedditPost[]> {
  const url = `https://www.reddit.com/r/${subreddit}/rising.json?limit=${limit}`

  const response = await axios.get(url, {
    timeout: 8000,
    headers: { 'User-Agent': 'Vexa/1.0 (content research tool; contact@vexa.ai)' },
  })

  const children = response.data?.data?.children || []

  return children
    .filter((c: { data: { stickied: boolean } }) => !c.data.stickied)
    .map((c: { data: Record<string, unknown> }) => {
      const d = c.data
      return {
        id: String(d.id),
        title: String(d.title || ''),
        selftext: String(d.selftext || '').slice(0, 500),
        url: String(d.url || ''),
        permalink: `https://reddit.com${String(d.permalink || '')}`,
        subreddit: String(d.subreddit || subreddit),
        score: Number(d.score || 0),
        numComments: Number(d.num_comments || 0),
        author: String(d.author || ''),
        createdUtc: Number(d.created_utc || 0),
        isVideo: Boolean(d.is_video),
      }
    })
}

// ─── FETCH TOP COMMENTS ───────────────────────────────────────────────────────

/**
 * Fetch top comments from a post — goldmine for authentic hooks.
 * Real people's exact language = the best hook research.
 */
export async function fetchPostTopComments(
  permalink: string,
  limit = 10
): Promise<RedditComment[]> {
  const url = `${permalink}.json?limit=${limit}&sort=top`

  const response = await axios.get(url, {
    timeout: 8000,
    headers: { 'User-Agent': 'Vexa/1.0 (content research tool; contact@vexa.ai)' },
  })

  const commentData = response.data?.[1]?.data?.children || []

  return commentData
    .filter((c: { kind: string; data: { score: number; body: string } }) =>
      c.kind === 't1' && c.data.score > 5 && c.data.body && c.data.body !== '[deleted]'
    )
    .slice(0, limit)
    .map((c: { data: Record<string, unknown> }) => ({
      id: String(c.data.id),
      body: String(c.data.body || '').slice(0, 400),
      score: Number(c.data.score || 0),
      author: String(c.data.author || ''),
    }))
}

// ─── NICHE INSIGHT AGGREGATOR ─────────────────────────────────────────────────

/**
 * Main function Maya calls to get Reddit intelligence for a niche.
 * Returns hot posts, rising posts, and top comments from the best thread.
 */
export async function getNicheRedditInsights(
  niche: string,
  subNiche?: string
): Promise<SubredditInsight[]> {
  const subreddits = NICHE_SUBREDDITS[niche.toLowerCase()] || [niche]
  const topSubs = subreddits.slice(0, 3) // keep costs minimal

  const insights: SubredditInsight[] = []

  for (const sub of topSubs) {
    try {
      const [hotPosts, risingPosts] = await Promise.all([
        fetchSubredditHot(sub, 8),
        fetchSubredditRising(sub, 5),
      ])

      // Grab comments from the highest-engagement post
      const bestPost = hotPosts.sort((a, b) => b.numComments - a.numComments)[0]
      let topComments: RedditComment[] = []

      if (bestPost) {
        try {
          topComments = await fetchPostTopComments(bestPost.permalink, 8)
        } catch {
          // Comments fetch failing shouldn't kill the whole insight
        }
      }

      // Extract hook opportunities from post titles and comments
      const hookOpportunities = [
        ...hotPosts.slice(0, 3).map(p => p.title),
        ...topComments.slice(0, 3).map(c => `"${c.body.split('.')[0]}"`)
      ]

      insights.push({
        subreddit: sub,
        topPosts: [...hotPosts, ...risingPosts].slice(0, 10),
        topComments,
        commonThemes: extractThemes(hotPosts),
        hookOpportunities,
      })

      // Be a good citizen — small delay between requests
      await sleep(800)

    } catch (err) {
      console.warn(`Reddit fetch failed for r/${sub}:`, err)
    }
  }

  return insights
}

// ─── FORMAT FOR MAYA ──────────────────────────────────────────────────────────

/**
 * Format Reddit insights into a prompt string Maya can analyze.
 */
export function formatRedditForMaya(insights: SubredditInsight[], niche: string): string {
  if (!insights.length) return ''

  const sections = insights.map(insight => {
    const posts = insight.topPosts
      .slice(0, 5)
      .map(p => `  - "${p.title}" (${p.score} upvotes, ${p.numComments} comments)`)
      .join('\n')

    const comments = insight.topComments
      .slice(0, 4)
      .map(c => `  - "${c.body.slice(0, 150)}" (${c.score} upvotes)`)
      .join('\n')

    return `r/${insight.subreddit}:\nTop posts:\n${posts}\n\nTop comments (authentic audience voice):\n${comments}`
  })

  return `Reddit intelligence for ${niche} niche (pulled ${new Date().toDateString()}):\n\n${sections.join('\n\n---\n\n')}`
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function extractThemes(posts: RedditPost[]): string[] {
  const titleWords = posts.flatMap(p =>
    p.title.toLowerCase().split(/\s+/).filter(w => w.length > 4)
  )

  const freq: Record<string, number> = {}
  titleWords.forEach(w => { freq[w] = (freq[w] || 0) + 1 })

  return Object.entries(freq)
    .filter(([, count]) => count > 1)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
    .map(([word]) => word)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
