import type { Metadata } from 'next'
import Link from 'next/link'
// vexa-landing.css supplies the :root token set (--bg, --t1, --t2, --t3,
// --accent, --b1...) and the body typography (Inter 15/1.6) that the rest
// of the marketing site uses. Without it, the legal page falls back to
// browser defaults and looks alien to the home page.
import '../vexa-landing.css'
import '../legal.css'

// Standalone Privacy page. Linked from the marketing footer at body.html.
//
// IMPORTANT: this is a DRAFT covering the structural sections that
// mainstream SaaS / AI products include (Anthropic, OpenAI, Notion, Buffer,
// Stripe). It has NOT been reviewed by counsel and should not be treated as
// final legal language. Replace before charging customers, especially the
// CCPA, GDPR, and cross-border transfer sections, which have legal
// implications specific to your jurisdictions of operation.
export const metadata: Metadata = {
  title: 'Privacy Policy — Sovexa',
  description: 'How Sovexa collects, uses, and protects your information.',
}

const LAST_UPDATED = '2026-05-08'

export default function PrivacyPage() {
  return (
    <main className="vx-legal">
      <header className="vx-legal-head">
        <Link href="/" className="vx-legal-back">← Sovexa</Link>
        <h1>Privacy Policy</h1>
        <p className="vx-legal-meta">Last updated: {LAST_UPDATED}</p>
      </header>

      <section>
        <h2>1. What this policy covers</h2>
        <p>
          This policy explains what information Sovexa collects about you,
          how we use it, who we share it with, and your choices. It
          applies to the Sovexa product (sovexa.ai, app.sovexa.ai, and
          our APIs). It does not apply to third-party services we
          integrate with — those operate under their own privacy
          policies.
        </p>
      </section>

      <section>
        <h2>2. Information you give us</h2>
        <ul>
          <li>Account details — name, email, password hash, profile photo (optional).</li>
          <li>Onboarding inputs — niche tags, brand voice description, audience description, content goals.</li>
          <li>Content you upload — videos and images for the Studio pipeline, written briefs, meeting transcripts you create.</li>
          <li>Payment information — billing address and card details you provide to our processor (Stripe). Sovexa does not see, store, or transmit raw card numbers.</li>
          <li>Communications — emails, support tickets, and feedback you send us.</li>
        </ul>
      </section>

      <section>
        <h2>3. Information from connected platforms</h2>
        <p>
          When you connect Instagram, TikTok, or another platform, we
          receive read-only data the platform exposes under its API:
          account profile, follower counts, post history, engagement
          metrics, audience demographics where available, and similar
          metadata. We use this to populate your dashboard and to give
          your AI team accurate context when generating outputs. You can
          disconnect at any time from{' '}
          <strong>Settings &rarr; Integrations</strong>; we stop pulling
          new data immediately, and previously synced data is retained
          per Section 13 (Retention).
        </p>
      </section>

      <section>
        <h2>4. Information we collect automatically</h2>
        <ul>
          <li>Usage logs — which features you used and when, errors encountered, action button clicks, output approvals/rejections, brief cooldown timestamps.</li>
          <li>Device and browser metadata — IP address, browser type, operating system, screen resolution, referring URL, timestamps.</li>
          <li>Performance and reliability telemetry — request latency, error rates, queue depths, used to operate and improve the Service.</li>
        </ul>
      </section>

      <section>
        <h2>5. Cookies and tracking technologies</h2>
        <p>
          Sovexa uses a small number of first-party cookies and browser
          local storage entries to operate the Service. We do not use
          third-party advertising or cross-site tracking cookies.
        </p>
        <ul>
          <li><strong>Authentication cookies</strong> — httpOnly session cookies that keep you signed in. Required for the Service to function.</li>
          <li><strong>Preference storage</strong> — localStorage entries for theme, billing toggle, dashboard layout, profile photo. Local to your browser and never transmitted to our servers.</li>
          <li><strong>Stripe processor cookies</strong> — set by Stripe during checkout. Subject to{' '}
            <a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer">Stripe&apos;s Privacy Policy</a>.</li>
        </ul>
        <p>
          You can clear cookies through your browser settings, but doing
          so will sign you out and reset preferences.
        </p>
      </section>

      <section>
        <h2>6. How we use your information</h2>
        <ul>
          <li>To deliver the Service — generate outputs, sync platform data, send notifications, render the dashboard.</li>
          <li>To meter and enforce plan limits (daily tasks, monthly Studio edits, monthly video renders, brief cooldowns).</li>
          <li>To process payments and handle subscription changes.</li>
          <li>To improve product reliability, detect abuse, and prevent fraud.</li>
          <li>To communicate with you about your account, billing, important product updates, and legal notices.</li>
          <li>To comply with legal obligations.</li>
        </ul>
      </section>

      <section>
        <h2>7. Legal bases for processing (EEA, UK, Switzerland)</h2>
        <p>
          For users in the European Economic Area, United Kingdom, or
          Switzerland, we rely on the following legal bases under Article 6
          GDPR / UK GDPR:
        </p>
        <ul>
          <li><strong>Contract</strong> — we process account, content, and integration data to deliver the Service you signed up for.</li>
          <li><strong>Legitimate interests</strong> — we use telemetry, abuse prevention, and product improvement data to keep the Service reliable and secure, balanced against your privacy interests.</li>
          <li><strong>Legal obligation</strong> — we process data we are required by law to retain (tax, accounting, fraud-prevention).</li>
          <li><strong>Consent</strong> — where required (e.g. optional marketing emails), we ask for consent and you can withdraw it at any time.</li>
        </ul>
      </section>

      <section>
        <h2>8. AI providers</h2>
        <p>
          The Service relies on AI model providers (currently AWS Bedrock
          running Anthropic Claude models). When the Service generates an
          output, your inputs and relevant context are transmitted to the
          provider for inference and the response is returned to us. Our
          contract with the provider prohibits using your data to train
          their general models, and the provider deletes inputs and
          outputs from its operational systems within a short retention
          window.{' '}
          <strong>We do not use your data to train any external AI model
          and we do not sell it.</strong>
        </p>
      </section>

      <section>
        <h2>9. How we share information</h2>
        <p>We share information only in these limited situations:</p>
        <ul>
          <li><strong>Service providers</strong> — cloud hosting (AWS), email delivery (Resend), payment processing (Stripe), analytics, and AI inference (AWS Bedrock / Anthropic). Each operates under contracts that restrict them to providing the service we engage them for.</li>
          <li><strong>Legal compliance</strong> — to comply with subpoenas, court orders, or other binding legal process.</li>
          <li><strong>Protection of rights</strong> — to enforce our Terms, prevent fraud or harm, or defend legal claims.</li>
          <li><strong>Business transfers</strong> — in connection with a merger, acquisition, financing, or sale of all or substantially all of our assets, in which case the acquirer assumes the obligations of this policy.</li>
        </ul>
        <p>
          <strong>We do not sell personal information.</strong>
        </p>
      </section>

      <section>
        <h2>10. International data transfers</h2>
        <p>
          Sovexa&apos;s servers and most of our service providers are
          located in the United States. If you access the Service from
          outside the U.S., your information will be transferred to the
          U.S. for processing. Where the law of your jurisdiction
          requires additional safeguards for cross-border transfers, we
          rely on:
        </p>
        <ul>
          <li>EU Standard Contractual Clauses for transfers from the EEA, UK, or Switzerland.</li>
          <li>The EU&ndash;U.S. Data Privacy Framework where applicable.</li>
          <li>Equivalent contractual safeguards for other jurisdictions (e.g. Brazil, Canada).</li>
        </ul>
      </section>

      <section>
        <h2>11. Studio uploads and source video</h2>
        <p>
          When you upload a video to the Studio pipeline, we store the
          source file in our object storage so Riley (the creative
          director agent) can analyze it and produce clips, captions,
          and visual direction. We automatically purge the source video
          from our systems after the rendering pipeline completes. The
          rendered clips you keep remain available in your library
          until you delete them or close your account.
        </p>
      </section>

      <section>
        <h2>12. Brand memory</h2>
        <p>
          To improve future agent outputs, Sovexa maintains a
          per-company &ldquo;brand memory&rdquo; store of decisions you
          approve, voice rules, and feedback signals. This memory is
          private to your workspace and is never shared with other
          users or used to train external models. You can view and
          delete entries at any time from{' '}
          <strong>Settings &rarr; Brand Memory</strong>.
        </p>
      </section>

      <section>
        <h2>13. Data retention</h2>
        <p>
          We retain account information for as long as your account is
          open. After cancellation or deletion, we keep data for a
          reasonable period to satisfy legal, accounting, fraud-prevention,
          and dispute-resolution obligations &mdash; typically up to 24
          months for billing records, shorter for content. Specific
          retention windows:
        </p>
        <ul>
          <li>Studio source videos: purged automatically after rendering completes.</li>
          <li>Operational logs / telemetry: 90 days.</li>
          <li>Notifications: 30 days after read.</li>
          <li>Tasks and outputs: retained while your account is active; deleted within 90 days of account closure.</li>
          <li>Billing and tax records: 7 years (statutory).</li>
        </ul>
      </section>

      <section>
        <h2>14. Security</h2>
        <p>
          We use industry-standard practices including TLS in transit,
          encryption at rest for databases and object storage,
          least-privilege IAM controls, and secret management via AWS
          Systems Manager. We log access to sensitive operations.
          No system is perfectly secure; please notify us promptly at{' '}
          <a href="mailto:team@sovexa.ai">team@sovexa.ai</a> if you
          suspect any breach affecting your account.
        </p>
      </section>

      <section>
        <h2>15. Your rights (general)</h2>
        <p>Depending on where you live, you may have the right to:</p>
        <ul>
          <li>Access the personal information we hold about you.</li>
          <li>Correct inaccuracies.</li>
          <li>Export your data in a portable format.</li>
          <li>Delete your account and associated data.</li>
          <li>Object to or restrict certain processing.</li>
          <li>Withdraw consent for processing based on consent.</li>
          <li>Lodge a complaint with a data protection authority.</li>
        </ul>
        <p>
          You can exercise most of these rights from{' '}
          <strong>Settings</strong>. For the rest, email{' '}
          <a href="mailto:team@sovexa.ai">team@sovexa.ai</a>.
        </p>
      </section>

      <section>
        <h2>16. California privacy rights</h2>
        <p>
          If you are a California resident, the California Consumer
          Privacy Act (CCPA), as amended by the CPRA, gives you specific
          rights regarding your personal information:
        </p>
        <ul>
          <li><strong>Right to know</strong> what categories of personal information we collect, the sources, the purposes, and the third parties we share with.</li>
          <li><strong>Right to delete</strong> personal information we collected from you, subject to legal exceptions.</li>
          <li><strong>Right to correct</strong> inaccurate personal information.</li>
          <li><strong>Right to opt out</strong> of the &ldquo;sale&rdquo; or &ldquo;sharing&rdquo; of personal information for cross-context behavioral advertising. <strong>Sovexa does not sell or share your personal information for these purposes.</strong></li>
          <li><strong>Right to limit use</strong> of sensitive personal information.</li>
          <li><strong>Right to non-discrimination</strong> for exercising any of these rights.</li>
        </ul>
        <p>
          To exercise these rights, email{' '}
          <a href="mailto:team@sovexa.ai">team@sovexa.ai</a>. We will
          verify your identity through your account email before
          fulfilling deletion or access requests.
        </p>
      </section>

      <section>
        <h2>17. EEA, UK, and Swiss residents (GDPR)</h2>
        <p>
          In addition to the rights in Section 15, residents of the EEA,
          UK, and Switzerland have specific rights under the GDPR / UK
          GDPR. The legal bases on which we process your data are
          described in Section 7. You have the right to lodge a
          complaint with your local data protection authority. For
          requests, email{' '}
          <a href="mailto:team@sovexa.ai">team@sovexa.ai</a>; we
          respond within 30 days as required.
        </p>
      </section>

      <section>
        <h2>18. Other regional notices</h2>
        <p>
          We comply with applicable data protection laws in jurisdictions
          where we operate, including the LGPD (Brazil), PIPEDA (Canada),
          and the DPDPA (India). Specific contact procedures are
          available on request.
        </p>
      </section>

      <section>
        <h2>19. Children</h2>
        <p>
          Sovexa is not directed to children. We do not knowingly
          collect personal information from anyone under 18 years old.
          If you believe a child has created an account, contact{' '}
          <a href="mailto:team@sovexa.ai">team@sovexa.ai</a> and we
          will investigate and delete the account promptly.
        </p>
      </section>

      <section>
        <h2>20. Changes to this policy</h2>
        <p>
          We may update this policy from time to time. Material changes
          will be announced via email or in-product notification at
          least 14 days before they take effect. The &ldquo;Last
          updated&rdquo; date at the top reflects the most recent
          revision.
        </p>
      </section>

      <section>
        <h2>21. Contact</h2>
        <p>
          Questions about your privacy or this policy? Email{' '}
          <a href="mailto:team@sovexa.ai">team@sovexa.ai</a>. For
          GDPR-related requests, please mark your email{' '}
          <em>&ldquo;GDPR request.&rdquo;</em>
        </p>
      </section>
    </main>
  )
}
