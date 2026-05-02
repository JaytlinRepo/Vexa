// tour-engine.jsx — the onboarding tour logic + 3 visual variants

const TOUR_STEPS = [
  {
    id: 'welcome',
    target: null,
    page: 'drafts',
    eyebrow: 'Welcome',
    title: 'Your ideas,\nalways in focus.',
    body: 'Vexa is a quiet workspace that gets out of your way. Let\'s take sixty seconds.',
    cta: 'Begin the tour',
  },
  {
    id: 'new',
    target: 'nav-new',
    page: 'drafts',
    eyebrow: 'Step 1 of 6',
    title: 'Start anywhere.',
    body: 'One command creates a new document, brief, or canvas. Drafts save continuously.',
    cta: 'Next',
  },
  {
    id: 'search',
    target: 'search-bar',
    page: 'drafts',
    eyebrow: 'Step 2 of 6',
    title: 'Find anything\nin a keystroke.',
    body: 'Press ⌘K from anywhere. Jump to docs, people, or paste a URL to pull it in.',
    cta: 'Next',
  },
  {
    id: 'ai',
    target: 'ai-assist',
    page: 'drafts',
    eyebrow: 'Step 3 of 6',
    title: 'A thinking partner.',
    body: 'Ask Vexa to rewrite, summarize, or challenge your draft. It reads only what you share.',
    cta: 'Next',
  },
  {
    id: 'library',
    target: 'docs-grid',
    page: 'docs',
    eyebrow: 'Step 4 of 6',
    title: 'The whole\nlibrary, visible.',
    body: 'Every document, memo, and loop lives here. Color-coded by space, sortable by anything.',
    cta: 'Next',
  },
  {
    id: 'share-link',
    target: 'share-panel',
    page: 'share',
    eyebrow: 'Step 5 of 6',
    title: 'Bring the room.',
    body: 'Share with a link. Live cursors, comments, and presence — without the meeting.',
    cta: 'Next',
  },
  {
    id: 'collab',
    target: 'collab-avatars',
    page: 'share',
    eyebrow: 'Step 6 of 6',
    title: 'Who\'s in the room.',
    body: 'See teammates on the page with you, exactly where they are. A quiet kind of presence.',
    cta: 'Enter Vexa',
  },
];

// Measure a target element inside the browser window, return relative rect
function useTargetRect(stageRef, targetId) {
  const [rect, setRect] = React.useState(null);
  React.useEffect(() => {
    if (!stageRef.current || !targetId) { setRect(null); return; }
    const stage = stageRef.current;
    const el = stage.querySelector(`[data-tour-target="${targetId}"]`);
    if (!el) { setRect(null); return; }
    const measure = () => {
      const sB = stage.getBoundingClientRect();
      const eB = el.getBoundingClientRect();
      setRect({
        x: eB.left - sB.left,
        y: eB.top - sB.top,
        w: eB.width,
        h: eB.height,
        cx: eB.left - sB.left + eB.width / 2,
        cy: eB.top - sB.top + eB.height / 2,
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [targetId]);
  return rect;
}

/* ───────────────────── VARIANT 1: SPOTLIGHT CINEMA (DRAMATIC) ───────────────────── */
function SpotlightCinema({ stageRef, step, stepIndex, onNext, accent, speed }) {
  const rect = useTargetRect(stageRef, step.target);
  const pad = 14;
  const isCenter = !step.target || !rect;
  const stageW = stageRef.current?.clientWidth || 1200;
  const stageH = stageRef.current?.clientHeight || 760;

  // "flash" state — triggered on step change for iris-wipe drama
  const [flash, setFlash] = React.useState(0);
  React.useEffect(() => { setFlash(f => f + 1); }, [stepIndex]);

  // Slow ken-burns zoom toward target
  const kb = isCenter
    ? { scale: 1.02, ox: 50, oy: 50 }
    : { scale: 1.06, ox: (rect.cx / stageW) * 100, oy: (rect.cy / stageH) * 100 };

  // Spotlight position
  const sp = isCenter
    ? { x: stageW*0.15, y: stageH*0.18, w: stageW*0.70, h: stageH*0.64, r: 16 }
    : { x: rect.x - pad, y: rect.y - pad, w: rect.w + pad*2, h: rect.h + pad*2, r: Math.min(16, (rect.h + pad*2)/2) };

  // Tooltip placement
  const tooltipW = 380;
  let tip = { left: stageW/2 - tooltipW/2, top: stageH/2 - 140, center: true };
  if (!isCenter) {
    const spaceRight = stageW - (rect.x + rect.w);
    const spaceBelow = stageH - (rect.y + rect.h);
    if (spaceRight > tooltipW + 40) {
      tip = { left: rect.x + rect.w + 32, top: Math.max(20, Math.min(stageH - 280, rect.cy - 140)), center: false };
    } else if (spaceBelow > 260) {
      tip = { left: Math.max(20, Math.min(stageW - tooltipW - 20, rect.cx - tooltipW/2)), top: rect.y + rect.h + 32, center: false };
    } else {
      tip = { left: Math.max(20, rect.x - tooltipW - 32), top: Math.max(20, Math.min(stageH - 280, rect.cy - 140)), center: false };
    }
  }

  const ease = `${720/speed}ms cubic-bezier(0.83, 0, 0.17, 1)`;
  const easeSlow = `${1200/speed}ms cubic-bezier(0.22, 1, 0.36, 1)`;

  // Split title into characters for staggered reveal
  const titleChars = step.title.split('');

  return (
    <div style={{
      position: 'absolute', inset: 0, pointerEvents: 'auto',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      {/* Ken-burns zoom layer — pushes the product behind the vignette */}
      <div
        key={`kb-${stepIndex}`}
        style={{
          position: 'absolute', inset: 0,
          transformOrigin: `${kb.ox}% ${kb.oy}%`,
          transform: `scale(${kb.scale})`,
          transition: `transform ${4200/speed}ms cubic-bezier(0.22, 1, 0.36, 1)`,
          pointerEvents: 'none',
          animation: `tour-kb-in ${900/speed}ms cubic-bezier(0.22, 1, 0.36, 1)`,
          willChange: 'transform',
          // This layer is visual-only; product is behind it in DOM so zoom is applied via sibling bg
        }}
      />

      {/* IRIS WIPE — expands from target on each step change */}
      <div
        key={`iris-${flash}`}
        style={{
          position: 'absolute',
          left: (isCenter ? stageW/2 : rect.cx) - 40,
          top: (isCenter ? stageH/2 : rect.cy) - 40,
          width: 80, height: 80, borderRadius: '50%',
          border: `2px solid ${accent}`,
          pointerEvents: 'none',
          animation: `tour-iris ${900/speed}ms cubic-bezier(0.16, 1, 0.3, 1) forwards`,
          zIndex: 4,
        }}
      />

      {/* Mask with punched-out spotlight (heavier vignette) */}
      <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <mask id="spot-mask">
            <rect width="100%" height="100%" fill="white"/>
            <rect
              x={sp.x} y={sp.y} width={sp.w} height={sp.h} rx={sp.r}
              fill="black"
              style={{ transition: `all ${ease}` }}
            />
          </mask>
          <radialGradient id="vignette-drama" cx="50%" cy="50%" r="75%">
            <stop offset="30%" stopColor="rgba(6,6,12,0.72)"/>
            <stop offset="70%" stopColor="rgba(4,4,10,0.88)"/>
            <stop offset="100%" stopColor="rgba(0,0,4,0.96)"/>
          </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#vignette-drama)" mask="url(#spot-mask)"/>
      </svg>

      {/* Film grain / scanline layer */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: `repeating-linear-gradient(0deg, rgba(255,255,255,0.02) 0 1px, transparent 1px 3px)`,
        mixBlendMode: 'overlay', opacity: 0.5,
      }}/>

      {/* Top + bottom letterbox wipes */}
      <div
        key={`lb-t-${stepIndex}`}
        style={{
          position: 'absolute', left: 0, right: 0, top: 0,
          height: isCenter ? 0 : 28,
          background: 'rgba(0,0,0,0.85)',
          transition: `height ${easeSlow}`,
          pointerEvents: 'none',
          animation: `tour-letter-t ${900/speed}ms cubic-bezier(0.16, 1, 0.3, 1)`,
          borderBottom: `1px solid ${accent}33`,
        }}/>
      <div
        key={`lb-b-${stepIndex}`}
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          height: isCenter ? 0 : 28,
          background: 'rgba(0,0,0,0.85)',
          transition: `height ${easeSlow}`,
          pointerEvents: 'none',
          animation: `tour-letter-b ${900/speed}ms cubic-bezier(0.16, 1, 0.3, 1)`,
          borderTop: `1px solid ${accent}33`,
        }}/>

      {/* Top slate — timecode + step */}
      {!isCenter && (
        <div style={{
          position: 'absolute', left: 20, right: 20, top: 6,
          display: 'flex', alignItems: 'center', gap: 14,
          fontSize: 10, fontFamily: 'ui-monospace, monospace',
          color: 'rgba(255,255,255,0.7)', letterSpacing: '0.2em',
          textTransform: 'uppercase', pointerEvents: 'none',
          zIndex: 5,
          animation: `tour-fade-in ${720/speed}ms ease-out`,
        }}>
          <span style={{ color: accent }}>●</span>
          <span>VEXA · REEL 01 · CUE {String(stepIndex).padStart(2,'0')}</span>
          <span style={{ flex: 1, height: 1, background: `linear-gradient(90deg, ${accent}55, transparent)` }}/>
          <span>T+{String(stepIndex * 12).padStart(2,'0')}:{String((stepIndex+1)*7 % 60).padStart(2,'0')}</span>
        </div>
      )}

      {/* Corner crop marks */}
      {!isCenter && [
        { l: 10, t: 10, cls: 'tl' },
        { r: 10, t: 10, cls: 'tr' },
        { l: 10, b: 10, cls: 'bl' },
        { r: 10, b: 10, cls: 'br' },
      ].map((c, i) => (
        <svg key={i} width="14" height="14" style={{
          position: 'absolute',
          left: c.l, right: c.r, top: c.t, bottom: c.b,
          color: accent, opacity: 0.8,
          animation: `tour-fade-in ${800/speed}ms ease-out`,
          pointerEvents: 'none', zIndex: 5,
        }}>
          <path d={
            c.cls === 'tl' ? 'M0 6V0H6' :
            c.cls === 'tr' ? 'M14 6V0H8' :
            c.cls === 'bl' ? 'M0 8V14H6' :
                             'M14 8V14H8'
          } stroke="currentColor" strokeWidth="1.5" fill="none"/>
        </svg>
      ))}

      {/* Glowing ring around spotlight */}
      {!isCenter && (
        <div style={{
          position: 'absolute',
          left: sp.x - 2, top: sp.y - 2, width: sp.w + 4, height: sp.h + 4,
          borderRadius: sp.r + 2,
          boxShadow: `0 0 0 1.5px ${accent}, 0 0 60px ${accent}99, 0 0 120px ${accent}55, inset 0 0 0 1px rgba(255,255,255,0.4)`,
          transition: `all ${ease}`,
          pointerEvents: 'none',
          animation: `tour-ring-pulse ${2200/speed}ms ease-in-out infinite`,
        }}/>
      )}

      {/* Target reticle — floating brackets */}
      {!isCenter && [
        [0, 0, 'tl'], [1, 0, 'tr'], [0, 1, 'bl'], [1, 1, 'br']
      ].map(([x, y, id]) => (
        <div key={id} style={{
          position: 'absolute',
          left: x ? rect.x + rect.w + 8 : rect.x - 16,
          top:  y ? rect.y + rect.h + 8 : rect.y - 16,
          width: 8, height: 8,
          borderTop:    !y ? `2px solid ${accent}` : 'none',
          borderBottom:  y ? `2px solid ${accent}` : 'none',
          borderLeft:   !x ? `2px solid ${accent}` : 'none',
          borderRight:   x ? `2px solid ${accent}` : 'none',
          transition: `all ${ease}`,
          pointerEvents: 'none',
          animation: `tour-fade-in ${900/speed}ms ease-out`,
        }}/>
      ))}

      {/* Tooltip card — DRAMATIC */}
      <div
        key={stepIndex}
        style={{
          position: 'absolute', left: tip.left, top: tip.top,
          width: tooltipW,
          transition: `left ${ease}, top ${ease}`,
          animation: `tour-dramatic-in ${900/speed}ms cubic-bezier(0.16, 1, 0.3, 1)`,
          zIndex: 6,
        }}>
        {/* connecting line from target to card */}
        {!isCenter && (
          <svg style={{
            position: 'absolute',
            left: -40, top: tooltipW > 0 ? 60 : 0,
            width: 40, height: 2, overflow: 'visible',
            pointerEvents: 'none',
          }}>
            <line x1="0" y1="1" x2="40" y2="1" stroke={accent} strokeWidth="1" strokeDasharray="2 3">
              <animate attributeName="stroke-dashoffset" from="5" to="0" dur={`${1200/speed}ms`} repeatCount="indefinite"/>
            </line>
          </svg>
        )}

        <div style={{
          background: 'linear-gradient(180deg, oklch(0.2 0.012 280) 0%, oklch(0.14 0.012 280) 100%)',
          color: 'oklch(0.96 0.005 90)',
          borderRadius: 2, padding: '28px 28px 22px',
          boxShadow: `
            0 40px 120px rgba(0,0,0,0.7),
            0 0 0 1px rgba(255,255,255,0.08),
            0 0 80px ${accent}22
          `,
          position: 'relative', overflow: 'hidden',
        }}>
          {/* accent bar — bigger, glowing */}
          <div style={{
            position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
            background: accent,
            boxShadow: `0 0 20px ${accent}, 0 0 40px ${accent}66`,
          }}/>
          {/* top-right glint */}
          <div style={{
            position: 'absolute', right: -60, top: -60,
            width: 140, height: 140, borderRadius: '50%',
            background: `radial-gradient(circle, ${accent}33 0%, transparent 70%)`,
            pointerEvents: 'none',
          }}/>

          {/* Eyebrow with decorative marks */}
          <div style={{
            fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.22em',
            color: accent, marginBottom: 18, fontWeight: 500,
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{
              width: 24, height: 1, background: accent,
              boxShadow: `0 0 8px ${accent}`,
            }}/>
            {step.eyebrow}
          </div>

          {/* Title — character-by-character reveal, dramatic serif */}
          <div style={{
            fontFamily: '"Instrument Serif", Georgia, serif',
            fontSize: 40, lineHeight: 1.02, fontWeight: 400,
            marginBottom: 16, letterSpacing: '-0.018em',
            whiteSpace: 'pre-line',
          }}>
            {titleChars.map((ch, i) => (
              <span key={`${stepIndex}-${i}`} style={{
                display: 'inline-block',
                whiteSpace: ch === ' ' ? 'pre' : 'normal',
                animation: `tour-char-in ${700/speed}ms cubic-bezier(0.16, 1, 0.3, 1) both`,
                animationDelay: `${i * 22/speed}ms`,
              }}>{ch === '\n' ? <br/> : ch}</span>
            ))}
          </div>

          <div style={{
            fontSize: 14, lineHeight: 1.6, opacity: 0.72, marginBottom: 24,
            animation: `tour-fade-up ${900/speed}ms ${400/speed}ms cubic-bezier(0.16, 1, 0.3, 1) both`,
            maxWidth: 340,
          }}>{step.body}</div>

          {/* progress + button row */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 14,
            animation: `tour-fade-up ${900/speed}ms ${500/speed}ms cubic-bezier(0.16, 1, 0.3, 1) both`,
          }}>
            <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              {TOUR_STEPS.map((_, i) => (
                <div key={i} style={{
                  width: i === stepIndex ? 28 : 6, height: 2,
                  background: i <= stepIndex ? accent : 'rgba(255,255,255,0.15)',
                  boxShadow: i === stepIndex ? `0 0 10px ${accent}` : 'none',
                  transition: `all ${ease}`,
                }}/>
              ))}
            </div>
            <button onClick={onNext} style={{
              marginLeft: 'auto', background: accent, color: 'oklch(0.14 0.012 280)',
              border: 'none', padding: '11px 18px', borderRadius: 2,
              fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
              cursor: 'pointer', letterSpacing: '0.14em', textTransform: 'uppercase',
              boxShadow: `0 0 30px ${accent}88`,
              display: 'inline-flex', alignItems: 'center', gap: 10,
            }}>
              {step.cta}
              <span style={{ fontFamily: 'ui-monospace, monospace' }}>▸</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────── VARIANT 2: RAIL NARRATOR ─────────────────────
   Split into two exports:
   - RailNarratorRail: the sidebar panel (rendered OUTSIDE the product stage)
   - RailNarrator: the in-stage overlay (crosshair + ring + dim)
   The App composes them side-by-side so the rail never covers the product.
*/
function RailNarratorRail({ step, stepIndex, onNext, accent, speed }) {
  const ease = `${640/speed}ms cubic-bezier(0.65, 0, 0.2, 1)`;
  return (
    <div style={{
      width: 320, height: '100%', flexShrink: 0,
      fontFamily: 'Inter, system-ui, sans-serif',
      display: 'flex',
    }}>
      <div style={{
        width: '100%', height: '100%',
        background: 'oklch(0.16 0.012 280)',
        color: 'oklch(0.96 0.005 90)',
        padding: '36px 30px',
        display: 'flex', flexDirection: 'column',
        borderRight: `1px solid rgba(255,255,255,0.06)`,
        boxShadow: '6px 0 40px rgba(0,0,0,0.4)',
        position: 'relative', zIndex: 2,
      }}>
        {/* brand */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          fontSize: 12, color: 'rgba(255,255,255,0.5)',
          letterSpacing: '0.08em', textTransform: 'uppercase',
          marginBottom: 'auto',
        }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%', background: accent,
            animation: `tour-blink ${1800/speed}ms ease-in-out infinite`,
          }}/>
          Live walkthrough
        </div>

        {/* current step */}
        <div key={stepIndex} style={{
          animation: `tour-rail-in ${720/speed}ms cubic-bezier(0.16, 1, 0.3, 1)`,
        }}>
          <div style={{
            fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase',
            color: accent, marginBottom: 14, fontWeight: 500,
          }}>{step.eyebrow}</div>
          <div style={{
            fontFamily: '"Instrument Serif", Georgia, serif',
            fontSize: 40, lineHeight: 1.02, letterSpacing: '-0.015em',
            marginBottom: 16, whiteSpace: 'pre-line',
          }}>{step.title}</div>
          <div style={{ fontSize: 14, lineHeight: 1.6, opacity: 0.7, marginBottom: 28 }}>
            {step.body}
          </div>
          <button onClick={onNext} style={{
            height: 40, padding: '0 18px', borderRadius: 20,
            background: accent, color: 'oklch(0.18 0.012 280)',
            border: 'none', fontSize: 13, fontWeight: 600,
            fontFamily: 'inherit', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 8,
          }}>
            {step.cta}
            <svg width="14" height="10" viewBox="0 0 14 10">
              <path d="M1 5H13M13 5L9 1M13 5L9 9" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* counter */}
        <div style={{
          marginTop: 'auto', paddingTop: 40,
          display: 'flex', alignItems: 'center', gap: 14,
          fontSize: 11, color: 'rgba(255,255,255,0.4)',
          letterSpacing: '0.04em',
        }}>
          <div style={{
            fontFamily: '"Instrument Serif", serif', fontSize: 44, fontStyle: 'italic',
            color: 'rgba(255,255,255,0.9)', lineHeight: 1,
          }}>
            {String(stepIndex+1).padStart(2, '0')}
          </div>
          <div style={{
            flex: 1, height: 1, background: 'rgba(255,255,255,0.15)',
            position: 'relative',
          }}>
            <div style={{
              position: 'absolute', left: 0, top: 0, bottom: 0,
              width: `${((stepIndex+1)/TOUR_STEPS.length)*100}%`, background: accent,
              transition: `width ${ease}`,
            }}/>
          </div>
          <div>{String(TOUR_STEPS.length).padStart(2, '0')}</div>
        </div>
      </div>
    </div>
  );
}

/* RailNarrator: in-stage overlay only (crosshair + ring) */
function RailNarrator({ stageRef, step, stepIndex, onNext, accent, speed }) {
  const rect = useTargetRect(stageRef, step.target);
  const isCenter = !step.target || !rect;
  const ease = `${640/speed}ms cubic-bezier(0.65, 0, 0.2, 1)`;

  const stageW = stageRef.current?.clientWidth || 1200;
  const stageH = stageRef.current?.clientHeight || 760;
  const cx = isCenter ? stageW/2 : rect.cx;
  const cy = isCenter ? stageH/2 : rect.cy;

  return (
    <div style={{
      position: 'absolute', inset: 0, pointerEvents: 'none',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      {/* Right side — crosshair + label over dimmed product */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
        {/* dim overlay */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'rgba(12, 10, 20, 0.22)',
          pointerEvents: 'none',
          transition: `opacity ${ease}`,
        }}/>

        {/* crosshair */}
        {!isCenter && (
          <>
            {/* horizontal line */}
            <div style={{
              position: 'absolute', left: 0, right: 0, top: cy,
              height: 1, background: `linear-gradient(90deg, transparent, ${accent}aa 40%, ${accent} 50%, ${accent}aa 60%, transparent)`,
              transition: `all ${ease}`,
            }}/>
            {/* vertical line */}
            <div style={{
              position: 'absolute', top: 0, bottom: 0, left: cx,
              width: 1, background: `linear-gradient(180deg, transparent, ${accent}aa 40%, ${accent} 50%, ${accent}aa 60%, transparent)`,
              transition: `all ${ease}`,
            }}/>

            {/* target ring */}
            <div style={{
              position: 'absolute',
              left: rect.x - 6, top: rect.y - 6,
              width: rect.w + 12, height: rect.h + 12,
              borderRadius: Math.min(12, (rect.h+12)/2),
              border: `1.5px solid ${accent}`,
              boxShadow: `0 0 0 2px rgba(12,10,20,0.3), 0 0 24px ${accent}55`,
              transition: `all ${ease}`,
              pointerEvents: 'none',
              background: 'rgba(255,255,255,0.04)',
            }}>
              {/* corner ticks */}
              {[[0,0],[1,0],[0,1],[1,1]].map(([x,y], i) => (
                <div key={i} style={{
                  position: 'absolute',
                  left: x ? 'auto' : -4, right: x ? -4 : 'auto',
                  top: y ? 'auto' : -4, bottom: y ? -4 : 'auto',
                  width: 8, height: 8,
                  borderTop: !y ? `2px solid ${accent}` : 'none',
                  borderBottom: y ? `2px solid ${accent}` : 'none',
                  borderLeft: !x ? `2px solid ${accent}` : 'none',
                  borderRight: x ? `2px solid ${accent}` : 'none',
                }}/>
              ))}
            </div>

            {/* coord label */}
            <div style={{
              position: 'absolute',
              left: rect.x + rect.w + 10, top: rect.y - 20,
              fontSize: 9.5, fontFamily: 'ui-monospace, monospace',
              color: accent, letterSpacing: '0.1em',
              transition: `all ${ease}`,
              background: 'oklch(0.18 0.012 280)',
              padding: '2px 6px', borderRadius: 2,
            }}>
              {`[${String(Math.round(rect.x)).padStart(4,'0')}, ${String(Math.round(rect.y)).padStart(4,'0')}]`}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ───────────────────── VARIANT 3: LETTERBOX ───────────────────── */
function Letterbox({ stageRef, step, stepIndex, onNext, accent, speed }) {
  const rect = useTargetRect(stageRef, step.target);
  const isCenter = !step.target || !rect;
  const ease = `${700/speed}ms cubic-bezier(0.65, 0, 0.2, 1)`;
  const stageW = stageRef.current?.clientWidth || 1200;
  const stageH = stageRef.current?.clientHeight || 760;

  // Bar size pulsates per step
  const barH = isCenter ? stageH * 0.32 : 70;

  return (
    <div style={{
      position: 'absolute', inset: 0, pointerEvents: 'auto',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      {/* Top bar */}
      <div style={{
        position: 'absolute', left: 0, right: 0, top: 0, height: barH,
        background: 'oklch(0.12 0.01 280)',
        transition: `height ${ease}`,
        display: 'flex', alignItems: 'center', padding: '0 36px',
        color: 'oklch(0.96 0.005 90)',
      }}>
        {/* film-marks */}
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          height: 1, background: accent, opacity: 0.4,
        }}/>
        <div style={{
          fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase',
          color: 'rgba(255,255,255,0.4)',
        }}>
          Vexa · Onboarding · Reel 01
        </div>
        <div style={{
          marginLeft: 'auto',
          fontFamily: 'ui-monospace, monospace', fontSize: 11,
          color: 'rgba(255,255,255,0.5)', letterSpacing: '0.15em',
        }}>
          <span style={{ color: accent }}>●</span> REC {String(stepIndex).padStart(2,'0')}:{String((stepIndex+1)*12).padStart(2,'0')}
        </div>

        {/* Welcome title appears in expanded top bar */}
        {isCenter && (
          <div style={{
            position: 'absolute', left: 0, right: 0, bottom: 28, textAlign: 'center',
            animation: `tour-fade-up ${720/speed}ms cubic-bezier(0.16, 1, 0.3, 1)`,
          }}>
            <div style={{
              fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase',
              color: accent, marginBottom: 14,
            }}>{step.eyebrow}</div>
            <div style={{
              fontFamily: '"Instrument Serif", Georgia, serif',
              fontSize: 56, lineHeight: 1, fontWeight: 400,
              letterSpacing: '-0.02em', whiteSpace: 'pre-line',
            }}>{step.title}</div>
          </div>
        )}
      </div>

      {/* Bottom bar */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, height: barH,
        background: 'oklch(0.12 0.01 280)',
        transition: `height ${ease}`,
        color: 'oklch(0.96 0.005 90)',
        padding: '0 36px',
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
      }}>
        <div style={{
          position: 'absolute', left: 0, right: 0, top: 0,
          height: 1, background: accent, opacity: 0.4,
        }}/>

        {/* In welcome, bottom bar shows body+cta big */}
        {isCenter ? (
          <div style={{
            textAlign: 'center',
            animation: `tour-fade-up ${820/speed}ms cubic-bezier(0.16, 1, 0.3, 1)`,
          }}>
            <div style={{ fontSize: 15, opacity: 0.7, maxWidth: 520, margin: '0 auto 22px' }}>
              {step.body}
            </div>
            <button onClick={onNext} style={{
              height: 44, padding: '0 26px', borderRadius: 22,
              background: accent, color: 'oklch(0.18 0.012 280)', border: 'none',
              fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
              cursor: 'pointer', letterSpacing: '0.04em', textTransform: 'uppercase',
            }}>{step.cta} ▸</button>
          </div>
        ) : (
          /* per-step: eyebrow/title/body + next */
          <div key={stepIndex} style={{
            display: 'flex', alignItems: 'center', gap: 32,
            animation: `tour-fade-up ${700/speed}ms cubic-bezier(0.16, 1, 0.3, 1)`,
          }}>
            <div style={{ flex: 1, maxWidth: 640 }}>
              <div style={{
                fontSize: 9.5, letterSpacing: '0.2em', textTransform: 'uppercase',
                color: accent, marginBottom: 4,
              }}>{step.eyebrow}</div>
              <div style={{
                fontFamily: '"Instrument Serif", Georgia, serif',
                fontSize: 22, lineHeight: 1.1, letterSpacing: '-0.01em',
                whiteSpace: 'pre-line',
                display: 'inline',
              }}>{step.title.replace(/\n/g,' ')}</div>
              <span style={{ fontSize: 13, opacity: 0.6, marginLeft: 14 }}>
                — {step.body}
              </span>
            </div>
            <button onClick={onNext} style={{
              height: 38, padding: '0 18px', borderRadius: 19,
              background: 'transparent', color: 'oklch(0.96 0.005 90)',
              border: `1px solid ${accent}`, fontSize: 12, fontWeight: 500,
              fontFamily: 'inherit', cursor: 'pointer',
              letterSpacing: '0.08em', textTransform: 'uppercase',
              display: 'inline-flex', alignItems: 'center', gap: 10,
              whiteSpace: 'nowrap',
            }}>
              {step.cta}
              <svg width="14" height="10" viewBox="0 0 14 10">
                <path d="M1 5H13M13 5L9 1M13 5L9 9" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        )}

        {/* progress dashes */}
        {!isCenter && (
          <div style={{
            position: 'absolute', left: 36, right: 36, top: 8,
            display: 'flex', gap: 4,
          }}>
            {TOUR_STEPS.map((_, i) => (
              <div key={i} style={{
                flex: 1, height: 2,
                background: i <= stepIndex ? accent : 'rgba(255,255,255,0.12)',
                transition: `all ${ease}`,
              }}/>
            ))}
          </div>
        )}
      </div>

      {/* Spotlight hotspot for step targets */}
      {!isCenter && (
        <>
          {/* dim middle area subtly */}
          <div style={{
            position: 'absolute', left: 0, right: 0, top: barH, bottom: barH,
            background: `radial-gradient(circle at ${rect.cx}px ${rect.cy - barH}px, rgba(12,10,20,0) 80px, rgba(12,10,20,0.35) 240px)`,
            transition: `all ${ease}`,
            pointerEvents: 'none',
          }}/>
          {/* ring */}
          <div style={{
            position: 'absolute',
            left: rect.x - 8, top: rect.y - 8,
            width: rect.w + 16, height: rect.h + 16,
            borderRadius: Math.min(16, (rect.h + 16)/2),
            border: `1.5px solid ${accent}`,
            boxShadow: `0 0 0 4px rgba(0,0,0,0.18), 0 0 30px ${accent}77`,
            transition: `all ${ease}`,
            pointerEvents: 'none',
          }}>
            <div style={{
              position: 'absolute', inset: -10, borderRadius: 'inherit',
              border: `2px solid ${accent}`, opacity: 0.35,
              animation: `tour-pulse-big ${1600/speed}ms ease-out infinite`,
            }}/>
          </div>
        </>
      )}
    </div>
  );
}

Object.assign(window, {
  TOUR_STEPS, SpotlightCinema, RailNarrator, RailNarratorRail, Letterbox,
});
