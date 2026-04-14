/**
 * Seed Vexa's niche knowledge base.
 *
 * Run: `npm run seed:knowledge` (after adding the script to package.json)
 * or directly: `tsx scripts/seed-niche-knowledge.ts`
 *
 * Idempotent: each entry is upserted by a deterministic id derived from
 * niche+kind+slug, so re-running updates existing rows in place.
 */
import { PrismaClient, NicheKnowledgeKind } from '@prisma/client'
import crypto from 'node:crypto'

const prisma = new PrismaClient()

interface Entry {
  niche: string
  kind: NicheKnowledgeKind
  title: string
  body: string
  tags: string[]
  forRoles?: string[]    // empty = visible to all
  weight?: number
  source?: string
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80)
}

function deterministicId(e: Entry): string {
  const key = `${e.niche}::${e.kind}::${slug(e.title)}`
  return 'nk_' + crypto.createHash('sha1').update(key).digest('hex').slice(0, 24)
}

// ─────────────────────────────────────────────────────────────────────────
// FITNESS — full pack (~22 entries)
// ─────────────────────────────────────────────────────────────────────────
const FITNESS: Entry[] = [
  // PILLARS
  { niche: 'fitness', kind: 'pillar', title: 'Transformation pillar', tags: ['transformation', 'before_after', 'identity'], forRoles: ['strategist', 'copywriter'], weight: 1.4,
    body: 'Highest-saving content category in fitness. Identity-shift framing ("from tired to on-plan") outperforms vanity ("lost 30lbs"). Story arc must include a specific bottleneck the audience recognizes (energy crash, joint pain, time scarcity) before the resolution. Avoid pure aesthetic before/afters — they read as gym-bro and pull the wrong audience for most coaches.' },
  { niche: 'fitness', kind: 'pillar', title: 'Myth-busting pillar', tags: ['myth', 'authority', 'pushback'], forRoles: ['strategist', 'copywriter'], weight: 1.3,
    body: 'Outperforms tutorials by 2.3x for engagement because it triggers comment-loop. Best myths are widely-believed but easily disprovable in 30s ("more cardio = more fat loss"). Cite a study or named expert in the first 6 seconds; payoff with the corrected framework. Carousel format outperforms Reel here.' },
  { niche: 'fitness', kind: 'pillar', title: 'Behind-the-scenes pillar', tags: ['bts', 'authenticity', 'process'], forRoles: ['strategist'], weight: 1.0,
    body: 'Lowest-effort to produce, drives follower retention. Audience uses these to confirm the creator is "real." Best slot: 1 of every 5 posts. Underperforms on reach but lifts profile-visit-to-follow rate by ~12%.' },
  { niche: 'fitness', kind: 'pillar', title: 'Client-win pillar', tags: ['social_proof', 'testimonial', 'transformation'], forRoles: ['strategist', 'copywriter'], weight: 1.2,
    body: 'Critical for coaches. Required structure: name + before-state quote + the one move that mattered + result + permission line ("Sarah said it was OK to share"). Avoid percentage-loss leads — lead with the lifestyle change.' },

  // AUDIENCE
  { niche: 'fitness', kind: 'audience', title: 'Core audience: time-poor 28-44', tags: ['demographic', 'time', 'busy'], forRoles: ['analyst', 'strategist', 'copywriter'], weight: 1.3,
    body: 'Largest paying segment. They are not gym-shy — they are time-shy. Save-rate is highest on content that promises a result in <30 minutes. Peak engagement window: 5:30-7am ET (pre-work) and 8:30-10pm ET (post-kids). Sunday evening is the highest plan-buying window of the week.' },
  { niche: 'fitness', kind: 'audience', title: 'Save vs share behavior', tags: ['save', 'share', 'algorithm'], forRoles: ['analyst', 'strategist', 'copywriter'], weight: 1.2,
    body: 'Fitness audience saves 4.1x more than they share. The algorithm rewards saves heavily for this niche. Optimize for save behavior: list formats, frameworks people screenshot, calorie/macro charts, exercise sequences. Pure motivation content gets shares but no saves and dies in 48h.' },
  { niche: 'fitness', kind: 'audience', title: 'Female audience skew (most coaches)', tags: ['gender', 'demographic'], forRoles: ['analyst', 'strategist', 'copywriter'], weight: 1.0,
    body: 'Most coaching accounts skew 70-85% female. Language must avoid bro-y vocabulary ("crush it", "beast mode", "no excuses") which suppresses engagement in this segment. Replace with verbs of choice and capacity ("you get to", "your body is doing the work").' },

  // HOOK PATTERNS
  { niche: 'fitness', kind: 'hook_pattern', title: 'Swap framing', tags: ['hook', 'swap', 'comparison'], forRoles: ['copywriter'], weight: 1.4,
    body: 'Pattern: "Stop X. Start Y." or "Your X is the problem. Here is what I swapped to." Triggers comment-bait because skeptics challenge the swap. Highest comment-to-view ratio of any hook pattern in fitness (3.4x baseline). Works for any swap: cardio→strength, scale→measurements, dieting→fueling.' },
  { niche: 'fitness', kind: 'hook_pattern', title: 'Specific-time-frame hook', tags: ['hook', 'time', 'specific'], forRoles: ['copywriter'], weight: 1.3,
    body: 'Pattern: "[Specific number] minutes [specific outcome]." E.g. "The 15-minute walk that burns more than cardio." The number must be specific and small — "10 min" outperforms "a few minutes" by 2.1x. Specificity reads as expertise.' },
  { niche: 'fitness', kind: 'hook_pattern', title: 'Confession hook', tags: ['hook', 'confession', 'identity'], forRoles: ['copywriter'], weight: 1.2,
    body: 'Pattern: "I quit X for 30 days. Here is what happened." Or: "I stopped Y and lost more weight." Identity-shift confession beats prescription advice because the reader projects themselves into the role. Best when the confession is counter-intuitive (quit gym, stopped tracking).' },
  { niche: 'fitness', kind: 'hook_pattern', title: 'The thing nobody tells you', tags: ['hook', 'inside_secret'], forRoles: ['copywriter'], weight: 1.1,
    body: 'Pattern: "What [authority figures] won\'t tell you about Z." Triggers skeptic loop and authority signals. Risk: if overused it reads as conspiracy-coded. Use 1x per 8 posts max.' },

  // FORMAT SIGNALS
  { niche: 'fitness', kind: 'format_signal', title: 'Reel: hook in first 1.5s', tags: ['reel', 'hook', 'pacing'], forRoles: ['analyst', 'creative_director', 'copywriter'], weight: 1.4,
    body: 'Average watch time on a fitness Reel is 6.2s. The first 1.5s decides whether the viewer scrolls. Open with a strong visual or a specific text overlay — never "Hey everyone." Best openers: a specific number on screen ("0 burpees, all month"), a counter-intuitive scene (running shoes in the trash), or direct address with eye contact.' },
  { niche: 'fitness', kind: 'format_signal', title: 'Carousel: 7 slides, save-bait', tags: ['carousel', 'save', 'screenshot'], forRoles: ['analyst', 'creative_director', 'strategist'], weight: 1.3,
    body: 'Optimal carousel length is 7 slides. Slide 1 is the hook, slide 2 frames the problem, slides 3-6 deliver the framework (one idea per slide), slide 7 is the CTA-of-saving ("Save this for your next workout"). Anything past 8 slides gets lower swipe-through rate.' },
  { niche: 'fitness', kind: 'format_signal', title: 'Story sequences for retention', tags: ['story', 'retention', 'authenticity'], forRoles: ['strategist', 'creative_director'], weight: 0.9,
    body: 'Stories drive retention, not reach. Use them for behind-the-scenes daily-life content that confirms the creator is real. Highest-performing format: a 4-slide morning routine sequence at 6-7am, naturally driven by the time-poor audience window.' },

  // CADENCE
  { niche: 'fitness', kind: 'cadence', title: 'Cadence: 4 posts/week minimum', tags: ['cadence', 'posting', 'consistency'], forRoles: ['strategist'], weight: 1.2,
    body: 'Below 4 posts/week, the algorithm deprioritizes the account. Above 7/week, audience fatigues and engagement drops. Sweet spot: 4-5 feed posts + daily story sequences. Post slots: Mon 7am (Reel), Wed 7am (Carousel), Fri 5:30am (Reel), Sun 8pm (Reel — highest weekly window).' },
  { niche: 'fitness', kind: 'cadence', title: 'Sunday evening plan window', tags: ['cadence', 'sunday', 'planning'], forRoles: ['strategist', 'analyst'], weight: 1.1,
    body: 'Sunday 7-9pm ET is the highest-converting window of the week for plan/program sales. Audience is mentally prepping for the week. Post a CTA-driven Reel here — the lower-friction the plan, the better the conversion.' },

  // LANGUAGE
  { niche: 'fitness', kind: 'language', title: 'Avoid: bro vocabulary', tags: ['voice', 'taboo', 'language'], forRoles: ['copywriter'], weight: 1.3,
    body: 'Words to avoid in copy: "crush", "beast mode", "no excuses", "shred", "destroy", "killer". These pull the wrong audience and suppress engagement on the female-coach majority. Replace with: "complete", "consistent", "show up", "build", "earn".' },
  { niche: 'fitness', kind: 'language', title: 'Use: capacity language', tags: ['voice', 'language', 'empowerment'], forRoles: ['copywriter'], weight: 1.2,
    body: '"You get to" outperforms "you have to" by ~30% on engagement. Frame requirements as opportunities. Example: "You get to choose protein first" vs "You have to eat more protein."' },
  { niche: 'fitness', kind: 'language', title: 'Specific-number rule', tags: ['voice', 'specificity'], forRoles: ['copywriter'], weight: 1.1,
    body: 'Specific numbers always outperform ranges or vague qualifiers. "20-min walk" beats "a quick walk." "12.4% engagement" beats "high engagement." Specificity is the cheapest credibility signal.' },

  // COMPETITOR ARCHETYPES
  { niche: 'fitness', kind: 'competitor_archetype', title: 'Macro-creators (1M+)', tags: ['competitor', 'macro', 'pace'], forRoles: ['analyst', 'strategist'], weight: 1.0,
    body: 'Set the trend pace but cannot be out-distributed. Watch their content for 48h after a post — if a trend they touch is still spreading, it has 4-7 days of life left for smaller accounts. After that the lane fills with copycats and dies.' },
  { niche: 'fitness', kind: 'competitor_archetype', title: 'Mid-creators (50-300K)', tags: ['competitor', 'mid', 'wedge'], forRoles: ['analyst', 'strategist'], weight: 1.1,
    body: 'The real competitive set. They move faster than macro-creators and have similar audience. Watch their save-rates not view counts — saves are the leading indicator of which formats are about to break out for the niche overall.' },

  // TABOOS
  { niche: 'fitness', kind: 'taboo', title: 'Taboo: weight-shaming language', tags: ['taboo', 'voice'], forRoles: ['copywriter', 'strategist'], weight: 1.4,
    body: 'Never frame body composition negatively about a viewer or a hypothetical viewer. "If you have a belly..." kills trust instantly in this audience. Reframe as personal: "When I noticed mine wasn\'t shifting..."' },
  { niche: 'fitness', kind: 'taboo', title: 'Taboo: medical claims', tags: ['taboo', 'compliance'], forRoles: ['copywriter', 'strategist'], weight: 1.4,
    body: 'Avoid disease claims ("cures", "treats", "fixes hormones"). Substitute with relational verbs ("supports", "may help with"). Beyond legal exposure, the audience reads claim language as scammy.' },

  // FRAMEWORKS
  { niche: 'fitness', kind: 'framework', title: 'Hook → Tension → Reframe → Payoff', tags: ['framework', 'reel', 'script'], forRoles: ['copywriter', 'creative_director', 'strategist'], weight: 1.3,
    body: 'Standard 4-beat structure for a 25-30s fitness Reel. Hook (0-2s): the swap framing or specific number. Tension (2-8s): name the problem the viewer recognizes. Reframe (8-18s): the counter-intuitive insight. Payoff (18-28s): the specific tactical move + invitation to save. Beats 1 and 4 are the only ones the viewer reliably sees, so they must work alone.' },
]

// ─────────────────────────────────────────────────────────────────────────
// FINANCE — abbreviated pack (~12 entries)
// ─────────────────────────────────────────────────────────────────────────
const FINANCE: Entry[] = [
  { niche: 'finance', kind: 'pillar', title: 'Frameworks pillar', tags: ['framework', 'system'], forRoles: ['strategist', 'copywriter'], weight: 1.4,
    body: 'Highest-saving category. Audience consumes finance content as reference material — frameworks (3-account system, 50/30/20, FI number formula) are the bookmarks they screenshot. Frameworks > tactics for save-rate. One named framework per post is the rule.' },
  { niche: 'finance', kind: 'pillar', title: 'Myth-busting pillar', tags: ['myth', 'authority'], forRoles: ['strategist', 'copywriter'], weight: 1.3,
    body: 'Bank-myths and tax-myths are the highest-comment lane. "Your bank is designed to keep you broke" — formulaic but works. Always cite one specific institution or rule for credibility. Carousel format wins here.' },
  { niche: 'finance', kind: 'pillar', title: 'Real-numbers pillar', tags: ['transparency', 'numbers'], forRoles: ['strategist'], weight: 1.2,
    body: 'Income reports, debt-payoff timelines, real budget breakdowns. Audience values transparency over optics. Monthly cadence at most — overuse turns the account into a vanity feed.' },
  { niche: 'finance', kind: 'audience', title: 'Audience: 25-40, action-paralyzed', tags: ['demographic', 'paralysis'], forRoles: ['analyst', 'strategist', 'copywriter'], weight: 1.3,
    body: 'Most followers know they should save/invest more but freeze on the first move. Content that converts breaks paralysis: one specific account to open, one specific dollar amount to start with, one specific button to click. Vague advice ("invest more") underperforms by 5x.' },
  { niche: 'finance', kind: 'hook_pattern', title: 'Counter-bank framing', tags: ['hook', 'enemy', 'authority'], forRoles: ['copywriter'], weight: 1.3,
    body: 'Pattern: "Your [bank/institution] does not want you to know this." Or: "If you only have one checking account, you are leaking money." Triggers self-check loop. The audience\'s relationship with banks is adversarial — lean into it without becoming conspiratorial.' },
  { niche: 'finance', kind: 'hook_pattern', title: 'Specific-dollar hook', tags: ['hook', 'specific', 'numbers'], forRoles: ['copywriter'], weight: 1.2,
    body: '"I moved $40K and here is what happened." Specific dollars beat percentages 4:1 in this niche. Even if the number is small, it must be exact: "$847" outperforms "almost $1K."' },
  { niche: 'finance', kind: 'format_signal', title: 'Carousel dominates Reels for saves', tags: ['carousel', 'save'], forRoles: ['analyst', 'creative_director', 'strategist'], weight: 1.3,
    body: 'Finance audience screenshots and references. Carousel save rate is 6-8x Reel save rate in this niche. Reels for reach (intro the framework), Carousels for the framework itself.' },
  { niche: 'finance', kind: 'cadence', title: '3-4 posts/week, no daily push', tags: ['cadence'], forRoles: ['strategist'], weight: 1.0,
    body: 'Finance audience tolerates lower frequency than fitness. 3-4 dense posts/week outperforms daily light content. Each post must teach one specific thing.' },
  { niche: 'finance', kind: 'language', title: 'Avoid: hype + crypto language', tags: ['voice', 'taboo'], forRoles: ['copywriter'], weight: 1.2,
    body: 'Avoid: "to the moon", "wagmi", "10x", "secrets". This reads as crypto-coded and pulls a get-rich-quick audience that does not buy advisory products. Stick to plain banking and investing vocabulary.' },
  { niche: 'finance', kind: 'language', title: 'Use: precise tax/account terms', tags: ['voice', 'authority'], forRoles: ['copywriter'], weight: 1.1,
    body: 'Use exact account types (HYSA, Roth IRA, 401k traditional vs Roth, HSA). Audience expects fluency. Imprecision reads as amateur.' },
  { niche: 'finance', kind: 'taboo', title: 'Taboo: stock picks + alpha claims', tags: ['taboo', 'compliance'], forRoles: ['copywriter', 'strategist'], weight: 1.4,
    body: 'Never recommend specific equities. Never make alpha claims ("I beat the market"). Liability risk + audience trust risk. Structure-of-account advice is fine; security selection is not.' },
  { niche: 'finance', kind: 'framework', title: 'The 3-account system', tags: ['framework', 'banking'], forRoles: ['copywriter', 'strategist'], weight: 1.2,
    body: 'Checking (bills) → HYSA (emergency + sinking funds) → Brokerage (long-term). Pillar framework that compounds across multiple posts. Each account warrants its own carousel. Anchor everything to this when teaching beginners.' },
]

// ─────────────────────────────────────────────────────────────────────────
// FOOD — abbreviated pack (~12 entries)
// ─────────────────────────────────────────────────────────────────────────
const FOOD: Entry[] = [
  { niche: 'food', kind: 'pillar', title: 'Quick-wins pillar', tags: ['fast', 'easy', 'time'], forRoles: ['strategist', 'copywriter'], weight: 1.3,
    body: '<5-min recipes. Every food account needs this lane. Time-on-screen of the prep itself is the engagement driver — show the 5 minutes in real time, no jump cuts.' },
  { niche: 'food', kind: 'pillar', title: 'Ingredient deep-dive pillar', tags: ['ingredient', 'authority'], forRoles: ['strategist'], weight: 1.1,
    body: 'One ingredient, deeply: how to pick it, store it, use it 4 ways. Carousel format. Drives saves and follower retention. Best for niche credibility.' },
  { niche: 'food', kind: 'pillar', title: 'Kitchen stories pillar', tags: ['bts', 'authenticity'], forRoles: ['strategist'], weight: 0.9,
    body: 'BTS of the kitchen, the failures, the family meals. Underperforms on reach but lifts trust and follow-rate. 1 of every 6 posts.' },
  { niche: 'food', kind: 'audience', title: 'Audience: home cooks, not chefs', tags: ['demographic', 'skill'], forRoles: ['analyst', 'strategist', 'copywriter'], weight: 1.2,
    body: 'The buying audience is intermediate home cooks, not professional chefs. Recipes must use accessible ingredients (under $30 total) and tools (one pan, one bowl). "Restaurant technique at home" outperforms "chef-grade" framing.' },
  { niche: 'food', kind: 'hook_pattern', title: 'Swap-the-ingredient hook', tags: ['hook', 'swap'], forRoles: ['copywriter'], weight: 1.3,
    body: '"I replaced X with Y for 30 days and..." Identity-style. Pairs with macro-shift content (cottage cheese for ice cream, etc.). High save + share crossover.' },
  { niche: 'food', kind: 'hook_pattern', title: 'The label hook', tags: ['hook', 'label', 'compliance'], forRoles: ['copywriter'], weight: 1.1,
    body: '"Three things on this label that should make you put it back." Drives carousel-style saves. Audience screenshots for grocery shopping.' },
  { niche: 'food', kind: 'format_signal', title: 'Reels: ASMR-first, voiceover later', tags: ['reel', 'asmr', 'sound'], forRoles: ['analyst', 'creative_director'], weight: 1.4,
    body: 'Top-performing food Reels keep the first 2-3 seconds silent ASMR (knife on board, oil on pan). Voiceover starts at 3s. Music must match the trend audio for the format type — recipe Reels use trending audio, ingredient deep-dives use lo-fi.' },
  { niche: 'food', kind: 'format_signal', title: 'Top-down vs eye-level', tags: ['camera', 'angle'], forRoles: ['creative_director'], weight: 1.0,
    body: 'Top-down for prep clarity. Eye-level for the bite reaction shot. Most food Reels need both: top-down for the build, cut to eye-level for the payoff at second 18-22.' },
  { niche: 'food', kind: 'cadence', title: '5 posts/week minimum', tags: ['cadence'], forRoles: ['strategist'], weight: 1.1,
    body: 'Food audience consumes daily. 5+ feed posts/week keeps the algorithm warm. Recipe Reels Mon/Wed/Fri, ingredient deep-dive carousel Tue, BTS or quick win Sat.' },
  { niche: 'food', kind: 'language', title: 'Use: sensory verbs', tags: ['voice', 'sensory'], forRoles: ['copywriter'], weight: 1.0,
    body: 'Crackle, sizzle, fold, char, melt. Sensory verbs outperform generic ("cook", "make") for engagement. Captions read like the dish smells.' },
  { niche: 'food', kind: 'taboo', title: 'Taboo: unspecified macros', tags: ['taboo'], forRoles: ['copywriter'], weight: 1.0,
    body: 'If you mention "high-protein" or "low-carb" you must show the actual macro count on screen. Audience saves for reference and will downrate fluffy claims.' },
  { niche: 'food', kind: 'framework', title: 'Build → Reveal → Bite', tags: ['framework', 'reel'], forRoles: ['creative_director', 'copywriter'], weight: 1.2,
    body: '22-25s Reel structure. Build (0-12s): top-down ASMR-prep. Reveal (12-18s): cut to plated dish, garnish moment. Bite (18-22s): eye-level reaction shot. Music drops at the build-to-reveal cut.' },
]

// ─────────────────────────────────────────────────────────────────────────
// COACHING — abbreviated pack (~12 entries)
// ─────────────────────────────────────────────────────────────────────────
const COACHING: Entry[] = [
  { niche: 'coaching', kind: 'pillar', title: 'Frameworks pillar', tags: ['framework', 'system', 'authority'], forRoles: ['strategist', 'copywriter'], weight: 1.4,
    body: 'Coaching audience buys frameworks. Every pillar post should have a named framework with a number ("the 4-step reset"). Frameworks become the IP buyers attribute to the coach.' },
  { niche: 'coaching', kind: 'pillar', title: 'Transformation-proof pillar', tags: ['client', 'social_proof'], forRoles: ['strategist', 'copywriter'], weight: 1.3,
    body: 'Client wins with NAMES (with permission), specifics, before/after framing in lifestyle terms not numbers. "Sarah went from working through dinner to logging off at 5:30" beats "client lost 30 lbs."' },
  { niche: 'coaching', kind: 'pillar', title: 'Hot-takes pillar', tags: ['contrarian', 'authority'], forRoles: ['strategist', 'copywriter'], weight: 1.2,
    body: 'Push-back on industry conventional wisdom. "Goals are vanity. Habits ship." Risk: too contrarian reads as edgy-for-clicks. One hot take per 6 posts.' },
  { niche: 'coaching', kind: 'audience', title: 'Audience: high-agency, evidence-seeking', tags: ['demographic', 'buyer'], forRoles: ['analyst', 'strategist', 'copywriter'], weight: 1.2,
    body: 'Coaching buyers are decision-makers. They want evidence (case studies, frameworks) before they trust. Vague motivation content underperforms vs. specific structural advice. Weekly newsletter pulls them harder than IG alone.' },
  { niche: 'coaching', kind: 'hook_pattern', title: 'Counter-conventional hook', tags: ['hook', 'pushback'], forRoles: ['copywriter'], weight: 1.3,
    body: '"You do not have a [X] problem. You have a [Y] problem." Reframes the buyer\'s self-diagnosis. Audience pauses to evaluate. High save rate when the reframe is true.' },
  { niche: 'coaching', kind: 'hook_pattern', title: 'Process-confession hook', tags: ['hook', 'inside'], forRoles: ['copywriter'], weight: 1.1,
    body: '"The 4-step reset I walk every client through in session one." Insider-access framing. Buyers project themselves into the room.' },
  { niche: 'coaching', kind: 'format_signal', title: 'Carousels for cornerstone, Reels for reach', tags: ['format', 'carousel', 'reel'], forRoles: ['analyst', 'creative_director', 'strategist'], weight: 1.3,
    body: 'Pinned cornerstone carousel (the named framework) does evergreen distribution for months. Reels seed new followers into the carousel. Pair them: a Reel that introduces the hot take, then route comments to the carousel that breaks down the framework.' },
  { niche: 'coaching', kind: 'cadence', title: '3-4 posts + weekly newsletter', tags: ['cadence', 'newsletter'], forRoles: ['strategist'], weight: 1.1,
    body: 'IG cadence is medium (3-4/week). The compounding asset is the newsletter — every coaching account at 25K+ followers should have one. Newsletter converts to paid 4-6x better than IG for coaching products.' },
  { niche: 'coaching', kind: 'language', title: 'Use: specific verbs of decision', tags: ['voice'], forRoles: ['copywriter'], weight: 1.0,
    body: 'Decide, choose, commit, walk away, set down. Verbs that signal agency. Avoid: "manifest", "energy", "vibration" (unless the niche is explicitly mindset/spiritual coaching).' },
  { niche: 'coaching', kind: 'taboo', title: 'Taboo: trauma claims', tags: ['taboo', 'compliance'], forRoles: ['copywriter', 'strategist'], weight: 1.3,
    body: 'Avoid: "trauma response", "nervous-system regulation", or therapeutic claims unless credentialed. Liability + audience-trust risk. Use language of habits and decisions instead.' },
  { niche: 'coaching', kind: 'framework', title: 'The 4-step reset', tags: ['framework'], forRoles: ['copywriter', 'strategist'], weight: 1.2,
    body: 'Default coaching framework: 1) Audit current week (no judgment), 2) Pick the single highest-leverage stop, 3) Replace it with one new behavior, 4) Schedule the review (7 days). Use this as the named-framework anchor for cornerstone content.' },
  { niche: 'coaching', kind: 'competitor_archetype', title: 'Macro-coaches (300K+)', tags: ['competitor'], forRoles: ['analyst', 'strategist'], weight: 1.0,
    body: 'Macro-coaches own the broad-category lanes (productivity, mindset, leadership). Carve out a verticalized niche underneath them (productivity for engineers, leadership for first-time managers). Specificity is the only path to differentiated reach at sub-100K size.' },
]

// ─────────────────────────────────────────────────────────────────────────
// LIFESTYLE — abbreviated pack (~10 entries)
// ─────────────────────────────────────────────────────────────────────────
const LIFESTYLE: Entry[] = [
  { niche: 'lifestyle', kind: 'pillar', title: 'Aesthetic pillar', tags: ['aesthetic', 'visual'], forRoles: ['strategist', 'creative_director'], weight: 1.3,
    body: 'Lifestyle content lives or dies on cohesive aesthetic. One palette, one framing, one editing treatment across all feed posts. Audience follows for visual reliability.' },
  { niche: 'lifestyle', kind: 'pillar', title: 'Routine pillar', tags: ['routine', 'identity'], forRoles: ['strategist', 'copywriter'], weight: 1.2,
    body: 'Morning routine, evening routine, Sunday reset. Highest follower-retention category in lifestyle. Identity-projection content — viewers want to imagine themselves in the routine.' },
  { niche: 'lifestyle', kind: 'pillar', title: 'Product-discovery pillar', tags: ['product', 'recommendation'], forRoles: ['strategist'], weight: 1.0,
    body: 'Curated product picks (3-5 per post). Drives affiliate revenue. Audience trusts recommendations more from a curator than from sponsored slots — earn trust before monetizing.' },
  { niche: 'lifestyle', kind: 'audience', title: 'Audience: identity-projecting', tags: ['demographic', 'identity'], forRoles: ['analyst', 'strategist', 'copywriter'], weight: 1.2,
    body: 'Lifestyle viewers consume to project themselves into a future identity. Content must let them see "this could be me." Avoid aspirational gating language ("once you can afford...") that breaks the projection.' },
  { niche: 'lifestyle', kind: 'hook_pattern', title: 'Day-in-the-life hook', tags: ['hook', 'routine'], forRoles: ['copywriter'], weight: 1.2,
    body: '"5am to midnight as a [identity]." Time-stamped narrative. Drives high watch-time. Works at any audience size.' },
  { niche: 'lifestyle', kind: 'hook_pattern', title: 'Pivot/transformation hook', tags: ['hook', 'transformation'], forRoles: ['copywriter'], weight: 1.1,
    body: '"6 months ago I... now I..." Identity-shift framing. Best when the pivot is concrete (career, location, relationship, health).' },
  { niche: 'lifestyle', kind: 'format_signal', title: 'Reels for reach, photos for retention', tags: ['format'], forRoles: ['analyst', 'creative_director'], weight: 1.1,
    body: 'Reels pull new followers; aesthetic feed photos hold them. The feed grid is the brand. Stagger so no two adjacent feed posts share a dominant color.' },
  { niche: 'lifestyle', kind: 'cadence', title: '4-5 posts/week + daily stories', tags: ['cadence'], forRoles: ['strategist'], weight: 1.0,
    body: 'Daily stories are non-negotiable for lifestyle — they are how audience parasocial trust is built. Feed posts can be 4-5/week.' },
  { niche: 'lifestyle', kind: 'language', title: 'Use: sensory and seasonal language', tags: ['voice'], forRoles: ['copywriter'], weight: 1.0,
    body: 'Lean into the season ("autumn-light mornings"), the sensory ("cinnamon and pine"), the time-of-day ("late-evening kitchen"). Concrete sensory anchoring outperforms abstract aspirational copy.' },
  { niche: 'lifestyle', kind: 'taboo', title: 'Taboo: pure aspirationalism', tags: ['taboo', 'voice'], forRoles: ['copywriter', 'strategist'], weight: 1.1,
    body: 'Pure aspiration without any grounded specifics reads as inauthentic and pulls follower drop-off. Anchor every aspirational frame with one concrete detail (a specific object, a specific place, a specific time).' },
]

// ─────────────────────────────────────────────────────────────────────────
// DEFAULT — fallback used when niche does not match anything
// ─────────────────────────────────────────────────────────────────────────
const DEFAULT: Entry[] = [
  { niche: 'default', kind: 'pillar', title: 'Signature-story pillar', tags: ['identity', 'origin'], forRoles: ['strategist', 'copywriter'], weight: 1.0,
    body: 'Every account needs a signature-story pillar — the origin moment that explains why this creator. Anchor the brand in a single recurring story arc, not a list of credentials.' },
  { niche: 'default', kind: 'pillar', title: 'Myth-busting pillar', tags: ['myth'], forRoles: ['strategist', 'copywriter'], weight: 1.0,
    body: 'Universally effective across niches. Find the most common belief in your niche, name it, dismantle it with one piece of evidence, replace it with the right framework.' },
  { niche: 'default', kind: 'audience', title: 'Audience: presumed unknown', tags: ['default'], forRoles: ['analyst', 'strategist', 'copywriter'], weight: 1.0,
    body: 'Without niche-specific audience data, default to: assume a busy, action-paralyzed adult who has saved at least one of your posts but has not bought anything yet. Optimize for the next save, not the next sale.' },
  { niche: 'default', kind: 'hook_pattern', title: 'The thing nobody talks about hook', tags: ['hook'], forRoles: ['copywriter'], weight: 1.0,
    body: '"Here is the thing nobody in [niche] talks about." Universal pattern. Works across niches because it triggers insider-access loop.' },
  { niche: 'default', kind: 'cadence', title: 'Default cadence: 3-4 posts/week', tags: ['cadence'], forRoles: ['strategist'], weight: 1.0,
    body: 'Without niche-specific cadence data, 3-4 substantive posts/week is the safe baseline that keeps the algorithm warm without burning the creator out.' },
  { niche: 'default', kind: 'taboo', title: 'Taboo: absolute claims', tags: ['taboo'], forRoles: ['copywriter', 'strategist'], weight: 1.0,
    body: 'Avoid absolute language ("never", "always", "guaranteed") on advice-style content. Even when correct, it reads as untrustworthy.' },
]

const ALL: Entry[] = [...FITNESS, ...FINANCE, ...FOOD, ...COACHING, ...LIFESTYLE, ...DEFAULT]

async function main() {
  console.log(`[seed-niche] upserting ${ALL.length} entries across ${new Set(ALL.map((e) => e.niche)).size} niches…`)
  let written = 0
  for (const e of ALL) {
    const id = deterministicId(e)
    await prisma.nicheKnowledge.upsert({
      where: { id },
      create: {
        id,
        niche: e.niche,
        kind: e.kind,
        title: e.title,
        body: e.body,
        tags: e.tags,
        forRoles: e.forRoles ?? [],
        weight: e.weight ?? 1.0,
        source: e.source ?? null,
      },
      update: {
        kind: e.kind,
        title: e.title,
        body: e.body,
        tags: e.tags,
        forRoles: e.forRoles ?? [],
        weight: e.weight ?? 1.0,
        source: e.source ?? null,
      },
    })
    written++
  }
  console.log(`[seed-niche] done — ${written} entries upserted`)
  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
