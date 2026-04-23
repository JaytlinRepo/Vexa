/**
 * Heuristics Engine
 *
 * Platform best-practice rules derived from industry data.
 * Returns signals that agents can use to improve their outputs.
 */

export interface HeuristicSignal {
  rule: string
  applies: boolean
  impact: 'high' | 'medium' | 'low'
  suggestion: string
}

export function evaluateHeuristics(context: {
  platform: string
  mediaType: string
  captionLength: number
  hasQuestion: boolean
  videoDuration?: number
  postingHour?: number
  dayOfWeek?: number
}): HeuristicSignal[] {
  const signals: HeuristicSignal[] = []
  const { platform, mediaType, captionLength, hasQuestion, videoDuration, postingHour } = context

  // Hook quality
  signals.push({
    rule: 'question-hooks',
    applies: hasQuestion,
    impact: 'high',
    suggestion: hasQuestion
      ? 'Questions in hooks drive 23% more comments. Good choice.'
      : 'Consider opening with a question — it drives 23% more comments.',
  })

  // Video length
  if (videoDuration != null) {
    const isShort = videoDuration < 30
    signals.push({
      rule: 'short-form-completion',
      applies: isShort,
      impact: 'high',
      suggestion: isShort
        ? 'Videos under 30s have higher completion rates — algorithm boost.'
        : 'Consider a shorter version (<30s) for better completion rate.',
    })

    if (videoDuration > 90) {
      signals.push({
        rule: 'long-form-risk',
        applies: true,
        impact: 'medium',
        suggestion: 'Videos over 90s see significant drop-off. Front-load the value.',
      })
    }
  }

  // Caption length
  if (platform === 'instagram') {
    signals.push({
      rule: 'caption-length-ig',
      applies: captionLength > 50,
      impact: 'medium',
      suggestion: captionLength < 30
        ? 'Longer captions (50-150 words) correlate with higher saves on IG.'
        : captionLength > 200
          ? 'Very long captions can reduce engagement — aim for 50-150 words.'
          : 'Good caption length for engagement.',
    })
  }

  if (platform === 'tiktok') {
    signals.push({
      rule: 'caption-length-tt',
      applies: captionLength < 50,
      impact: 'medium',
      suggestion: captionLength > 80
        ? 'TikTok captions work best under 50 words — let the video speak.'
        : 'Good caption length for TikTok.',
    })
  }

  // Aspect ratio
  if (mediaType === 'REEL' || mediaType === 'VIDEO') {
    signals.push({
      rule: 'vertical-format',
      applies: true,
      impact: 'high',
      suggestion: '9:16 vertical gets 2x reach on both IG and TikTok. Always vertical for Reels.',
    })
  }

  // Posting time
  if (postingHour != null) {
    const isPeak = (postingHour >= 7 && postingHour <= 9) || (postingHour >= 17 && postingHour <= 20)
    signals.push({
      rule: 'peak-posting-time',
      applies: isPeak,
      impact: 'medium',
      suggestion: isPeak
        ? 'Posting during peak hours (7-9 AM or 5-8 PM). Good timing.'
        : 'Consider posting during peak hours (7-9 AM or 5-8 PM local) for better reach.',
    })
  }

  // Content velocity
  signals.push({
    rule: 'consistency',
    applies: true,
    impact: 'high',
    suggestion: 'Posting 4-7x per week correlates with steady follower growth. Consistency > virality.',
  })

  return signals
}
