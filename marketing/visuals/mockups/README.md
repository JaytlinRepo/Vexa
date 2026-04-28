# Mockups — animated HTML prototypes

These are self-contained HTML files. Open in any modern browser and they auto-play / are clickable. Use them three ways:

1. **Screen-record → post as Reel/TikTok**
2. **Embed in the website / landing page** as live demos
3. **Hand off to a video editor** as a ref + asset pack

---

## What's here

| Folder | What it is | Native size | Runtime |
|---|---|---|---|
| `reel-hire/` | Self-playing brand reel — *Hire / Plan / Write / Direct / Approve / closing* | 1080×1920 | 22s loop |
| `demo-maya/` | Interactive product demo. Click "Run analysis" — the forecast + trend report animate in. | 1280×800 (responsive) | clickable |
| `reel-riley/` | *Cut by Riley* UI reveal — raw waveform → beat detection → polished segments → receipt | 1080×1920 | 14s loop |

---

## How to screen-record at native size (Mac)

The reels are sized at 1080×1920 — record at native res for clean vertical export.

### Option A — QuickTime + Chrome at exact size
1. Open the HTML in Chrome.
2. Open DevTools → device toolbar (Cmd+Shift+M) → set **Responsive** → set width 1080, height 1920, DPR 1.
3. QuickTime → File → New Screen Recording → "Selected Portion" → drag the rectangle to match the viewport exactly.
4. Refresh the page right before recording so animations restart from frame 0.
5. Stop after one full loop (22s for `reel-hire`, 14s for `reel-riley`).
6. Export. Optionally trim in iMovie / Final Cut.

### Option B — Headless capture (no manual recording)
If you want pixel-perfect mp4 output:
```bash
# install once
brew install puppeteer ffmpeg

# record reel-hire as 1080x1920 mp4 (24 seconds → covers one full loop)
npx capture-website-cli \
  file:///Users/jaytlinaskew/Documents/Personal/Vexa/marketing/visuals/mockups/reel-hire/index.html \
  --type=mp4 --width=1080 --height=1920 --duration=24 \
  --output=reel-hire.mp4
```
(or use Playwright's `page.screencast`)

### Option C — Real video files via the Sovexa codebase
The API has `videoCompilation.service.ts`, `ffmpegClipper.service.ts`, and Creatomate integration. With raw footage uploaded, those services can output an actual MP4 of the *Cut by Riley* before/after using the real pipeline. Tell the marketer agent if you want this wired up — that turns the marketing into "the product made it itself," which is a great story.

---

## How to use the Maya interactive demo

`demo-maya/index.html` is a real clickable prototype, not a video.

- **As a website hero / landing-page demo:** embed the page (or screen-record someone clicking through) and use it on sovexa.ai or a paid-ad landing page.
- **As a sales / pitch demo:** open it on a screen, hit Run, walk a viewer through what they're seeing.
- **As marketing video footage:** screen-record someone clicking through it (button hover → click → cards animate in → Approve hover) and use that footage as B-roll inside a longer Reel.

---

## Tips for production polish

- **Fonts:** these prototypes assume Cormorant Garamond, JetBrains Mono, and Inter are available. If they aren't, the browser falls back to Times / Courier / Helvetica and quality drops noticeably. For real recordings, install all three before opening the files.
- **Animation timing:** the reels are tuned for ~22s and ~14s respectively. If you need different beats for music sync, edit the `animation-delay` values in the `<style>` block — they're commented inline.
- **Color grade:** these are already in brand palette (`#fbfaf6` ivory, `#c08a3e` amber). Don't re-grade them in post — they're meant to look exactly like the product UI.
- **Music:** see the matching reel scripts under `marketing/posts/instagram/reels/` for the music references. Layer audio on top of the screen-recorded silent capture.

---

## What these prototypes prove
That you can ship Apple-tier marketing reels for Sovexa without filming a single frame. The product itself is beautiful enough to be the actor. Every UI mockup in `marketing/campaigns/` could be turned into one of these — the rate-limit is just decision-making, not capability.
