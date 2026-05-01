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
  /** Set on VIDEO posts — the IG-hosted still-frame preview image. */
  thumbnailUrl?: string
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
    // Use up to 6 hashtags (Meta hashtag-search has its own per-app rate
    // limit; 6 is comfortably under). Per-tag fetch sized so the total
    // volume hits the requested limit even when some hashtags return short.
    const tagCount = Math.min(6, hashtags.length)
    const perTag = Math.max(4, Math.ceil(limit / Math.max(1, tagCount)))
    const results = await Promise.allSettled(
      hashtags.slice(0, tagCount).map(async (hashtag) => {
        const hashtagId = await meta.searchHashtag(hashtag, token, igBusinessId)
        if (!hashtagId) return []
        return meta.getHashtagTopPosts(hashtagId, token, igBusinessId, perTag)
      })
    )

    for (const r of results) {
      if (r.status === 'fulfilled') allPosts.push(...r.value)
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

  // Surface mediaType + isVideo so the frontend's looksLikeVideo() filter
  // correctly classifies VIDEO posts as reels (instead of falling back to
  // URL heuristics, which fail for IG since hashtag API returns .jpg URLs
  // for images and the permalink alone doesn't identify the format).
  const isVideo = post.mediaType === 'VIDEO'
  // For VIDEO posts: media_url is the .mp4, thumbnail_url is the still
  // frame. For images: media_url is the photo. Pick the right one for
  // each surface so the front-end gets a real image into <img>/poster
  // and a real video file into <video src>.
  const previewImage = isVideo ? post.thumbnailUrl || null : post.mediaUrl || null
  return {
    id: `ig_${post.id}`,
    // Use the static 'Instagram' source — the IG hashtag API does not
    // return usernames, so we can't differentiate creators here. Items
    // from this source are excluded from the dedup-by-creator cap in
    // feed.ts; the cap is intended for community @handles only.
    source: 'Instagram',
    title: post.caption ? post.caption.split('\n')[0].slice(0, 100) : `${contentType} from ${nicheLabel}`,
    summary: post.caption ? post.caption.slice(0, 240) : `${post.likeCount} likes, ${post.commentsCount} comments`,
    url: post.permalink,
    imageUrl: previewImage,
    thumbnail: previewImage,
    videoUrl: isVideo ? post.mediaUrl || null : undefined,
    mediaType: post.mediaType,
    isVideo,
    createdAt: post.timestamp,
    type: 'instagram',
    score: Math.min(99, 50 + Math.floor(Math.log10(Math.max(10, estimatedViews)) * 5)),
    mayaTake,
  }
}
