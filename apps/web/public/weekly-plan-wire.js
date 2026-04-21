/**
 * Weekly Plan Wire
 *
 * Displays: Jordan's weekly content strategy (7-day plan with rationale)
 * Rendered Sunday 6:30 PM when Jordan's plan is available
 * Features: Approval/rejection UI, ability to modify plan
 */

export function renderWeeklyPlan(planTask) {
  const output = planTask.outputs?.[0]?.content || {}
  const plan = output.contentPlan || []
  const goal = output.weeklyGoal || ''
  const metrics = output.successMetrics || []

  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

  return `
    <div class="brief-card weekly-plan" data-brief="weekly-plan">
      <div class="brief-header">
        <div class="brief-title">
          <span class="time-badge">📅 WEEKLY PLAN</span>
          <h2>Jordan's Content Strategy</h2>
          <p class="subtitle">Next 7 days informed by this week's data</p>
        </div>
      </div>

      <div class="brief-body">
        <!-- STRATEGY -->
        ${goal ? `
          <section class="brief-section">
            <h3 class="section-title">🎯 Weekly Goal</h3>
            <div class="goal-box">
              <p>${goal}</p>
            </div>
          </section>
        ` : ''}

        <!-- 7-DAY PLAN -->
        <section class="brief-section">
          <h3 class="section-title">📋 Content Calendar</h3>
          <div class="calendar-grid">
            ${plan.map((item, idx) => `
              <div class="calendar-day" data-day="${item.day}">
                <div class="day-header">
                  <h4>${item.day}</h4>
                  <span class="day-time">${item.time}</span>
                </div>
                <div class="day-content">
                  <span class="content-format">${item.format}</span>
                  <span class="content-audience">${item.targetAudience}</span>
                  <p class="content-brief">${item.contentBrief}</p>
                  <details class="rationale-details">
                    <summary>Why this day?</summary>
                    <p>${item.rationale}</p>
                  </details>
                </div>
              </div>
            `).join('')}
          </div>
        </section>

        <!-- SUCCESS METRICS -->
        ${metrics.length > 0 ? `
          <section class="brief-section">
            <h3 class="section-title">📊 Success Metrics</h3>
            <ul class="metrics-list">
              ${metrics.map(m => `
                <li>${m}</li>
              `).join('')}
            </ul>
          </section>
        ` : ''}
      </div>

      <div class="brief-footer plan-actions">
        <div class="approval-buttons">
          <button class="action-btn primary approve-btn" onclick="window.briefEvent('approve-plan', 'weekly')">
            ✓ Approve Plan
          </button>
          <button class="action-btn secondary reject-btn" onclick="window.briefEvent('reject-plan', 'weekly')">
            ✗ Reject & Rethink
          </button>
        </div>
        <p class="plan-note">Once approved, Alex and Riley will get their tasks</p>
        <p class="brief-note">From Jordan • Sunday 6:30 PM UTC</p>
      </div>
    </div>

    <style>
      .weekly-plan {
        max-width: 800px;
        margin: 0 auto 24px;
        border: 1px solid rgba(76,175,80,0.3);
        border-radius: 8px;
        background: linear-gradient(135deg, rgba(76,175,80,0.08) 0%, rgba(56,142,60,0.03) 100%);
        padding: 24px;
      }

      .goal-box {
        background: rgba(76,175,80,0.1);
        border-left: 4px solid rgba(76,175,80,0.5);
        padding: 16px;
        border-radius: 4px;
      }

      .goal-box p {
        font-size: 14px;
        line-height: 1.6;
        margin: 0;
        color: rgba(255,255,255,0.9);
      }

      .calendar-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 12px;
      }

      .calendar-day {
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(76,175,80,0.2);
        border-radius: 4px;
        padding: 12px;
      }

      .day-header {
        margin-bottom: 12px;
        padding-bottom: 8px;
        border-bottom: 2px solid rgba(76,175,80,0.3);
      }

      .day-header h4 {
        margin: 0 0 4px 0;
        font-size: 13px;
        font-weight: 600;
        color: rgba(255,255,255,0.9);
      }

      .day-time {
        font-size: 11px;
        color: rgba(255,255,255,0.5);
      }

      .day-content {
        font-size: 12px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .content-format {
        background: rgba(76,175,80,0.2);
        color: rgba(255,255,255,0.8);
        padding: 3px 8px;
        border-radius: 3px;
        width: fit-content;
        font-weight: 500;
      }

      .content-audience {
        font-size: 11px;
        color: rgba(255,255,255,0.6);
        text-transform: uppercase;
      }

      .content-brief {
        font-size: 12px;
        line-height: 1.4;
        color: rgba(255,255,255,0.8);
        margin: 0;
      }

      .rationale-details {
        cursor: pointer;
        margin-top: 6px;
      }

      .rationale-details summary {
        font-size: 11px;
        color: rgba(76,175,80,0.7);
        text-decoration: underline;
        user-select: none;
      }

      .rationale-details p {
        font-size: 11px;
        color: rgba(255,255,255,0.6);
        margin: 6px 0 0 0;
        padding-top: 6px;
        border-top: 1px solid rgba(255,255,255,0.1);
      }

      .metrics-list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .metrics-list li {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        color: rgba(255,255,255,0.8);
      }

      .metrics-list li::before {
        content: '✓';
        color: rgba(76,175,80,0.7);
        font-weight: 600;
        flex-shrink: 0;
      }

      .plan-actions {
        margin-top: 20px;
      }

      .approval-buttons {
        display: flex;
        gap: 12px;
        margin-bottom: 12px;
      }

      .approve-btn {
        flex: 1;
        background: rgba(76,175,80,0.3);
        border-color: rgba(76,175,80,0.5);
      }

      .approve-btn:hover {
        background: rgba(76,175,80,0.4);
      }

      .reject-btn {
        flex: 1;
      }

      .plan-note {
        font-size: 12px;
        color: rgba(255,255,255,0.5);
        text-align: center;
        margin: 8px 0 0 0;
      }

      .brief-header,
      .section-title,
      .brief-footer,
      .action-btn,
      .action-btn:hover,
      .action-btn.primary,
      .action-btn.primary:hover,
      .brief-note {
        /* Reuse from morning-brief */
      }
    </style>
  `
}
