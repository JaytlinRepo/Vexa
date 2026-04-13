import Link from 'next/link'
import { EMPLOYEE_CONFIGS, EmployeeRole } from '@vexa/types'

const ROLES: EmployeeRole[] = ['analyst', 'strategist', 'copywriter', 'creative_director']

export default function LandingPage() {
  return (
    <main className="min-h-screen">
      <section className="mx-auto max-w-5xl px-6 pt-24 pb-16">
        <p className="text-text-3 text-sm uppercase tracking-widest">Vexa</p>
        <h1 className="mt-4 text-5xl md:text-7xl font-heading font-semibold leading-[1.05]">
          Your content.
          <br />
          <span style={{ color: 'var(--accent)' }}>Run by a team.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-text-2">
          Vexa gives every creator a full AI workforce — a Trend Analyst, Content Strategist,
          Copywriter, and Creative Director. You are the CEO. You approve, redirect, and call
          meetings. Your team does everything else.
        </p>
        <div className="mt-10 flex gap-4">
          <Link
            href="/auth/onboarding"
            className="px-6 py-3 rounded-lg font-medium"
            style={{ background: 'var(--accent)', color: 'var(--text-inv)' }}
          >
            Start your company
          </Link>
          <a
            href="https://github.com/JaytlinRepo/Vexa"
            className="px-6 py-3 rounded-lg font-medium border border-border-2"
          >
            View on GitHub
          </a>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-24">
        <h2 className="text-2xl font-heading mb-8">Meet the team</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {ROLES.map((role) => {
            const e = EMPLOYEE_CONFIGS[role]
            return (
              <div
                key={role}
                className="rounded-xl p-6 border"
                style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="h-12 w-12 rounded-lg grid place-items-center text-2xl"
                    style={{ background: 'var(--bg-3)' }}
                  >
                    {e.emoji}
                  </div>
                  <div>
                    <div className="font-heading text-lg">{e.name}</div>
                    <div className="text-text-3 text-sm">{e.title}</div>
                  </div>
                </div>
                <p className="mt-4 text-text-2 text-sm">{e.personality}</p>
              </div>
            )
          })}
        </div>
      </section>
    </main>
  )
}
