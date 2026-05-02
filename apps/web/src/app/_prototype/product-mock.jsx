// ProductMock.jsx — fictional "Vexa" workspace with multiple pages
// Router: drafts | docs | share
// VexaApp takes a `page` prop; tour drives navigation between them.

const VEXA_INK = 'oklch(0.22 0.01 280)';
const VEXA_MUTED = 'oklch(0.55 0.008 280)';
const VEXA_LINE = 'oklch(0.92 0.004 280)';
const VEXA_BG = 'oklch(0.985 0.003 90)';
const VEXA_CARD = '#ffffff';
const VEXA_CHIP = 'oklch(0.96 0.005 90)';

function VexaSidebar({ page }) {
  const navItem = (label, active, target) => (
    <div
      data-tour-target={target}
      style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px',
      borderRadius: 6, fontSize: 13,
      color: active ? VEXA_INK : VEXA_MUTED,
      background: active ? 'oklch(0.96 0.005 90)' : 'transparent',
      fontWeight: active ? 500 : 400,
      transition: 'all 0.45s cubic-bezier(0.16, 1, 0.3, 1)',
    }}>
      <div style={{
        width: 14, height: 14, borderRadius: 3,
        background: active ? VEXA_INK : 'transparent',
        border: active ? 'none' : `1.5px solid ${VEXA_MUTED}`,
        opacity: active ? 1 : 0.5,
      }} />
      {label}
    </div>
  );

  return (
    <aside style={{
      width: 220, borderRight: `1px solid ${VEXA_LINE}`,
      background: VEXA_BG, padding: '18px 12px',
      display: 'flex', flexDirection: 'column', gap: 2,
      fontFamily: 'Inter, system-ui, sans-serif',
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 8px 14px' }}>
        <div style={{
          width: 26, height: 26, borderRadius: 7, background: VEXA_INK,
          color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: '"Instrument Serif", serif', fontSize: 17, fontStyle: 'italic',
          letterSpacing: '-0.02em',
        }}>V</div>
        <div style={{ fontSize: 13, fontWeight: 500, color: VEXA_INK }}>Atelier</div>
        <svg width="10" height="10" viewBox="0 0 10 10" style={{ opacity: 0.4, marginLeft: 'auto' }}>
          <path d="M2 4L5 7L8 4" stroke={VEXA_INK} strokeWidth="1.2" fill="none" strokeLinecap="round"/>
        </svg>
      </div>

      <button
        data-tour-target="nav-new"
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 10px', borderRadius: 7,
          background: VEXA_INK, color: '#fff',
          border: 'none', fontSize: 13, fontWeight: 500,
          fontFamily: 'inherit', cursor: 'pointer', marginBottom: 12,
        }}>
        <svg width="12" height="12" viewBox="0 0 12 12">
          <path d="M6 2V10M2 6H10" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"/>
        </svg>
        New document
      </button>

      {navItem('Home', false)}
      {navItem('Drafts', page === 'drafts', 'nav-drafts')}
      {navItem('Library', page === 'docs', 'nav-docs')}
      {navItem('Shared', page === 'share', 'nav-share')}
      {navItem('Archive', false)}

      <div style={{ fontSize: 10, color: VEXA_MUTED, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '18px 10px 8px' }}>
        Spaces
      </div>
      {navItem('Q2 Strategy', false)}
      {navItem('Brand refresh', false)}
      {navItem('Ops weekly', false)}
    </aside>
  );
}

function VexaTopbar({ page }) {
  const title = page === 'docs' ? 'Library' : page === 'share' ? 'Shared with me' : null;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 20px', borderBottom: `1px solid ${VEXA_LINE}`,
      background: VEXA_CARD,
    }}>
      <div
        data-tour-target="search-bar"
        style={{
          flex: 1, maxWidth: 420, height: 34,
          background: VEXA_CHIP, borderRadius: 8,
          display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px',
          fontSize: 13, color: VEXA_MUTED,
          fontFamily: 'Inter, system-ui, sans-serif',
        }}>
        <svg width="13" height="13" viewBox="0 0 13 13">
          <circle cx="5.5" cy="5.5" r="4" stroke={VEXA_MUTED} strokeWidth="1.3" fill="none"/>
          <path d="M8.5 8.5L11.5 11.5" stroke={VEXA_MUTED} strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
        {title ? `Search ${title.toLowerCase()}…` : 'Search or jump to…'}
        <div style={{
          marginLeft: 'auto', fontSize: 10, padding: '2px 6px',
          border: `1px solid ${VEXA_LINE}`, borderRadius: 4, color: VEXA_MUTED,
          fontFamily: 'ui-monospace, monospace',
        }}>⌘K</div>
      </div>

      <div data-tour-target="collab-avatars" style={{ display: 'flex', marginLeft: 'auto' }}>
        {['#c9a27a', '#7a95c9', '#a2c97a', '#c97aa2'].map((c, i) => (
          <div key={i} style={{
            width: 26, height: 26, borderRadius: '50%', background: c,
            border: '2px solid #fff', marginLeft: i === 0 ? 0 : -8,
            fontFamily: 'Inter', fontSize: 11, color: '#fff', fontWeight: 600,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{['KR','MB','JT','SP'][i]}</div>
        ))}
      </div>

      <button
        data-tour-target="share-btn"
        style={{
        height: 32, padding: '0 14px', borderRadius: 7,
        background: VEXA_INK, color: '#fff', border: 'none',
        fontSize: 12, fontWeight: 500, fontFamily: 'Inter, system-ui, sans-serif',
        cursor: 'pointer',
      }}>Share</button>
    </div>
  );
}

function DraftsPage() {
  return (
    <div style={{
      flex: 1, padding: '36px 56px', overflow: 'hidden',
      background: VEXA_CARD, fontFamily: 'Inter, system-ui, sans-serif',
      position: 'relative',
    }}>
      <div data-tour-target="doc-card" style={{ maxWidth: 640 }}>
        <div style={{ fontSize: 11, color: VEXA_MUTED, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
          Drafts · April 17
        </div>
        <h1 style={{
          fontFamily: '"Instrument Serif", Georgia, serif',
          fontSize: 44, lineHeight: 1.05, fontWeight: 400, color: VEXA_INK,
          margin: '0 0 10px', letterSpacing: '-0.015em',
        }}>
          Quiet machines, <em style={{ fontStyle: 'italic' }}>loud</em> ideas.
        </h1>
        <div style={{ fontSize: 13, color: VEXA_MUTED, marginBottom: 24 }}>
          A positioning brief · 1,240 words · edited 4m ago
        </div>
        {[
          'We begin with a provocation: the best tools don\'t ask for attention, they return it. Vexa is less a workspace than a lens — a place where the work you\'re actually trying to do becomes the loudest thing on the page.',
          'The product is quiet by design. The ideas are the point. Every interface decision, from the typeface pairing to the cursor behavior, exists to push the surface further into the background so the content can step forward.',
        ].map((p, i) => (
          <p key={i} style={{ fontSize: 14.5, lineHeight: 1.65, color: VEXA_INK, margin: '0 0 14px', maxWidth: 560 }}>{p}</p>
        ))}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          {[0.92, 0.85, 0.78, 0.88, 0.6].map((w, i) => (
            <div key={i} style={{ height: 10, width: `${w * 100}%`, borderRadius: 2, background: 'oklch(0.94 0.004 280)', maxWidth: 560 }}/>
          ))}
        </div>
      </div>

      <div data-tour-target="ai-assist" style={{
        position: 'absolute', right: 28, bottom: 24,
        height: 42, padding: '0 16px 0 14px', borderRadius: 21,
        background: VEXA_INK, color: '#fff',
        display: 'flex', alignItems: 'center', gap: 10,
        fontSize: 13, fontFamily: 'Inter, system-ui, sans-serif',
        boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
      }}>
        <div style={{
          width: 22, height: 22, borderRadius: '50%',
          background: 'oklch(0.78 0.18 75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: '"Instrument Serif", serif', fontStyle: 'italic',
          color: VEXA_INK, fontSize: 14,
        }}>✦</div>
        Ask Vexa
        <div style={{ opacity: 0.5, fontSize: 11, fontFamily: 'ui-monospace, monospace', marginLeft: 4 }}>⌘J</div>
      </div>
    </div>
  );
}

function DocsPage() {
  const docs = [
    { t: 'Quiet machines, loud ideas', m: 'Brief · You · 4m', accent: 'oklch(0.88 0.1 70)' },
    { t: 'Q2 goal-setting memo',        m: 'Memo · Maya · 1h', accent: 'oklch(0.88 0.1 210)' },
    { t: 'Brand refresh — research',    m: 'Space · Jules · 3h', accent: 'oklch(0.88 0.1 330)' },
    { t: 'Offsite agenda',              m: 'Doc · Kira · Yesterday', accent: 'oklch(0.88 0.1 150)' },
    { t: 'Hiring loop · staff PM',      m: 'Loop · Sam · 2d', accent: 'oklch(0.88 0.1 30)' },
    { t: 'Pricing — narrative v3',      m: 'Draft · You · 4d', accent: 'oklch(0.88 0.1 260)' },
  ];
  return (
    <div style={{
      flex: 1, padding: '36px 56px', overflow: 'hidden',
      background: VEXA_CARD, fontFamily: 'Inter, system-ui, sans-serif',
      position: 'relative',
    }}>
      <div style={{ fontSize: 11, color: VEXA_MUTED, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
        Library · 42 documents
      </div>
      <h1 style={{
        fontFamily: '"Instrument Serif", Georgia, serif',
        fontSize: 44, lineHeight: 1.05, fontWeight: 400, color: VEXA_INK,
        margin: '0 0 28px', letterSpacing: '-0.015em',
      }}>
        Everything you&rsquo;ve <em>written</em>, in one place.
      </h1>
      <div
        data-tour-target="docs-grid"
        style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14,
        maxWidth: 720,
      }}>
        {docs.map((d, i) => (
          <div key={i} style={{
            padding: 14, border: `1px solid ${VEXA_LINE}`, borderRadius: 10,
            background: '#fff', height: 140, display: 'flex', flexDirection: 'column',
            gap: 10, position: 'relative', overflow: 'hidden',
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: 6, background: d.accent,
            }}/>
            <div style={{ fontSize: 13, fontWeight: 500, color: VEXA_INK, lineHeight: 1.3 }}>{d.t}</div>
            <div style={{ fontSize: 11, color: VEXA_MUTED, marginTop: 'auto' }}>{d.m}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SharePage() {
  return (
    <div style={{
      flex: 1, padding: '36px 56px', overflow: 'hidden',
      background: VEXA_CARD, fontFamily: 'Inter, system-ui, sans-serif',
      position: 'relative',
    }}>
      <div style={{ fontSize: 11, color: VEXA_MUTED, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
        Share · Quiet machines, loud ideas
      </div>
      <h1 style={{
        fontFamily: '"Instrument Serif", Georgia, serif',
        fontSize: 40, lineHeight: 1.05, fontWeight: 400, color: VEXA_INK,
        margin: '0 0 24px', letterSpacing: '-0.015em',
      }}>
        Bring the room.
      </h1>

      <div
        data-tour-target="share-panel"
        style={{
        maxWidth: 520, padding: 20, border: `1px solid ${VEXA_LINE}`,
        borderRadius: 12, background: '#fff',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: VEXA_INK }}>Share this document</div>
          <div style={{
            marginLeft: 'auto', fontSize: 10, padding: '3px 8px', borderRadius: 4,
            background: 'oklch(0.95 0.03 150)', color: 'oklch(0.4 0.1 150)',
            letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 500,
          }}>Live</div>
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 12px', borderRadius: 8,
          background: VEXA_CHIP, fontSize: 12, fontFamily: 'ui-monospace, monospace',
          color: VEXA_INK, marginBottom: 16,
        }}>
          <svg width="12" height="12" viewBox="0 0 12 12">
            <path d="M4 7L6 9L10 5" stroke="oklch(0.4 0.1 150)" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          vexa.so/d/quiet-machines
          <div style={{ marginLeft: 'auto', color: VEXA_MUTED, fontSize: 11 }}>Copy</div>
        </div>

        <div style={{ fontSize: 11, color: VEXA_MUTED, marginBottom: 10, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          People with access
        </div>
        {[
          ['KR', '#c9a27a', 'Kira Reinholt', 'Owner'],
          ['MB', '#7a95c9', 'Maya Bhatt', 'Editor'],
          ['JT', '#a2c97a', 'Jules Tam', 'Editor'],
          ['SP', '#c97aa2', 'Sam Price', 'Commenter'],
        ].map(([i, c, n, r]) => (
          <div key={n} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 0', borderBottom: `1px solid ${VEXA_LINE}`,
            fontSize: 13,
          }}>
            <div style={{
              width: 26, height: 26, borderRadius: '50%', background: c,
              color: '#fff', fontSize: 11, fontWeight: 600,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>{i}</div>
            <div style={{ color: VEXA_INK }}>{n}</div>
            <div style={{ marginLeft: 'auto', color: VEXA_MUTED, fontSize: 12 }}>{r}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function VexaApp({ page = 'drafts' }) {
  const PageEl = page === 'docs' ? DocsPage : page === 'share' ? SharePage : DraftsPage;
  return (
    <div style={{
      width: '100%', height: '100%', display: 'flex',
      background: VEXA_CARD, color: VEXA_INK,
    }}>
      <VexaSidebar page={page}/>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <VexaTopbar page={page}/>
        <div key={page} style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          animation: `tour-scene-${page} 760ms cubic-bezier(0.16, 1, 0.3, 1)`,
        }}>
          <PageEl/>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { VexaApp });
