/**
 * Email Service — powered by Resend
 *
 * Cost: FREE up to 3,000 emails/month. Then $20/mo.
 * Perfect for launch — covers welcome, notifications, weekly digests.
 * Sign up: https://resend.com
 * Install: npm install resend
 *
 * All emails are plain HTML — no heavy template engine needed.
 * Keep emails simple: one purpose, one action, minimal design.
 */

import { Resend } from 'resend'
import { EMPLOYEE_CONFIGS, EmployeeRole } from '@vexa/types'

const resend = new Resend(process.env.RESEND_API_KEY || '')
const FROM = 'Sovexa <team@sovexa.ai>'
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.sovexa.ai'

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface EmailResult {
  success: boolean
  id?: string
  error?: string
}

// ─── BASE TEMPLATE ────────────────────────────────────────────────────────────

function baseTemplate(content: string, preheader = ''): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sovexa</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'DM Sans',Helvetica,Arial,sans-serif">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden">${preheader}</div>` : ''}
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;min-height:100vh">
  <tr><td align="center" style="padding:40px 20px">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

      <!-- LOGO -->
      <tr><td style="padding-bottom:32px">
        <span style="font-family:Georgia,serif;font-size:24px;font-weight:bold;color:#f5f5f5;letter-spacing:-1px">Sovexa</span>
      </td></tr>

      <!-- CONTENT -->
      <tr><td style="background:#161616;border:1px solid #252525;border-radius:16px;padding:40px">
        ${content}
      </td></tr>

      <!-- FOOTER -->
      <tr><td style="padding-top:32px;text-align:center">
        <p style="color:#555;font-size:12px;margin:0">
          © 2025 Sovexa · <a href="${BASE_URL}/settings" style="color:#555">Manage notifications</a> · <a href="%unsubscribe_url%" style="color:#555">Unsubscribe</a>
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`
}

function h1(text: string): string {
  return `<h1 style="margin:0 0 16px;font-size:28px;font-weight:800;color:#f5f5f5;letter-spacing:-1px;line-height:1.1">${text}</h1>`
}

function p(text: string, muted = false): string {
  return `<p style="margin:0 0 16px;font-size:15px;color:${muted ? '#a0a0a0' : '#c0c0c0'};line-height:1.7">${text}</p>`
}

function btn(text: string, url: string): string {
  return `<a href="${url}" style="display:inline-block;margin-top:8px;padding:14px 28px;background:#f5f5f5;color:#0a0a0a;font-family:Georgia,serif;font-size:14px;font-weight:bold;text-decoration:none;border-radius:8px">${text}</a>`
}

function divider(): string {
  return `<div style="border-top:1px solid #252525;margin:28px 0"></div>`
}

function tag(text: string): string {
  return `<span style="display:inline-block;padding:4px 10px;background:#1e1e1e;border:1px solid #333;border-radius:6px;font-size:12px;color:#a0a0a0;margin-right:6px">${text}</span>`
}

// ─── 1. WELCOME EMAIL ─────────────────────────────────────────────────────────

export async function sendWelcomeEmail(params: {
  to: string
  firstName: string
  companyName: string
  niche: string
}): Promise<EmailResult> {
  const { to, firstName, companyName, niche } = params

  const content = `
    ${h1(`Welcome to Sovexa, ${firstName}.`)}
    ${p(`Your content company <strong style="color:#f5f5f5">${companyName}</strong> is live. Your team knows your niche and they're already at work.`)}
    ${divider()}
    <p style="margin:0 0 12px;font-size:13px;font-weight:600;color:#555;text-transform:uppercase;letter-spacing:.08em">Your team</p>
    <table width="100%" cellpadding="0" cellspacing="0">
      ${(['analyst','strategist','copywriter','creative_director'] as EmployeeRole[]).map(role => {
        const emp = EMPLOYEE_CONFIGS[role]
        return `<tr><td style="padding:10px 0;border-bottom:1px solid #1e1e1e">
          <span style="font-size:18px">${emp.emoji}</span>
          <span style="margin-left:10px;font-size:14px;font-weight:600;color:#f5f5f5">${emp.name}</span>
          <span style="margin-left:8px;font-size:12px;color:#555">${emp.title}</span>
        </td></tr>`
      }).join('')}
    </table>
    ${divider()}
    ${p(`Maya has already started scanning ${niche} trends. Check your dashboard to see what she's found.`, true)}
    ${btn('Go to my dashboard →', `${BASE_URL}/dashboard`)}
  `

  return send({
    to,
    subject: `${companyName} is open for business`,
    html: baseTemplate(content, `Your AI content team is ready. Maya is already scanning ${niche} trends.`),
  })
}

// ─── 2. WEEKLY TREND DIGEST ───────────────────────────────────────────────────

export async function sendWeeklyTrendDigest(params: {
  to: string
  firstName: string
  companyName: string
  niche: string
  trends: Array<{
    topic: string
    growthPercent: number
    whyItMatters: string
    suggestedHook: string
    urgency: 'high' | 'medium' | 'low'
  }>
  topOpportunity: string
}): Promise<EmailResult> {
  const { to, firstName, companyName, niche, trends, topOpportunity } = params

  const urgencyLabel = (u: string) => u === 'high' ? '🔥 Act this week' : u === 'medium' ? '📈 Growing' : '👀 Watch'

  const trendCards = trends.slice(0, 3).map(t => `
    <tr><td style="padding:16px;background:#1e1e1e;border-radius:10px;margin-bottom:10px;display:block">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <span style="font-size:14px;font-weight:700;color:#f5f5f5">${t.topic}</span>
        <span style="font-size:12px;color:#a0a0a0">${urgencyLabel(t.urgency)} · ↑${t.growthPercent}%</span>
      </div>
      <p style="margin:0 0 10px;font-size:13px;color:#a0a0a0;line-height:1.6">${t.whyItMatters}</p>
      <p style="margin:0;font-size:13px;color:#666;font-style:italic">Hook → "${t.suggestedHook}"</p>
    </td></tr>
    <tr><td style="height:8px"></td></tr>
  `).join('')

  const content = `
    ${p(`Good morning, ${firstName}. Maya's weekly report for <strong style="color:#f5f5f5">${companyName}</strong>.`, true)}
    ${h1(`This week in ${niche}.`)}
    ${p(`<strong style="color:#f5f5f5">Maya's top pick:</strong> ${topOpportunity}`)}
    ${divider()}
    <p style="margin:0 0 16px;font-size:13px;font-weight:600;color:#555;text-transform:uppercase;letter-spacing:.08em">Trending this week</p>
    <table width="100%" cellpadding="0" cellspacing="0">${trendCards}</table>
    ${divider()}
    ${p(`Jordan has already drafted a content plan around these trends. Ready to approve?`, true)}
    ${btn('Review this week\'s plan →', `${BASE_URL}/dashboard/strategy`)}
  `

  return send({
    to,
    subject: `Maya's report: what's trending in ${niche} this week`,
    html: baseTemplate(content, topOpportunity),
  })
}

// ─── 3. OUTPUT DELIVERED NOTIFICATION ────────────────────────────────────────

export async function sendOutputDeliveredEmail(params: {
  to: string
  firstName: string
  employeeName: string
  employeeRole: EmployeeRole
  employeeEmoji: string
  outputType: string
  outputSummary: string
  taskId: string
}): Promise<EmailResult> {
  const { to, firstName, employeeName, employeeEmoji, outputType, outputSummary, taskId } = params

  const content = `
    ${p(`Hey ${firstName},`, true)}
    ${h1(`${employeeEmoji} ${employeeName} just delivered.`)}
    ${p(`New <strong style="color:#f5f5f5">${outputType}</strong> ready for your review.`)}
    <div style="background:#1e1e1e;border:1px solid #333;border-radius:10px;padding:20px;margin:20px 0">
      <p style="margin:0;font-size:14px;color:#a0a0a0;line-height:1.6;font-style:italic">"${outputSummary}"</p>
    </div>
    ${p('Approve, request changes, or call a meeting. Your team is waiting.', true)}
    ${btn('Review output →', `${BASE_URL}/dashboard/tasks/${taskId}`)}
  `

  return send({
    to,
    subject: `${employeeName} delivered: ${outputType}`,
    html: baseTemplate(content, `${employeeName} has new ${outputType} ready for your review.`),
  })
}

// ─── 4. MEETING SUMMARY EMAIL ─────────────────────────────────────────────────

export async function sendMeetingSummaryEmail(params: {
  to: string
  firstName: string
  employeeName: string
  employeeEmoji: string
  summary: string
  decisions: Array<{ decision: string; actionItem?: string }>
  tasksCreated: number
  meetingId: string
}): Promise<EmailResult> {
  const { to, firstName, employeeName, employeeEmoji, summary, decisions, tasksCreated, meetingId } = params

  const decisionItems = decisions.map(d => `
    <tr><td style="padding:10px 0;border-bottom:1px solid #1e1e1e">
      <p style="margin:0 0 4px;font-size:14px;color:#f5f5f5">✓ ${d.decision}</p>
      ${d.actionItem ? `<p style="margin:0;font-size:12px;color:#555">→ ${d.actionItem}</p>` : ''}
    </td></tr>
  `).join('')

  const content = `
    ${p(`Meeting with ${employeeEmoji} ${employeeName} · Summary`, true)}
    ${h1('Here\'s what was decided.')}
    <div style="background:#1e1e1e;border-left:2px solid #333;padding:16px 20px;margin:20px 0;border-radius:0 8px 8px 0">
      <p style="margin:0;font-size:14px;color:#a0a0a0;line-height:1.7">${summary}</p>
    </div>
    ${decisions.length ? `
      <p style="margin:0 0 12px;font-size:13px;font-weight:600;color:#555;text-transform:uppercase;letter-spacing:.08em">Decisions made</p>
      <table width="100%" cellpadding="0" cellspacing="0">${decisionItems}</table>
      ${divider()}
    ` : ''}
    ${tasksCreated > 0 ? p(`<strong style="color:#f5f5f5">${tasksCreated} task${tasksCreated > 1 ? 's' : ''}</strong> were created automatically from this meeting.`, true) : ''}
    ${btn('View tasks →', `${BASE_URL}/dashboard/tasks`)}
  `

  return send({
    to,
    subject: `Meeting summary: ${employeeName}`,
    html: baseTemplate(content, summary),
  })
}

// ─── 5. TRIAL ENDING REMINDER ────────────────────────────────────────────────

export async function sendTrialEndingEmail(params: {
  to: string
  firstName: string
  daysLeft: number
  tasksCompleted: number
  outputsApproved: number
}): Promise<EmailResult> {
  const { to, firstName, daysLeft, tasksCompleted, outputsApproved } = params

  const content = `
    ${h1(daysLeft === 1 ? 'Last day of your trial.' : `${daysLeft} days left on your trial.`)}
    ${p(`Your team has completed <strong style="color:#f5f5f5">${tasksCompleted} tasks</strong> and you've approved <strong style="color:#f5f5f5">${outputsApproved} outputs</strong> during your trial.`)}
    ${p(`After your trial ends, your team pauses. All your outputs, brand memory, and settings are saved — pick up exactly where you left off when you subscribe.`, true)}
    ${divider()}
    ${btn('Continue with Pro →', `${BASE_URL}/pricing`)}
    ${p(`Questions? Just reply to this email.`, true)}
  `

  return send({
    to,
    subject: daysLeft === 1 ? `Your Sovexa trial ends tomorrow` : `${daysLeft} days left — keep your team`,
    html: baseTemplate(content, `Your team has been busy. Don't let the momentum stop.`),
  })
}

// ─── 6. PAYMENT FAILED ────────────────────────────────────────────────────────

export async function sendPaymentFailedEmail(params: {
  to: string
  firstName: string
}): Promise<EmailResult> {
  const { to, firstName } = params

  const content = `
    ${h1('Payment failed.')}
    ${p(`Hey ${firstName} — we couldn't process your payment. Your team is still active while you sort this out.`)}
    ${p(`Update your payment method to keep everything running without interruption.`, true)}
    ${btn('Update payment method →', `${BASE_URL}/settings/billing`)}
  `

  return send({
    to,
    subject: 'Action required: payment failed',
    html: baseTemplate(content, 'Update your payment method to keep your team running.'),
  })
}

// ─── CORE SEND ────────────────────────────────────────────────────────────────

async function send(params: {
  to: string
  subject: string
  html: string
  replyTo?: string
}): Promise<EmailResult> {
  try {
    const { data, error } = await resend.emails.send({
      from: FROM,
      to: params.to,
      subject: params.subject,
      html: params.html,
      reply_to: params.replyTo || 'support@sovexa.ai',
    })

    if (error) {
      console.error('Resend error:', error)
      return { success: false, error: error.message }
    }

    return { success: true, id: data?.id }
  } catch (err) {
    console.error('Email send failed:', err)
    return { success: false, error: String(err) }
  }
}
