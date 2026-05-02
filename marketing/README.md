# Sovexa Marketing

Promotional content for sovexa.ai. Owned by the in-repo marketer agent.

## Operating angle
**"You're the CEO."** Every piece reinforces the workforce fantasy: the user runs a creative company; Maya, Jordan, Alex, and Riley do the work. We sell the *org chart*, not the AI.

## Quality bar
**Apple / Meta flagship-launch tier.** One idea per frame. Monumental whitespace. Type-as-hero. Cinematic restraint. See `strategy/visual-system.md` for the full set of rules and the four allowed compositions (A. The Word, B. The Number, C. The Product, D. The Editorial).

## Employee priority (lead campaigns)

| Tier | Employee | Role in marketing |
|---|---|---|
| **P0 — flagship** | **Maya** | Trend analysis as foresight. Data UI is the hero. Forecast charts, source lists, trend-report cards. |
| **P0 — flagship** | **Riley** | Video automation as direction. Show before/after. Lead with cinematic Reels and TikToks. |
| P1 — supporting | Jordan | Strategy/calendar. Used as context, not standalone. |
| P2 — brand only | Alex | Stays in multi-employee brand campaigns (e.g. Hire / Plan / Write / Direct / Approve). No dedicated Alex content. |

**Show off the UI.** Real product screens — forecast charts, shot lists, hooks cards, the meeting room — are first-class hero subjects. Do not hide the dashboard. Compose it like Apple composes an iPhone.

## Channels
- **Instagram** — Reels (Maya foresight, Riley before/after) + carousels (editorial dispatches)
- **TikTok** — short-form vertical, Riley before/after dominates
- **X / Twitter** — thought posts, brand declarations, single-line flagship cards

## Folder layout
```
marketing/
├── README.md                  ← this file
├── strategy/
│   ├── brand-voice.md
│   └── visual-system.md       ← four compositions + the Apple test
├── campaigns/                 ← coordinated big-idea systems
│   ├── 01-hire/               ← single-word brand series (5 cards)
│   ├── 02-a-company-for-one/  ← "Privacy. That's iPhone." play
│   ├── 03-shot-on-sovexa/     ← product-as-hero treatment
│   ├── 04-maya-sees/          ← P0 — Maya analysis hero
│   └── 05-cut-by-riley/       ← P0 — Riley video automation hero
├── posts/
│   ├── x/                     ← .md per post
│   ├── instagram/
│   │   ├── carousels/         ← one folder per carousel (copy + SVG mockups)
│   │   └── reels/             ← .md per reel
│   └── tiktok/                ← .md per tiktok
└── visuals/
    ├── mockups/               ← standalone SVG/HTML mockups
    └── canva-briefs/          ← reusable Canva component specs
```

## Frontmatter convention
Every post / brief carries:
```yaml
---
status: draft | review | approved | posted
platform: x | instagram | tiktok
type: post | thread | carousel | reel | tiktok | hero-campaign
campaign: 04-maya-sees       ← optional, when part of a campaign
employee: maya | jordan | alex | riley   ← optional
angle: ceo-identity | anti-chatbot | creator-pain | product-forward
quality_tier: apple-flagship             ← optional, mark our best work
priority: P0 | P1 | P2                   ← match employee priority
date_drafted: YYYY-MM-DD
---
```

## Cardinal rules
1. Sovexa is a **content team / creative company**, never "an AI tool."
2. Maya, Jordan, Alex, Riley are **people**. Use their names.
3. **One amber italic word per composition.** Never two.
4. **The Apple test:** could this card hang in an Apple Store? If no, cut something.
5. Riley video content is **show-don't-tell**: the transformation is the pitch. No voiceover.
6. Maya content leads with the **chart**, not the explanation.
7. No emojis in copy posts. Visual posts use them sparingly. Editorial first.
8. No purple/blue tech gradients. No glassmorphism. No "🚀 Excited to announce…"

## What's shipped (as of 2026-04-27)
- 5 campaigns (Hire, A Company For One, Shot on Sovexa, Maya Sees, Cut by Riley)
- 12 X posts (10 standard + 2 flagship)
- 3 IG carousels with mockups
- 6 Reel scripts (4 standard + 2 flagship cinematic)
- 5 TikTok scripts (4 standard + 1 flagship)
- 21+ SVG mockups across the campaigns
- 2 reusable Canva templates (quote card, employee card)

## Open priorities
- Niche-specific cuts of Reel 005 (fitness / food / finance / lifestyle / coaching)
- IG Story format variants of Campaign 01 single-word series
- Web hero banner using Campaign 02 *A company. For one.*
- One Jordan support card to round out Campaign 04/05 product-forward treatment
