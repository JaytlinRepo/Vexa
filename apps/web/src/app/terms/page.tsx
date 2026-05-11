import type { Metadata } from 'next'
import Link from 'next/link'
// vexa-landing.css supplies the :root token set (--bg, --t1, --t2, --t3,
// --accent, --b1...) and the body typography (Inter 15/1.6) that the rest
// of the marketing site uses. Without it, the legal page falls back to
// browser defaults and looks alien to the home page.
import '../vexa-landing.css'
import '../legal.css'

// Standalone Terms page. Linked from the marketing footer at body.html.
//
// IMPORTANT: this is a DRAFT covering the structural sections that
// mainstream SaaS / AI products include (Anthropic, OpenAI, Notion, Buffer,
// Stripe). It has NOT been reviewed by counsel and should not be treated as
// final legal language. Replace before charging customers.
export const metadata: Metadata = {
  title: 'Terms of Service — Sovexa',
  description: 'Terms governing use of Sovexa and its services.',
}

const LAST_UPDATED = '2026-05-08'

export default function TermsPage() {
  return (
    <main className="vx-legal">
      <header className="vx-legal-head">
        <Link href="/" className="vx-legal-back">← Sovexa</Link>
        <h1>Terms of Service</h1>
        <p className="vx-legal-meta">Last updated: {LAST_UPDATED}</p>
      </header>

      <section>
        <h2>1. Agreement to terms</h2>
        <p>
          By creating an account, paying for a subscription, or otherwise using
          Sovexa (the &ldquo;Service&rdquo;), you agree to these Terms of
          Service. If you are using the Service on behalf of a company or
          other legal entity, you represent that you have the authority to
          bind that entity to these terms, and references to &ldquo;you&rdquo;
          mean both you and that entity.
        </p>
      </section>

      <section>
        <h2>2. Eligibility</h2>
        <p>
          You must be at least 18 years old to use the Service. By using
          Sovexa, you confirm that you are 18 or older and that you have the
          legal capacity to enter into these terms in your jurisdiction. The
          Service is not directed to children, and we will close any account
          we discover belongs to a minor.
        </p>
      </section>

      <section>
        <h2>3. The Service</h2>
        <p>
          Sovexa is a software platform that gives content creators an
          AI-powered content team. The Service produces structured outputs
          (trend reports, content plans, production briefs, video assets,
          captions, hooks) on your behalf based on inputs you provide and
          data you authorize us to access from connected platforms.
        </p>
      </section>

      <section>
        <h2>4. Your account</h2>
        <p>
          You are responsible for maintaining the security of your login
          credentials and for all activity that occurs under your account.
          Notify us immediately at{' '}
          <a href="mailto:team@sovexa.ai">team@sovexa.ai</a> if you suspect
          unauthorized access. We may suspend access for violations of these
          terms or where required by law.
        </p>
      </section>

      <section>
        <h2>5. Subscriptions and billing</h2>
        <p>
          Paid plans renew automatically at the interval you selected
          (monthly or annual) unless you cancel. You can cancel anytime
          through the billing portal; cancellation takes effect at the end
          of the current billing period and we do not provide pro-rated
          refunds for partial periods. All fees are in U.S. Dollars and are
          exclusive of taxes you may owe in your jurisdiction. Upon
          cancellation or non-payment, your account is downgraded to the
          Free tier and paid-tier quotas no longer apply.
        </p>
        <p>
          Plan limits — daily tasks, monthly Studio edits, monthly video
          renders, brief cooldowns — reset on the published cadence and do
          not roll over. We may change pricing or plan structure with at
          least 30 days&apos; notice for active subscribers; changes take
          effect at your next renewal.
        </p>
      </section>

      <section>
        <h2>6. Acceptable use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>Use the Service to produce, distribute, or facilitate content that is illegal, infringes intellectual property or other rights, defames any person, harasses or threatens, sexualizes minors, or violates the policies of platforms you publish to.</li>
          <li>Reverse-engineer, decompile, or attempt to extract source code, model weights, prompts, or training data from the Service.</li>
          <li>Scrape, copy, or systematically extract outputs from the Service for the purpose of training a competing AI product or service.</li>
          <li>Use automated means (bots, scripts, headless browsers) to access the Service except through our published APIs and within published rate limits.</li>
          <li>Resell, sublicense, or share access to a single account with multiple individuals or organizations, except as expressly allowed by your plan (e.g. Agency multi-workspace).</li>
          <li>Interfere with the integrity or performance of the Service, attempt to bypass quotas or rate limits, or probe for security vulnerabilities outside an authorized program.</li>
          <li>Misrepresent AI-generated outputs as human-authored where doing so would deceive your audience in a material way.</li>
        </ul>
        <p>
          We may remove content, suspend, or terminate accounts that violate
          this section, with or without notice.
        </p>
      </section>

      <section>
        <h2>7. Your content and outputs</h2>
        <p>
          <strong>Your inputs.</strong> You retain ownership of the brand
          voice, source materials, video uploads, briefs, and other inputs
          you submit. You grant Sovexa a worldwide, non-exclusive,
          royalty-free license to host, copy, transmit, process, and display
          those inputs solely as needed to operate and improve the Service
          for you.
        </p>
        <p>
          <strong>Your outputs.</strong> Subject to your compliance with
          these terms, Sovexa assigns to you any rights it has in the
          structured outputs the Service generates from your inputs (trend
          reports, plans, scripts, captions, video assets, etc.). You are
          responsible for whether the outputs are lawful and appropriate to
          publish in your context.
        </p>
        <p>
          <strong>Similar outputs to others.</strong> Because outputs are
          produced statistically, similar inputs by different users may
          generate similar outputs. We do not assign you exclusive rights
          against other users who independently generated comparable
          material.
        </p>
        <p>
          <strong>We will not train external models on your data.</strong>{' '}
          Inputs and outputs are sent to our AI providers (currently AWS
          Bedrock running Anthropic Claude models) under contractual terms
          that prohibit those providers from using your data to train their
          general models.
        </p>
      </section>

      <section>
        <h2>8. Feedback</h2>
        <p>
          If you submit suggestions, feature requests, or other feedback
          about the Service, you grant us a perpetual, irrevocable,
          royalty-free license to use that feedback for any purpose,
          including improving the Service. Feedback is non-confidential and
          we are under no obligation to compensate you for it.
        </p>
      </section>

      <section>
        <h2>9. AI-generated outputs &mdash; reliance and accuracy</h2>
        <p>
          Outputs produced by the Service are generated by large language
          models and other AI systems. They may contain inaccuracies,
          fabricated facts, biased framing, or material that requires
          editorial judgment. You should not rely on any output without
          independently verifying its accuracy and appropriateness.{' '}
          <strong>You are solely responsible for reviewing every output
          before publication or external use</strong> and for ensuring it
          complies with applicable law, the policies of the platforms you
          post to, and any contractual obligations you have to third parties.
        </p>
      </section>

      <section>
        <h2>10. Third-party integrations</h2>
        <p>
          The Service connects to platforms including Instagram, TikTok,
          and Stripe. By authorizing a connection, you allow Sovexa to read
          (and where you direct, write) data through those platforms&apos;
          APIs under their terms. Sovexa is not responsible for the
          availability, behavior, or terms of third-party platforms, and
          interruptions in their services may interrupt features that
          depend on them. You can disconnect any integration from
          Settings &rarr; Integrations.
        </p>
      </section>

      <section>
        <h2>11. Beta and preview features</h2>
        <p>
          We may label certain features as &ldquo;beta&rdquo;, &ldquo;preview
          &rdquo;, or &ldquo;early access.&rdquo; These features are provided
          as-is, may be unstable or change without notice, may have reduced
          quotas or rate limits, and may be removed entirely. We make no
          guarantees about beta features and limit our liability accordingly.
        </p>
      </section>

      <section>
        <h2>12. Modifications to the Service</h2>
        <p>
          We are continuously improving Sovexa. We may add, change, or
          remove features at any time. For material changes that reduce the
          value you receive on a paid plan, we will provide reasonable
          advance notice (typically at least 30 days) and allow you to
          cancel for a pro-rated refund of the affected period.
        </p>
      </section>

      <section>
        <h2>13. Suspension and termination</h2>
        <p>
          You may terminate your account at any time from Settings. Upon
          termination, your subscription stops renewing, your account is
          downgraded to Free at the end of the current period, and we
          retain your data per Section 8 of our{' '}
          <Link href="/privacy">Privacy Policy</Link>.
        </p>
        <p>
          We may suspend or terminate your access immediately if (a) you
          violate these terms or our Acceptable Use list, (b) your account
          is delinquent on fees and remains so after at least 14 days of
          notice, (c) we are required to do so by law, or (d) we believe
          in good faith that suspension is necessary to protect the safety
          or rights of users, third parties, or the integrity of the
          Service. Where reasonable and consistent with the violation, we
          will give you advance notice and an opportunity to cure.
        </p>
      </section>

      <section>
        <h2>14. Disclaimer of warranties</h2>
        <p>
          THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS
          AVAILABLE&rdquo; WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR
          IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
          PARTICULAR PURPOSE, NON-INFRINGEMENT, OR THAT THE SERVICE WILL BE
          UNINTERRUPTED, SECURE, OR ERROR-FREE. We make no specific
          guarantees about outcomes such as follower growth, engagement
          rates, reach, revenue, or platform performance.
        </p>
      </section>

      <section>
        <h2>15. Limitation of liability</h2>
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, NEITHER SOVEXA NOR ITS
          AFFILIATES, OFFICERS, EMPLOYEES, OR SERVICE PROVIDERS WILL BE
          LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR
          PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, REVENUES, DATA, OR
          GOODWILL, ARISING OUT OF OR RELATING TO YOUR USE OF THE SERVICE.
        </p>
        <p>
          OUR TOTAL AGGREGATE LIABILITY ARISING OUT OF OR RELATED TO THESE
          TERMS OR THE SERVICE WILL NOT EXCEED THE GREATER OF (a) THE
          AMOUNT YOU PAID US IN THE TWELVE MONTHS PRECEDING THE EVENT
          GIVING RISE TO THE CLAIM, OR (b) ONE HUNDRED U.S. DOLLARS
          ($100.00). These limits apply even if a remedy fails of its
          essential purpose. Some jurisdictions do not allow some of these
          exclusions, so they may not apply to you in full.
        </p>
      </section>

      <section>
        <h2>16. Indemnification</h2>
        <p>
          You agree to defend, indemnify, and hold harmless Sovexa, its
          affiliates, and its officers, employees, and service providers
          from and against any claims, damages, liabilities, costs, and
          expenses (including reasonable attorneys&apos; fees) arising out
          of or related to (a) your use of the Service, (b) your violation
          of these terms, (c) your violation of any third party&apos;s
          rights including intellectual property, privacy, or publicity
          rights, or (d) any content you submit to the Service or
          publish using outputs generated by the Service.
        </p>
      </section>

      <section>
        <h2>17. Modifications to these terms</h2>
        <p>
          We may update these terms from time to time. Material changes
          will be communicated by email or in-product notification at
          least 14 days before they take effect. Continued use of the
          Service after the effective date constitutes acceptance of the
          updated terms. If you do not agree to the changes, your remedy
          is to stop using the Service before the effective date.
        </p>
      </section>

      <section>
        <h2>18. Governing law</h2>
        <p>
          These terms and any dispute arising from them are governed by the
          laws of the State of Georgia, without regard to its
          conflict-of-laws principles. The United Nations Convention on
          Contracts for the International Sale of Goods does not apply.
        </p>
      </section>

      <section>
        <h2>19. Dispute resolution</h2>
        <p>
          <strong>Informal resolution first.</strong> Before filing a claim,
          you agree to try to resolve the dispute informally by contacting{' '}
          <a href="mailto:team@sovexa.ai">team@sovexa.ai</a> with a
          description of the dispute. We&apos;ll work in good faith to
          resolve it within 30 days.
        </p>
        <p>
          <strong>Binding arbitration.</strong> If the dispute is not
          resolved informally, you and Sovexa agree to resolve it through
          binding individual arbitration administered by JAMS under its
          Streamlined Arbitration Rules. Arbitration takes place in
          Atlanta, Georgia, or by video conference. Either party may
          seek emergency injunctive relief in court.
        </p>
        <p>
          <strong>Class action waiver.</strong> Disputes will be resolved
          on an individual basis only. You waive the right to participate
          in any class, collective, or representative action against
          Sovexa.
        </p>
        <p>
          <strong>Opt-out.</strong> You may opt out of arbitration by
          sending written notice to team@sovexa.ai within 30 days of first
          accepting these terms. Opting out does not affect any other
          provision.
        </p>
      </section>

      <section>
        <h2>20. Force majeure</h2>
        <p>
          Neither party is liable for failure or delay in performance to
          the extent caused by events beyond reasonable control, including
          natural disasters, pandemics, war, terrorism, civil unrest,
          government action, labor disputes, internet service provider or
          cloud provider outages (including AWS, Stripe, or third-party
          social platforms), or AI provider failures.
        </p>
      </section>

      <section>
        <h2>21. General terms</h2>
        <p>
          <strong>Entire agreement.</strong> These terms, together with the{' '}
          <Link href="/privacy">Privacy Policy</Link> and any plan-specific
          ordering documents, constitute the entire agreement between you
          and Sovexa regarding the Service.
        </p>
        <p>
          <strong>Severability.</strong> If any provision is held
          unenforceable, the remaining provisions remain in full force.
        </p>
        <p>
          <strong>No waiver.</strong> Our failure to enforce a right is
          not a waiver of that right.
        </p>
        <p>
          <strong>Assignment.</strong> You may not assign these terms
          without our prior written consent. We may assign these terms in
          connection with a merger, acquisition, or sale of all or
          substantially all of our assets.
        </p>
        <p>
          <strong>Notices.</strong> We may give you notice by email,
          in-product message, or by posting on the Service. You give us
          notice at <a href="mailto:team@sovexa.ai">team@sovexa.ai</a>.
        </p>
      </section>

      <section>
        <h2>22. Contact</h2>
        <p>
          Questions about these terms? Email{' '}
          <a href="mailto:team@sovexa.ai">team@sovexa.ai</a>.
        </p>
      </section>
    </main>
  )
}
