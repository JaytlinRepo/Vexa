// tour-variants-v2.jsx — three bolder variants
// - Speaks: UI elements literally speak — comic-style bubbles erupt from targets
// - Blueprint: everything rendered as architect's wireframe, target materializes in color
// - Supercut: enormous kinetic typography, UI pans in 3D space

// Shared hook (also defined in tour-engine.jsx but self-contained here)
function useTargetRectV2(stageRef, targetId, dep) {
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
        x: eB.left - sB.left, y: eB.top - sB.top,
        w: eB.width, h: eB.height,
        cx: eB.left - sB.left + eB.width / 2,
        cy: eB.top - sB.top + eB.height / 2,
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage); ro.observe(el);
    window.addEventListener('resize', measure);
    // Also remeasure on dep change (page change) after transition
    const t = setTimeout(measure, 540);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); clearTimeout(t); };
  }, [targetId, dep]);
  return rect;
}

/* ═══════════════ VARIANT 4: VEXA SPEAKS ═══════════════ */
/* UI elements speak. Speech bubbles erupt from the target with a hand-drawn arrow.
   Hugely disarming and breaks the 4th wall. */
function VexaSpeaks({ stageRef, step, stepIndex, onNext, accent, speed }) {
  const rect = useTargetRectV2(stageRef, step.target, step.page);
  const isCenter = !step.target || !rect;
  const stageW = stageRef.current?.clientWidth || 1200;
  const stageH = stageRef.current?.clientHeight || 760;
  const bubbleW = 340;

  // Pick bubble position based on available space
  let bubble = { x: stageW/2 - bubbleW/2, y: 80, anchorX: stageW/2, anchorY: stageH/2, side: 'center' };
  if (!isCenter) {
    const spaceRight = stageW - (rect.x + rect.w);
    const spaceBelow = stageH - (rect.y + rect.h);
    const spaceAbove = rect.y;

    if (spaceRight > bubbleW + 60) {
      bubble = {
        x: rect.x + rect.w + 60,
        y: Math.max(30, Math.min(stageH - 240, rect.cy - 80)),
        anchorX: rect.x + rect.w, anchorY: rect.cy, side: 'left',
      };
    } else if (spaceBelow > 220) {
      bubble = {
        x: Math.max(20, Math.min(stageW - bubbleW - 20, rect.cx - bubbleW/2)),
        y: rect.y + rect.h + 60,
        anchorX: rect.cx, anchorY: rect.y + rect.h, side: 'top',
      };
    } else if (spaceAbove > 220) {
      bubble = {
        x: Math.max(20, Math.min(stageW - bubbleW - 20, rect.cx - bubbleW/2)),
        y: rect.y - 220,
        anchorX: rect.cx, anchorY: rect.y, side: 'bottom',
      };
    } else {
      bubble = {
        x: Math.max(20, rect.x - bubbleW - 60),
        y: Math.max(30, Math.min(stageH - 240, rect.cy - 80)),
        anchorX: rect.x, anchorY: rect.cy, side: 'right',
      };
    }
  }

  // Hand-drawn arrow path from bubble edge to target
  const arrowPath = (() => {
    if (isCenter) return null;
    const bx = bubble.side === 'left'   ? bubble.x - 4
             : bubble.side === 'right'  ? bubble.x + bubbleW + 4
             : bubble.x + bubbleW/2;
    const by = bubble.side === 'top'    ? bubble.y - 4
             : bubble.side === 'bottom' ? bubble.y + 200
             : bubble.y + 40;
    // S-curve with jitter for hand-drawn feel
    const tx = bubble.anchorX;
    const ty = bubble.anchorY;
    const midX = (bx + tx) / 2 + (Math.random() > 0.5 ? 20 : -20);
    const midY = (by + ty) / 2 + (Math.random() > 0.5 ? 15 : -15);
    return `M ${bx} ${by} Q ${midX} ${midY} ${tx} ${ty}`;
  })();

  return (
    <div style={{
      position: 'absolute', inset: 0, pointerEvents: 'none',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      {/* Light warm tint */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(ellipse at center, rgba(255,248,230,0) 40%, rgba(255,220,180,0.18) 100%)',
        pointerEvents: 'none',
      }}/>

      {/* Halo around target */}
      {!isCenter && (
        <>
          <div key={`halo-${stepIndex}`} style={{
            position: 'absolute',
            left: rect.x - 10, top: rect.y - 10,
            width: rect.w + 20, height: rect.h + 20,
            borderRadius: Math.min(16, (rect.h + 20)/2),
            boxShadow: `0 0 0 3px ${accent}, 0 0 0 10px ${accent}33, 0 0 60px ${accent}aa`,
            pointerEvents: 'none',
            animation: `tour-wiggle ${400/speed}ms cubic-bezier(0.68, -0.55, 0.27, 1.55)`,
            transition: `all 500ms cubic-bezier(0.16, 1, 0.3, 1)`,
          }}/>
          {/* jazz hand stars */}
          {[0,1,2].map(i => (
            <div key={`star-${stepIndex}-${i}`} style={{
              position: 'absolute',
              left: rect.x + rect.w + (i*8) - 4,
              top: rect.y - 20 + (i*4),
              fontSize: 16, color: accent,
              animation: `tour-sparkle ${900/speed}ms ease-out`,
              animationDelay: `${i * 80/speed}ms`,
              pointerEvents: 'none',
            }}>✦</div>
          ))}
        </>
      )}

      {/* Hand-drawn arrow */}
      {!isCenter && (
        <svg key={`arrow-${stepIndex}`} style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          overflow: 'visible',
          animation: `tour-arrow-draw ${700/speed}ms ${400/speed}ms ease-out both`,
        }}>
          <path
            d={arrowPath}
            stroke="oklch(0.22 0.01 280)"
            strokeWidth="2.2"
            fill="none"
            strokeLinecap="round"
            strokeDasharray="500"
            style={{
              filter: 'url(#rough)',
              strokeDashoffset: 0,
            }}
          />
          {/* arrowhead */}
          <polygon
            points={`${bubble.anchorX},${bubble.anchorY} ${bubble.anchorX - 10},${bubble.anchorY - 6} ${bubble.anchorX - 10},${bubble.anchorY + 6}`}
            fill="oklch(0.22 0.01 280)"
            transform={`rotate(${
              (Math.atan2(bubble.anchorY - bubble.y - 20, bubble.anchorX - bubble.x - bubbleW/2) * 180 / Math.PI)
            } ${bubble.anchorX} ${bubble.anchorY})`}
            style={{ animation: `tour-fade-in 300ms ${900/speed}ms both` }}
          />
          <defs>
            <filter id="rough">
              <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed={stepIndex}/>
              <feDisplacementMap in="SourceGraphic" scale="2"/>
            </filter>
          </defs>
        </svg>
      )}

      {/* Speech bubble */}
      <div
        key={`bubble-${stepIndex}`}
        style={{
          position: 'absolute',
          left: bubble.x, top: bubble.y,
          width: bubbleW,
          pointerEvents: 'auto',
          animation: `tour-bubble-pop ${500/speed}ms cubic-bezier(0.68, -0.55, 0.27, 1.55) both`,
          transformOrigin: bubble.side === 'left' ? 'left center'
                         : bubble.side === 'right' ? 'right center'
                         : bubble.side === 'top' ? 'center top'
                         : 'center bottom',
        }}>
        <div style={{
          background: 'oklch(0.99 0.01 85)',
          color: 'oklch(0.18 0.01 280)',
          padding: '20px 22px 18px',
          borderRadius: 18,
          border: `2.5px solid oklch(0.18 0.01 280)`,
          boxShadow: `6px 6px 0 0 ${accent}`,
          position: 'relative',
          fontFamily: '"Instrument Serif", Georgia, serif',
        }}>
          {/* Speaker tag */}
          <div style={{
            position: 'absolute', left: 16, top: -11,
            background: 'oklch(0.18 0.01 280)',
            color: 'oklch(0.99 0.01 85)',
            fontSize: 10, fontWeight: 500, letterSpacing: '0.14em',
            padding: '3px 10px', borderRadius: 4,
            fontFamily: 'Inter, system-ui, sans-serif',
            textTransform: 'uppercase',
          }}>
            {step.target ? (
              step.target === 'nav-new' ? 'NEW BUTTON' :
              step.target === 'search-bar' ? 'SEARCH' :
              step.target === 'ai-assist' ? 'ASK VEXA' :
              step.target === 'docs-grid' ? 'LIBRARY' :
              step.target === 'share-panel' ? 'SHARE' :
              step.target === 'collab-avatars' ? 'TEAM' :
              'VEXA'
            ) : 'VEXA'}
            <span style={{ marginLeft: 6, opacity: 0.5 }}>speaking</span>
          </div>

          <div style={{
            fontSize: 32, lineHeight: 1.05, letterSpacing: '-0.02em',
            fontStyle: 'italic', marginBottom: 10, whiteSpace: 'pre-line',
          }}>
            "{step.title.replace(/\n/g, ' ')}"
          </div>
          <div style={{
            fontSize: 14, lineHeight: 1.5, opacity: 0.7,
            fontFamily: 'Inter, system-ui, sans-serif',
            fontStyle: 'normal',
            marginBottom: 16,
          }}>
            — {step.body}
          </div>

          {/* Dots + next */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            fontFamily: 'Inter, system-ui, sans-serif',
          }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {TOUR_STEPS.map((_, i) => (
                <div key={i} style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: i === stepIndex ? accent : i < stepIndex ? 'oklch(0.18 0.01 280)' : 'transparent',
                  border: `1.5px solid oklch(0.18 0.01 280)`,
                  transition: 'all 300ms',
                }}/>
              ))}
            </div>
            <button onClick={onNext} style={{
              marginLeft: 'auto',
              background: 'oklch(0.18 0.01 280)',
              color: 'oklch(0.99 0.01 85)',
              border: 'none', padding: '7px 14px', borderRadius: 20,
              fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
              cursor: 'pointer', letterSpacing: '0.08em', textTransform: 'uppercase',
            }}>{step.cta} →</button>
          </div>
        </div>
      </div>

      {/* "Ssssst!" attention-grabber at top */}
      {!isCenter && (
        <div key={`sst-${stepIndex}`} style={{
          position: 'absolute',
          left: bubble.x + bubbleW - 60,
          top: bubble.y - 30,
          fontFamily: '"Instrument Serif", serif',
          fontStyle: 'italic', fontSize: 22,
          color: accent,
          transform: 'rotate(-8deg)',
          animation: `tour-wiggle-shout ${600/speed}ms cubic-bezier(0.68, -0.55, 0.27, 1.55) both`,
          pointerEvents: 'none',
        }}>
          psst!
        </div>
      )}
    </div>
  );
}

/* ═══════════════ VARIANT 5: BLUEPRINT ═══════════════ */
/* Renders the product as if it's an architect's blueprint. Target element
   materializes in color (ink bleed). Measurements, grid, architect handwriting. */
function Blueprint({ stageRef, step, stepIndex, onNext, accent, speed }) {
  const rect = useTargetRectV2(stageRef, step.target, step.page);
  const isCenter = !step.target || !rect;
  const stageW = stageRef.current?.clientWidth || 1200;
  const stageH = stageRef.current?.clientHeight || 760;

  return (
    <div style={{
      position: 'absolute', inset: 0, pointerEvents: 'auto',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      {/* Blueprint wash — tints entire product cyan-blue except target area */}
      <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <defs>
          <mask id="bp-mask">
            <rect width="100%" height="100%" fill="white"/>
            {!isCenter && (
              <rect
                x={rect.x - 8} y={rect.y - 8}
                width={rect.w + 16} height={rect.h + 16}
                rx={Math.min(12, (rect.h + 16)/2)}
                fill="black"
                style={{ transition: 'all 700ms cubic-bezier(0.16, 1, 0.3, 1)' }}
              />
            )}
          </mask>
          <pattern id="bp-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="oklch(0.85 0.08 240)" strokeWidth="0.5" opacity="0.4"/>
          </pattern>
          <pattern id="bp-grid-fine" width="8" height="8" patternUnits="userSpaceOnUse">
            <path d="M 8 0 L 0 0 0 8" fill="none" stroke="oklch(0.85 0.08 240)" strokeWidth="0.3" opacity="0.2"/>
          </pattern>
        </defs>
        {/* blueprint blue wash */}
        <rect width="100%" height="100%" fill="oklch(0.4 0.12 240)" opacity="0.92" mask="url(#bp-mask)"/>
        {/* grid over the wash */}
        <rect width="100%" height="100%" fill="url(#bp-grid-fine)" mask="url(#bp-mask)" style={{ mixBlendMode: 'screen' }}/>
        <rect width="100%" height="100%" fill="url(#bp-grid)" mask="url(#bp-mask)" style={{ mixBlendMode: 'screen' }}/>
      </svg>

      {/* Measurement lines around target */}
      {!isCenter && (
        <svg style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}>
          {/* width measurement — above */}
          <g style={{ animation: `tour-fade-in ${500/speed}ms ${300/speed}ms both`, color: 'oklch(0.98 0.01 240)' }}>
            <line x1={rect.x} y1={rect.y - 26} x2={rect.x + rect.w} y2={rect.y - 26} stroke="currentColor" strokeWidth="0.8"/>
            <line x1={rect.x} y1={rect.y - 22} x2={rect.x} y2={rect.y - 30} stroke="currentColor" strokeWidth="0.8"/>
            <line x1={rect.x + rect.w} y1={rect.y - 22} x2={rect.x + rect.w} y2={rect.y - 30} stroke="currentColor" strokeWidth="0.8"/>
            <text
              x={rect.x + rect.w/2} y={rect.y - 32}
              fill="currentColor" fontSize="10" textAnchor="middle"
              fontFamily="ui-monospace, monospace" letterSpacing="2">
              {Math.round(rect.w)}px
            </text>
          </g>
          {/* height measurement — right */}
          <g style={{ animation: `tour-fade-in ${500/speed}ms ${400/speed}ms both`, color: 'oklch(0.98 0.01 240)' }}>
            <line x1={rect.x + rect.w + 26} y1={rect.y} x2={rect.x + rect.w + 26} y2={rect.y + rect.h} stroke="currentColor" strokeWidth="0.8"/>
            <line x1={rect.x + rect.w + 22} y1={rect.y} x2={rect.x + rect.w + 30} y2={rect.y} stroke="currentColor" strokeWidth="0.8"/>
            <line x1={rect.x + rect.w + 22} y1={rect.y + rect.h} x2={rect.x + rect.w + 30} y2={rect.y + rect.h} stroke="currentColor" strokeWidth="0.8"/>
            <text
              x={rect.x + rect.w + 32} y={rect.y + rect.h/2 + 4}
              fill="currentColor" fontSize="10"
              fontFamily="ui-monospace, monospace" letterSpacing="2">
              {Math.round(rect.h)}px
            </text>
          </g>
          {/* Extension lines — cross through whole screen */}
          <g opacity="0.25" style={{ color: 'oklch(0.98 0.01 240)' }}>
            <line x1="0" y1={rect.y} x2={stageW} y2={rect.y} stroke="currentColor" strokeWidth="0.5" strokeDasharray="4 4"/>
            <line x1="0" y1={rect.y + rect.h} x2={stageW} y2={rect.y + rect.h} stroke="currentColor" strokeWidth="0.5" strokeDasharray="4 4"/>
            <line x1={rect.x} y1="0" x2={rect.x} y2={stageH} stroke="currentColor" strokeWidth="0.5" strokeDasharray="4 4"/>
            <line x1={rect.x + rect.w} y1="0" x2={rect.x + rect.w} y2={stageH} stroke="currentColor" strokeWidth="0.5" strokeDasharray="4 4"/>
          </g>
        </svg>
      )}

      {/* Target bracket marker */}
      {!isCenter && (
        <div style={{
          position: 'absolute',
          left: rect.x - 8, top: rect.y - 8,
          width: rect.w + 16, height: rect.h + 16,
          borderRadius: Math.min(12, (rect.h + 16)/2),
          boxShadow: `0 0 0 1.5px oklch(0.98 0.01 240), 0 0 0 4px oklch(0.4 0.12 240)`,
          pointerEvents: 'none',
          transition: 'all 700ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}/>
      )}

      {/* Blueprint title block — bottom left */}
      <div
        key={`title-block-${stepIndex}`}
        style={{
          position: 'absolute',
          left: 30, bottom: 30,
          width: 340,
          background: 'oklch(0.25 0.1 240)',
          border: '1.5px solid oklch(0.98 0.01 240)',
          color: 'oklch(0.98 0.01 240)',
          padding: 0,
          fontFamily: '"Instrument Serif", serif',
          animation: `tour-blueprint-in ${700/speed}ms cubic-bezier(0.16, 1, 0.3, 1) both`,
        }}>
        {/* Top strip — project header */}
        <div style={{
          display: 'flex', padding: '8px 14px',
          borderBottom: '1px solid oklch(0.98 0.01 240 / 0.4)',
          fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase',
          fontFamily: 'ui-monospace, monospace',
        }}>
          <span>VEXA / ONBOARDING</span>
          <span style={{ marginLeft: 'auto' }}>SHEET {String(stepIndex + 1).padStart(2, '0')}/{String(TOUR_STEPS.length).padStart(2, '0')}</span>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 18px 14px' }}>
          <div style={{
            fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase',
            fontFamily: 'ui-monospace, monospace', color: accent,
            marginBottom: 10,
          }}>
            {step.eyebrow} · Elevation
          </div>
          <div style={{
            fontSize: 30, lineHeight: 1.02, letterSpacing: '-0.02em',
            fontStyle: 'italic', whiteSpace: 'pre-line',
            marginBottom: 10,
          }}>
            {step.title}
          </div>
          <div style={{
            fontSize: 12.5, lineHeight: 1.55, opacity: 0.75,
            fontFamily: 'Inter, system-ui, sans-serif',
            fontStyle: 'normal', marginBottom: 16,
          }}>
            {step.body}
          </div>

          {/* Scale bar */}
          <div style={{
            fontSize: 9, fontFamily: 'ui-monospace, monospace',
            letterSpacing: '0.2em', textTransform: 'uppercase',
            opacity: 0.6, marginBottom: 6,
          }}>
            PROGRESS · 1:{String((stepIndex+1) * 10).padStart(3, '0')}
          </div>
          <div style={{
            height: 4, display: 'flex',
            border: '1px solid oklch(0.98 0.01 240)',
          }}>
            {TOUR_STEPS.map((_, i) => (
              <div key={i} style={{
                flex: 1,
                background: i <= stepIndex ? 'oklch(0.98 0.01 240)' : 'transparent',
                borderRight: i < TOUR_STEPS.length - 1 ? '1px solid oklch(0.98 0.01 240)' : 'none',
                transition: 'all 300ms',
              }}/>
            ))}
          </div>

          {/* Sign-off button */}
          <button onClick={onNext} style={{
            marginTop: 14,
            background: 'transparent',
            color: 'oklch(0.98 0.01 240)',
            border: '1.5px solid oklch(0.98 0.01 240)',
            padding: '8px 14px', borderRadius: 0,
            fontSize: 10, fontWeight: 500,
            fontFamily: 'ui-monospace, monospace',
            letterSpacing: '0.2em', textTransform: 'uppercase',
            cursor: 'pointer',
          }}>
            [ {step.cta} ]
          </button>
        </div>
      </div>

      {/* Corner stamp — revision */}
      <div style={{
        position: 'absolute', right: 24, top: 20,
        color: 'oklch(0.98 0.01 240)',
        fontFamily: 'ui-monospace, monospace',
        fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase',
        textAlign: 'right', opacity: 0.8,
      }}>
        <div style={{ marginBottom: 3 }}>REV.{stepIndex + 1}</div>
        <div style={{ opacity: 0.6 }}>{stageW}×{stageH}mm</div>
      </div>

      {/* Target coordinates label */}
      {!isCenter && (
        <div key={`coord-${stepIndex}`} style={{
          position: 'absolute',
          left: rect.x, top: rect.y + rect.h + 32,
          color: 'oklch(0.98 0.01 240)',
          fontFamily: 'ui-monospace, monospace',
          fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase',
          animation: `tour-fade-in ${500/speed}ms ${500/speed}ms both`,
          pointerEvents: 'none',
        }}>
          [ X:{Math.round(rect.x)} Y:{Math.round(rect.y)} ]
        </div>
      )}
    </div>
  );
}

/* ═══════════════ VARIANT 6: SUPERCUT ═══════════════ */
/* Enormous kinetic typography that slams across the screen each step.
   Product UI pans/tilts in 3D space. Feels like a trailer or music video. */
function Supercut({ stageRef, step, stepIndex, onNext, accent, speed }) {
  const rect = useTargetRectV2(stageRef, step.target, step.page);
  const isCenter = !step.target || !rect;
  const stageW = stageRef.current?.clientWidth || 1200;
  const stageH = stageRef.current?.clientHeight || 760;

  // Deterministic per-step "shot" — different angle/position each step
  const shots = [
    { tx: 0, ty: 0, rot: 0, scale: 1,   textAt: 'center', color: 'dark' },
    { tx: -30, ty: -20, rot: -1, scale: 1.05, textAt: 'right-lean', color: 'accent' },
    { tx: 40, ty: 20, rot: 1.5, scale: 1.08, textAt: 'left-lean', color: 'dark' },
    { tx: -20, ty: 30, rot: -0.5, scale: 1.06, textAt: 'bottom', color: 'accent' },
    { tx: 0, ty: -40, rot: 0, scale: 1.1, textAt: 'split', color: 'dark' },
    { tx: 50, ty: -30, rot: 1, scale: 1.08, textAt: 'top-right', color: 'accent' },
    { tx: -40, ty: 40, rot: -1.5, scale: 1.04, textAt: 'center', color: 'dark' },
  ];
  const shot = shots[stepIndex % shots.length];

  // "Camera" pan focuses on target — translate the product so target is centered
  const camX = isCenter ? 0 : (stageW/2 - rect.cx) * 0.4 + shot.tx;
  const camY = isCenter ? 0 : (stageH/2 - rect.cy) * 0.4 + shot.ty;

  const words = step.title.replace('\n', ' ').split(' ');

  // Title position per shot
  const titlePos = {
    'center':     { left: '50%', top: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center', angle: 0 },
    'right-lean': { left: '46%', top: '36%', transform: 'translate(-50%,-50%) rotate(-2deg)', textAlign: 'left', angle: -2 },
    'left-lean':  { left: '54%', top: '64%', transform: 'translate(-50%,-50%) rotate(2deg)',  textAlign: 'right', angle: 2 },
    'bottom':     { left: '50%', top: '78%', transform: 'translate(-50%,-50%)', textAlign: 'center', angle: 0 },
    'split':      { left: '50%', top: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center', angle: 0 },
    'top-right':  { left: '62%', top: '28%', transform: 'translate(-50%,-50%) rotate(-1deg)', textAlign: 'right', angle: -1 },
  }[shot.textAt];

  const titleColor = shot.color === 'accent' ? accent : 'oklch(0.08 0.01 280)';
  const veilColor = shot.color === 'accent' ? 'oklch(0.12 0.01 280 / 0.72)' : 'oklch(0.96 0.005 90 / 0.78)';

  return (
    <div style={{
      position: 'absolute', inset: 0, pointerEvents: 'auto',
      overflow: 'hidden',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      {/* Camera panning layer — we apply the transform to an overlay
          bc we can't transform the product beneath (sibling in DOM). Instead
          we use a faux-pan by offsetting an overlay veil and letting the real
          product stay put. To make it feel like camera movement, we animate
          a paper/grain texture and a color veil. */}

      {/* Chromatic tint veil — color-grades the entire frame */}
      <div
        key={`veil-${stepIndex}`}
        style={{
          position: 'absolute', inset: 0,
          background: veilColor,
          animation: `tour-veil-${shot.color === 'accent' ? 'warm' : 'cool'} ${900/speed}ms cubic-bezier(0.22,1,0.36,1) both`,
          pointerEvents: 'none',
          mixBlendMode: shot.color === 'accent' ? 'multiply' : 'lighten',
        }}/>

      {/* Punched highlight over target — keeps product visible */}
      {!isCenter && (
        <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <defs>
            <mask id="sc-mask">
              <rect width="100%" height="100%" fill="white"/>
              <rect
                x={rect.x - 14} y={rect.y - 14}
                width={rect.w + 28} height={rect.h + 28}
                rx={Math.min(16, (rect.h + 28)/2)} fill="black"
                style={{ transition: 'all 700ms cubic-bezier(0.22,1,0.36,1)' }}
              />
            </mask>
          </defs>
          <rect width="100%" height="100%" fill={veilColor} mask="url(#sc-mask)"
                style={{ mixBlendMode: shot.color === 'accent' ? 'multiply' : 'screen' }}/>
        </svg>
      )}

      {/* Target frame — thick bracket */}
      {!isCenter && (
        <div key={`frame-${stepIndex}`} style={{
          position: 'absolute',
          left: rect.x - 14, top: rect.y - 14,
          width: rect.w + 28, height: rect.h + 28,
          pointerEvents: 'none',
          transition: 'all 700ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}>
          {[[0,0],[1,0],[0,1],[1,1]].map(([x,y], i) => (
            <div key={i} style={{
              position: 'absolute',
              left: x ? 'auto' : -2, right: x ? -2 : 'auto',
              top:  y ? 'auto' : -2, bottom: y ? -2 : 'auto',
              width: 28, height: 28,
              borderTop:    !y ? `3px solid ${accent}` : 'none',
              borderBottom:  y ? `3px solid ${accent}` : 'none',
              borderLeft:   !x ? `3px solid ${accent}` : 'none',
              borderRight:   x ? `3px solid ${accent}` : 'none',
              animation: `tour-fade-in ${500/speed}ms ${200/speed}ms both`,
            }}/>
          ))}
        </div>
      )}

      {/* ENORMOUS kinetic title — split into words, each flies in */}
      <div style={{
        position: 'absolute', ...titlePos,
        width: '72%', maxWidth: 900,
        pointerEvents: 'none',
        fontFamily: '"Instrument Serif", Georgia, serif',
        fontStyle: 'italic',
        color: titleColor,
        lineHeight: 0.88,
        letterSpacing: '-0.035em',
        textShadow: shot.color === 'accent' ? `0 4px 40px oklch(0.08 0.01 280 / 0.5)` : 'none',
        mixBlendMode: 'normal',
      }}>
        {/* eyebrow */}
        <div style={{
          fontFamily: 'ui-monospace, monospace',
          fontSize: 11, letterSpacing: '0.28em', textTransform: 'uppercase',
          fontStyle: 'normal',
          color: titleColor,
          opacity: 0.7,
          marginBottom: 18,
          animation: `tour-fade-up ${600/speed}ms ease-out both`,
          textAlign: titlePos.textAlign,
        }}>
          ▸ {step.eyebrow}
        </div>

        {/* words */}
        <div style={{
          fontSize: `clamp(60px, ${Math.min(10, 100/Math.max(...words.map(w => w.length)))}vw, 150px)`,
          textAlign: titlePos.textAlign,
        }}>
          {words.map((w, i) => (
            <span key={`${stepIndex}-${i}`} style={{
              display: 'inline-block',
              marginRight: '0.2em',
              animation: `tour-slam-in ${700/speed}ms cubic-bezier(0.16, 1, 0.3, 1) both`,
              animationDelay: `${i * 90/speed + 200/speed}ms`,
            }}>{w}</span>
          ))}
        </div>

        {/* body caption */}
        <div style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          fontStyle: 'normal',
          fontSize: 14, lineHeight: 1.5,
          color: titleColor,
          opacity: 0.65,
          marginTop: 22,
          maxWidth: 460,
          textAlign: titlePos.textAlign,
          marginLeft: titlePos.textAlign === 'right' ? 'auto' : titlePos.textAlign === 'center' ? 'auto' : 0,
          marginRight: titlePos.textAlign === 'right' ? 0 : titlePos.textAlign === 'center' ? 'auto' : 'auto',
          animation: `tour-fade-up ${600/speed}ms ${600/speed}ms ease-out both`,
        }}>
          {step.body}
        </div>
      </div>

      {/* Bottom scroll ticker — shot + progress */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        height: 32,
        background: 'oklch(0.1 0.01 280)',
        color: 'oklch(0.96 0.005 90)',
        display: 'flex', alignItems: 'center', gap: 24, padding: '0 24px',
        fontFamily: 'ui-monospace, monospace',
        fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase',
        pointerEvents: 'none',
      }}>
        <div style={{ color: accent, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14 }}>●</span> SHOT {String(stepIndex + 1).padStart(2, '0')}
        </div>
        <div style={{ opacity: 0.6 }}>
          TARGET: {step.target || 'FULL_FRAME'}
        </div>
        <div style={{ opacity: 0.6 }}>
          LOC: {step.page.toUpperCase()}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
          {TOUR_STEPS.map((_, i) => (
            <div key={i} style={{
              width: i === stepIndex ? 24 : 4, height: 4,
              background: i <= stepIndex ? accent : 'rgba(255,255,255,0.15)',
              transition: 'all 300ms',
            }}/>
          ))}
        </div>
      </div>

      {/* Invisible next button overlay */}
      <button onClick={onNext} style={{
        position: 'absolute', inset: 0,
        background: 'transparent', border: 'none', cursor: 'pointer',
        pointerEvents: 'auto',
      }} aria-label="Next"/>
    </div>
  );
}

Object.assign(window, { VexaSpeaks, Blueprint, Supercut });
