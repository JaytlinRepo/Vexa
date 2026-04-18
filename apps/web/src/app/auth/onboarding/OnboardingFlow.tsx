'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { EMPLOYEE_CONFIGS, EmployeeRole } from '@vexa/types'

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface OnboardingData {
  companyName: string
  niche: string
  subNiche: string
  tone: string[]
  avoid: string[]
  audience: string
  goal: string
}

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const NICHES = [
  { id: 'fitness',            label: 'Fitness & Wellness',      emoji: '💪', desc: 'Workouts, nutrition, transformation' },
  { id: 'finance',            label: 'Finance & Investing',     emoji: '💰', desc: 'Wealth, investing, personal finance' },
  { id: 'food',               label: 'Food & Cooking',          emoji: '🍳', desc: 'Recipes, cooking, food culture' },
  { id: 'coaching',           label: 'Coaching & Education',    emoji: '🎓', desc: 'Teaching, courses, coaching' },
  { id: 'lifestyle',          label: 'Lifestyle',               emoji: '✨', desc: 'Daily life, aesthetics, wellness' },
  { id: 'personal_development', label: 'Personal Development',  emoji: '🧠', desc: 'Mindset, habits, self improvement' },
]

const TONES = [
  { id: 'motivational',   label: 'Motivational',    desc: 'Energetic, pushing people to act' },
  { id: 'educational',    label: 'Educational',     desc: 'Informative, teaching-focused' },
  { id: 'conversational', label: 'Conversational',  desc: 'Casual, like talking to a friend' },
  { id: 'authoritative',  label: 'Authoritative',   desc: 'Expert voice, confident and direct' },
  { id: 'entertaining',   label: 'Entertaining',    desc: 'Fun, humorous, light-hearted' },
  { id: 'inspiring',      label: 'Inspiring',       desc: 'Emotional, story-driven, uplifting' },
]

const GOALS = [
  { id: 'grow_following',  label: 'Grow my following',         emoji: '📈' },
  { id: 'drive_sales',     label: 'Drive sales or leads',      emoji: '💼' },
  { id: 'build_authority', label: 'Build authority in my niche', emoji: '🏆' },
  { id: 'share_passion',   label: 'Share my passion and story', emoji: '❤️' },
]

const EMPLOYEE_ORDER: EmployeeRole[] = ['analyst', 'strategist', 'copywriter', 'creative_director']

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function OnboardingFlow() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [revealedEmployees, setRevealedEmployees] = useState<number>(0)
  const [data, setData] = useState<OnboardingData>({
    companyName: '',
    niche: '',
    subNiche: '',
    tone: [],
    avoid: [],
    audience: '',
    goal: '',
  })

  const totalSteps = 6
  const progress = Math.round((step / totalSteps) * 100)

  // ── STEP NAVIGATION ────────────────────────────────────────────────────────

  function canAdvance(): boolean {
    switch (step) {
      case 1: return data.companyName.trim().length >= 2
      case 2: return data.niche !== ''
      case 3: return true // sub-niche is optional
      case 4: return data.tone.length >= 1
      case 5: return data.goal !== ''
      case 6: return true
      default: return false
    }
  }

  async function handleNext() {
    if (!canAdvance()) return

    if (step === 5) {
      // Submit onboarding before showing team reveal
      await submitOnboarding()
      setStep(6)
      startTeamReveal()
    } else if (step === 6) {
      router.push('/dashboard')
    } else {
      setStep(s => s + 1)
    }
  }

  async function submitOnboarding() {
    setIsSubmitting(true)
    try {
      await fetch('/api/onboarding/company', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
    } catch (err) {
      console.error('Onboarding submit failed:', err)
    } finally {
      setIsSubmitting(false)
    }
  }

  function startTeamReveal() {
    // Reveal employees one by one with delays
    EMPLOYEE_ORDER.forEach((_, i) => {
      setTimeout(() => {
        setRevealedEmployees(prev => prev + 1)
      }, 600 + i * 800)
    })
  }

  // ── RENDER ─────────────────────────────────────────────────────────────────

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 24px',
      fontFamily: "'DM Sans', sans-serif",
    }}>

      {/* Logo */}
      <div style={{ marginBottom: 48, fontFamily: "'Syne', sans-serif", fontSize: 22, fontWeight: 800, color: 'var(--text)' }}>
        Sovexa
      </div>

      {/* Progress bar */}
      {step < 6 && (
        <div style={{ width: '100%', maxWidth: 520, marginBottom: 40 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.1em' }}>
              Step {step} of {totalSteps - 1}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{progress}%</span>
          </div>
          <div style={{ height: 2, background: 'var(--border)', borderRadius: 2 }}>
            <div style={{ height: '100%', background: 'var(--text)', borderRadius: 2, width: `${progress}%`, transition: 'width .4s ease' }} />
          </div>
        </div>
      )}

      {/* Step content */}
      <div style={{ width: '100%', maxWidth: 520 }}>

        {step === 1 && (
          <StepWrapper title="Name your company." sub="This is the brand Sovexa will build content for.">
            <input
              autoFocus
              value={data.companyName}
              onChange={e => setData(d => ({ ...d, companyName: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && handleNext()}
              placeholder="e.g. Marcus Fitness, The Wealth Lab, Cook With Me"
              style={inputStyle}
            />
            <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 8 }}>
              This is how your team will refer to your brand.
            </p>
          </StepWrapper>
        )}

        {step === 2 && (
          <StepWrapper title="What do you create?" sub="Your team will specialize in this niche — the language, trends, and strategy all adapt.">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {NICHES.map(n => (
                <button
                  key={n.id}
                  onClick={() => setData(d => ({ ...d, niche: n.id }))}
                  style={{
                    ...cardButtonStyle,
                    borderColor: data.niche === n.id ? 'var(--text)' : 'var(--border)',
                    background: data.niche === n.id ? 'var(--bg-3)' : 'var(--card)',
                  }}
                >
                  <span style={{ fontSize: 24, marginBottom: 8, display: 'block' }}>{n.emoji}</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 4 }}>{n.label}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{n.desc}</span>
                </button>
              ))}
            </div>
          </StepWrapper>
        )}

        {step === 3 && (
          <StepWrapper
            title="Get specific."
            sub="Optional but powerful. The more specific you are, the better your team performs."
          >
            <input
              autoFocus
              value={data.subNiche}
              onChange={e => setData(d => ({ ...d, subNiche: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && handleNext()}
              placeholder={data.niche === 'fitness'
                ? "e.g. Women's strength training, no gym required"
                : data.niche === 'finance'
                ? "e.g. Investing for millennials, beginner-focused"
                : "e.g. Quick weeknight meals for families"
              }
              style={inputStyle}
            />
            <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 8 }}>
              Leave blank to keep it broad — you can refine this later in Settings.
            </p>
          </StepWrapper>
        )}

        {step === 4 && (
          <StepWrapper title="What's your brand voice?" sub="Select all that apply. Your team will write in this style.">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {TONES.map(t => {
                const selected = data.tone.includes(t.id)
                return (
                  <button
                    key={t.id}
                    onClick={() => setData(d => ({
                      ...d,
                      tone: selected ? d.tone.filter(x => x !== t.id) : [...d.tone, t.id]
                    }))}
                    style={{
                      ...cardButtonStyle,
                      borderColor: selected ? 'var(--text)' : 'var(--border)',
                      background: selected ? 'var(--bg-3)' : 'var(--card)',
                      textAlign: 'left',
                      padding: '14px 16px',
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', display: 'block' }}>
                      {selected ? '✓ ' : ''}{t.label}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4, display: 'block' }}>{t.desc}</span>
                  </button>
                )
              })}
            </div>
          </StepWrapper>
        )}

        {step === 5 && (
          <StepWrapper title="What's your main goal?" sub="This shapes how your team thinks about every piece of content.">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {GOALS.map(g => (
                <button
                  key={g.id}
                  onClick={() => setData(d => ({ ...d, goal: g.id }))}
                  style={{
                    ...cardButtonStyle,
                    borderColor: data.goal === g.id ? 'var(--text)' : 'var(--border)',
                    background: data.goal === g.id ? 'var(--bg-3)' : 'var(--card)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    padding: '16px 20px',
                    textAlign: 'left',
                  }}
                >
                  <span style={{ fontSize: 24 }}>{g.emoji}</span>
                  <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)' }}>{g.label}</span>
                  {data.goal === g.id && <span style={{ marginLeft: 'auto', color: 'var(--text)', fontSize: 14 }}>✓</span>}
                </button>
              ))}
            </div>
          </StepWrapper>
        )}

        {step === 6 && (
          <TeamReveal
            companyName={data.companyName}
            niche={data.niche}
            revealedCount={revealedEmployees}
          />
        )}

        {/* CTA */}
        {step < 6 && (
          <div style={{ marginTop: 32, display: 'flex', alignItems: 'center', gap: 16 }}>
            <button
              onClick={handleNext}
              disabled={!canAdvance() || isSubmitting}
              style={{
                padding: '14px 32px',
                borderRadius: 10,
                border: 'none',
                background: canAdvance() ? 'var(--text)' : 'var(--border)',
                color: canAdvance() ? 'var(--text-inv)' : 'var(--text-3)',
                fontFamily: "'Syne', sans-serif",
                fontSize: 15,
                fontWeight: 700,
                cursor: canAdvance() ? 'pointer' : 'not-allowed',
                transition: 'all .2s',
              }}
            >
              {isSubmitting ? 'Setting up your team...' : step === 5 ? 'Meet my team →' : 'Continue →'}
            </button>
            {step > 1 && (
              <button
                onClick={() => setStep(s => s - 1)}
                style={{ background: 'none', border: 'none', color: 'var(--text-3)', fontSize: 14, cursor: 'pointer' }}
              >
                ← Back
              </button>
            )}
            {step === 3 && (
              <button
                onClick={handleNext}
                style={{ background: 'none', border: 'none', color: 'var(--text-3)', fontSize: 14, cursor: 'pointer' }}
              >
                Skip
              </button>
            )}
          </div>
        )}

        {step === 6 && revealedEmployees === 4 && (
          <div style={{ marginTop: 40 }}>
            <button
              onClick={() => router.push('/dashboard')}
              style={{
                width: '100%',
                padding: '16px',
                borderRadius: 10,
                border: 'none',
                background: 'var(--text)',
                color: 'var(--text-inv)',
                fontFamily: "'Syne', sans-serif",
                fontSize: 16,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Go to my dashboard →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── STEP WRAPPER ─────────────────────────────────────────────────────────────

function StepWrapper({ title, sub, children }: {
  title: string
  sub: string
  children: React.ReactNode
}) {
  return (
    <div>
      <h1 style={{
        fontFamily: "'Syne', sans-serif",
        fontSize: 'clamp(28px, 5vw, 40px)',
        fontWeight: 800,
        letterSpacing: '-1.5px',
        color: 'var(--text)',
        marginBottom: 12,
        lineHeight: 1.1,
      }}>
        {title}
      </h1>
      <p style={{ fontSize: 16, color: 'var(--text-2)', marginBottom: 32, lineHeight: 1.6 }}>{sub}</p>
      {children}
    </div>
  )
}

// ─── TEAM REVEAL ──────────────────────────────────────────────────────────────

const EMPLOYEE_WELCOME: Record<EmployeeRole, string> = {
  analyst:          "I've already started scanning your niche for this week's trends. I'll have a report ready by Monday morning.",
  strategist:       "I'm reviewing your goals and audience. Your first content plan will be ready within the hour.",
  copywriter:       "Once Jordan's plan is approved, I'll start writing hooks and scripts. Fair warning — I have strong opinions.",
  creative_director: "I'll turn everything into production-ready direction. Your first shot list comes after Alex delivers the script.",
}

function TeamReveal({ companyName, niche, revealedCount }: {
  companyName: string
  niche: string
  revealedCount: number
}) {
  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <p style={{ fontSize: 13, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 12 }}>
          Your team is ready
        </p>
        <h1 style={{
          fontFamily: "'Syne', sans-serif",
          fontSize: 'clamp(28px, 5vw, 40px)',
          fontWeight: 800,
          letterSpacing: '-1.5px',
          color: 'var(--text)',
          lineHeight: 1.1,
          marginBottom: 12,
        }}>
          {companyName} is open<br />for business.
        </h1>
        <p style={{ fontSize: 15, color: 'var(--text-2)', lineHeight: 1.6 }}>
          Your team has specialized in <strong style={{ color: 'var(--text)' }}>{niche}</strong>. They're already at work.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {EMPLOYEE_ORDER.map((role, i) => {
          const emp = EMPLOYEE_CONFIGS[role]
          const isRevealed = i < revealedCount

          return (
            <div
              key={role}
              style={{
                background: 'var(--card)',
                border: `1px solid ${isRevealed ? 'var(--border-2)' : 'var(--border)'}`,
                borderRadius: 12,
                padding: '20px 20px',
                opacity: isRevealed ? 1 : 0,
                transform: isRevealed ? 'translateY(0)' : 'translateY(12px)',
                transition: 'opacity .5s ease, transform .5s ease',
                display: 'flex',
                gap: 16,
                alignItems: 'flex-start',
              }}
            >
              <div style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: 'var(--bg-3)',
                border: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 20,
                flexShrink: 0,
              }}>
                {emp.emoji}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', fontFamily: "'Syne', sans-serif" }}>
                    {emp.name}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
                    {emp.title}
                  </span>
                </div>
                <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6, margin: 0, fontStyle: 'italic' }}>
                  "{EMPLOYEE_WELCOME[role]}"
                </p>
              </div>
              {isRevealed && (
                <div style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: 'var(--text)',
                  flexShrink: 0,
                  marginTop: 6,
                  animation: 'pulse 2s infinite',
                }} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── STYLES ───────────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '14px 16px',
  background: 'var(--card)',
  border: '1px solid var(--border-2)',
  borderRadius: 10,
  fontSize: 16,
  color: 'var(--text)',
  fontFamily: "'DM Sans', sans-serif",
  outline: 'none',
}

const cardButtonStyle: React.CSSProperties = {
  padding: '20px',
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  cursor: 'pointer',
  textAlign: 'center',
  transition: 'all .2s',
  width: '100%',
}
