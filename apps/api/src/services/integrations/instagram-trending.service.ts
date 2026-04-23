/**
 * Instagram Explore-like trending content via hashtags
 * Fetches top posts from niche-relevant hashtags
 */

import * as meta from '../../lib/metaGraph'

export interface InstagramHashtagPost {
  id: string
  caption: string
  mediaType: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM'
  mediaUrl?: string
  permalink: string
  timestamp: string
  likeCount: number
  commentsCount: number
  reachCount?: number
}

// Map niches to relevant hashtags for trending discovery
const NICHE_HASHTAGS: Record<string, string[]> = {
  fitness: ['fitnessmotivation', 'fitnessgains', 'fitnessjourney', 'workoutoftheday', 'gymmotivation', 'fitnesstrends'],
  finance: ['personalfinance', 'investingtips', 'moneymanagement', 'financialfreedom', 'moneytips', 'wealthbuilding'],
  food: ['foodphotography', 'recipevideo', 'easyrecipes', 'foodtrends', 'cookinghacks', 'foodblogger'],
  coaching: ['coachingcommunity', 'leadershipcoaching', 'businesscoaching', 'selfhelpcoach', 'coachforchange'],
  lifestyle: ['lifestylechange', 'dailyroutine', 'minimalistliving', 'sustainableliving', 'lifestyletips', 'wellness'],
  personal_development: ['personalgrowth', 'mindsetshift', 'habitbuilding', 'motivation', 'successmindset', 'goalsetting'],
}

/**
 * Get hashtags relevant to a niche
 */
export function getHashtagsForNiche(niche: string, subNiche?: string | null): string[] {
  const baseHashtags = NICHE_HASHTAGS[niche.toLowerCase()] || NICHE_HASHTAGS.lifestyle || []

  // If there's a sub-niche, try to add more specific hashtags
  if (subNiche) {
    const subLower = subNiche.toLowerCase()
    const moreSpecific: Record<string, string[]> = {
      travel: ['travelvlog', 'travelinspo', 'wanderlust', 'digitalnomad'],
      mom: ['momdaily', 'momlife', 'motherhood', 'workingmom', 'momhacks'],
      minimalism: ['minimalist', 'declutter', 'minimalistlifestyle', 'simpleliving'],
      wellness: ['wellnesstips', 'mentalhealth', 'yoga', 'meditation'],
      'weight loss': ['weightlossjourney', 'fitnessmotivation', 'healthylifestyle'],
      budgeting: ['budgettips', 'moneysavingstips', 'frugalliving'],
      crypto: ['cryptocurrency', 'bitcoin', 'defi', 'nftart'],
      vegan: ['veganrecipes', 'plantbased', 'vegancooking'],
    }

    for (const [key, hashtags] of Object.entries(moreSpecific)) {
      if (subLower.includes(key) || key.includes(subLower.split(' ')[0])) {
        return [...baseHashtags, ...hashtags].slice(0, 8)
      }
    }
  }

  return baseHashtags
}

/**
 * Fetch trending posts from Instagram hashtags
 * Uses Business Account API to get top posts by hashtag
 */
export async function fetchInstagramTrendingByHashtag(
  token: string,
  igBusinessId: string,
  hashtags: string[],
  limit = 12,
): Promise<InstagramHashtagPost[]> {
  const allPosts: InstagramHashtagPost[] = []

  try {
    // Search for each hashtag and fetch top posts
    for (const hashtag of hashtags.slice(0, 4)) {
      // Limit API calls
      try {
        // First, search for the hashtag ID
        const hashtagId = await meta.searchHashtag(hashtag, token, igBusinessId)
        if (!hashtagId) continue

        // Then get top posts for that hashtag
        const posts = await meta.getHashtagTopPosts(hashtagId, token, Math.ceil(limit / hashtags.length))
        allPosts.push(...posts)
      } catch (err) {
        console.warn(`[instagram-trending] failed to fetch hashtag ${hashtag}:`, err)
        continue
      }
    }

    // Dedupe by ID and return
    const seen = new Set<string>()
    return allPosts.filter((p) => {
      if (seen.has(p.id)) return false
      seen.add(p.id)
      return true
    }).slice(0, limit)
  } catch (err) {
    console.error('[instagram-trending] fetch failed:', err)
    return []
  }
}

/**
 * Format Instagram post as FeedItem for Knowledge Feed
 */
export function instagramPostToFeedItem(post: InstagramHashtagPost, niche: string, subNiche?: string | null): any {
  const nicheLabel = subNiche ? `${subNiche}/${niche}` : niche
  const engagementRate = post.likeCount + post.commentsCount
  const contentType = post.mediaType === 'CAROUSEL_ALBUM' ? 'carousel' : post.mediaType === 'VIDEO' ? 'reel' : 'static'

  // Maya's take on why this is relevant
  let mayaTake = ''
  if (engagementRate > 1000) {
    mayaTake = `${engagementRate.toLocaleString()} engagement on this ${contentType} in ${nicheLabel}. High-performing format right now.`
  } else if (engagementRate > 500) {
    mayaTake = `Strong engagement on ${contentType} format in ${nicheLabel}. Your audience responds to this style.`
  } else {
    mayaTake = `Trending ${contentType} in ${nicheLabel}. Check this format and approach.`
  }

  // Estimate views (Instagram doesn't always expose this, so use engagement as proxy)
  const estimatedViews = Math.round((engagementRate / 0.05) * 1.5) // assume 5% engagement rate

  return {
    id: `ig_${post.id}`,
    source: 'Instagram',
    title: post.caption ? post.caption.split('\n')[0].slice(0, 100) : `${contentType} from ${nicheLabel}`,
    summary: post.caption ? post.caption.slice(0, 240) : `${post.likeCount} likes, ${post.commentsCount} comments`,
    url: post.permalink,
    imageUrl: post.mediaUrl || null,
    createdAt: post.timestamp,
    type: 'video',
    score: Math.min(99, 50 + Math.floor(Math.log10(Math.max(10, estimatedViews)) * 5)),
    mayaTake,
  }
}
