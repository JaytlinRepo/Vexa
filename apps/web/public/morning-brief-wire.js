/**
 * Morning Brief Wire
 *
 * Displays: Trends + yesterday's performance + today's queue + audience pulse
 * Rendered at 8:00 AM UTC when Maya's morning brief is available
 */

export function renderMorningBrief(briefTask) {
  const output = briefTask.outputs?.[0]?.content || {}
  const trends = output.trendingTopics || []
  const yesterday = output.yesterdayWin || {}
  const queue = output.queueStatus || {}
  const audience = output.audiencePulse || {}

  return `
    <div class="brief-card morning-brief" data-brief="morning">
      <div class="brief-header">
        <div class="brief-title">
          <span class="time-badge">🌅 8:00 AM</span>
          <h2>Morning Brief</h2>
          <p class="subtitle">What's trending overnight + today's queue</p>
        </div>
      </div>

      <div class="brief-body">
        <!-- TRENDING TOPICS -->
        <section class="brief-section">
          <h3 class="section-title">🔥 Overnight Trends</h3>
          <div class="trends-list">
            ${trends.slice(0, 3).map(t => `
              <div class="trend-item" data-urgency="${t.urgency}">
                <div class="trend-header">
                  <span class="trend-topic">${t.topic}</span>
                  <span class="urgency-badge ${t.urgency}">${t.urgency === 'act_now' ? '⚡ Act now' : '👀 Keep watching'}</span>
                </div>
                <p class="trend-angle">${t.angle}</p>
                ${t.shouldBrief ? `
                  <button class="action-btn secondary" onclick="window.briefEvent('approve-trend', '${t.topic}')">
                    Brief Jordan on this
                  </button>
                ` : ''}
              </div>
            `).join('')}
          </div>
        </section>

        <!-- YESTERDAY'S WIN -->
        ${yesterday.caption ? `
          <section class="brief-section">
            <h3 class="section-title">✨ Yesterday's Best</h3>
            <div class="yesterday-card">
              <p class="caption-preview">"${yesterday.caption.substring(0, 80)}..."</p>
              <div class="metrics-row">
                <div class="metric">
                  <span class="metric-label">Reach</span>
                  <span class="metric-value">${(yesterday.reach || 0).toLocaleString()}</span>
                </div>
                <div class="metric">
                  <span class="metric-label">Engagement</span>
                  <span class="metric-value">${(yesterday.engagementRate * 100).toFixed(1)}%</span>
                </div>
                <div class="metric">
                  <span class="metric-label">Top Cohort</span>
                  <span class="metric-value">${yesterday.topCohort}</span>
                </div>
              </div>
              <p class="insight">${yesterday.why}</p>
            </div>
          </section>
        ` : ''}

        <!-- TODAY'S QUEUE -->
        <section class="brief-section">
          <h3 class="section-title">📋 Today's Queue</h3>
          <div class="queue-summary">
            <div class="queue-stat">
              <span class="stat-label">Ready to post</span>
              <span class="stat-value">${queue.ready || 0}</span>
            </div>
            <div class="queue-stat">
              <span class="stat-label">In production</span>
              <span class="stat-value">${queue.inProduction || 0}</span>
            </div>
          </div>
          <button class="action-btn primary" onclick="window.navigateTo('queue')">
            View Queue
          </button>
        </section>

        <!-- AUDIENCE PULSE -->
        <section class="brief-section">
          <h3 class="section-title">👥 Audience Pulse</h3>
          <div class="audience-pulse">
            <p class="pulse-metric">
              <strong>${audience.activeToday}</strong>
            </p>
            <p class="peak-time">
              Peak time: <strong>${audience.peakTime}</strong>
            </p>
          </div>
        </section>

        <!-- RECOMMENDATION -->
        ${output.recommendation ? `
          <section class="brief-section recommendation">
            <div class="recommendation-icon">💡</div>
            <p>${output.recommendation}</p>
          </section>
        ` : ''}
      </div>

      <div class="brief-footer">
        <div class="brief-actions">
          <button class="action-btn secondary" onclick="window.navigateTo('trends')">
            See full brief
          </button>
          <button class="action-btn secondary" onclick="window.briefEvent('dismiss', 'morning')">
            Dismiss
          </button>
        </div>
        <p class="brief-note">From Maya • 8:00 AM UTC</p>
      </div>
    </div>

    <style>
      .morning-brief {
        max-width: 600px;
        margin: 0 auto 24px;
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 8px;
        background: linear-gradient(135deg, rgba(255,200,87,0.05) 0%, rgba(255,193,7,0.02) 100%);
        padding: 24px;
      }

      .brief-header {
        margin-bottom: 24px;
        padding-bottom: 16px;
        border-bottom: 1px solid rgba(255,255,255,0.1);
      }

      .brief-title h2 {
        margin: 8px 0 4px 0;
        font-size: 20px;
        font-weight: 600;
      }

      .brief-title .subtitle {
        color: rgba(255,255,255,0.6);
        font-size: 13px;
      }

      .time-badge {
        display: inline-block;
        font-size: 12px;
        margin-bottom: 8px;
        opacity: 0.8;
      }

      .brief-section {
        margin-bottom: 20px;
      }

      .section-title {
        font-size: 14px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 12px;
        color: rgba(255,255,255,0.8);
      }

      .trends-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .trend-item {
        background: rgba(255,255,255,0.05);
        border-left: 3px solid rgba(255,193,7,0.5);
        padding: 12px;
        border-radius: 4px;
      }

      .trend-item[data-urgency="act_now"] {
        border-left-color: #ff6b6b;
        background: rgba(255,107,107,0.05);
      }

      .trend-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
        gap: 12px;
      }

      .trend-topic {
        font-weight: 600;
        font-size: 14px;
      }

      .urgency-badge {
        font-size: 11px;
        padding: 4px 8px;
        background: rgba(255,193,7,0.2);
        border-radius: 3px;
        white-space: nowrap;
      }

      .urgency-badge.act_now {
        background: rgba(255,107,107,0.2);
      }

      .trend-angle {
        font-size: 13px;
        color: rgba(255,255,255,0.7);
        margin-bottom: 8px;
      }

      .yesterday-card {
        background: rgba(255,255,255,0.05);
        padding: 12px;
        border-radius: 4px;
      }

      .caption-preview {
        font-size: 13px;
        font-style: italic;
        margin-bottom: 12px;
        color: rgba(255,255,255,0.8);
      }

      .metrics-row {
        display: flex;
        gap: 24px;
        margin-bottom: 12px;
        padding: 12px 0;
        border-top: 1px solid rgba(255,255,255,0.1);
        border-bottom: 1px solid rgba(255,255,255,0.1);
      }

      .metric {
        flex: 1;
        text-align: center;
      }

      .metric-label {
        display: block;
        font-size: 11px;
        color: rgba(255,255,255,0.6);
        text-transform: uppercase;
        margin-bottom: 4px;
      }

      .metric-value {
        display: block;
        font-size: 16px;
        font-weight: 600;
      }

      .insight {
        font-size: 13px;
        color: rgba(255,255,255,0.7);
        font-style: italic;
      }

      .queue-summary {
        display: flex;
        gap: 24px;
        margin-bottom: 16px;
      }

      .queue-stat {
        flex: 1;
        text-align: center;
        padding: 12px;
        background: rgba(255,255,255,0.05);
        border-radius: 4px;
      }

      .stat-label {
        display: block;
        font-size: 12px;
        color: rgba(255,255,255,0.6);
        margin-bottom: 4px;
      }

      .stat-value {
        display: block;
        font-size: 24px;
        font-weight: 600;
      }

      .audience-pulse {
        background: rgba(255,255,255,0.05);
        padding: 12px;
        border-radius: 4px;
      }

      .pulse-metric {
        font-size: 14px;
        margin-bottom: 8px;
      }

      .peak-time {
        font-size: 13px;
        color: rgba(255,255,255,0.7);
      }

      .recommendation {
        background: linear-gradient(135deg, rgba(100,200,255,0.1) 0%, rgba(100,150,255,0.05) 100%);
        border-left: 3px solid rgba(100,200,255,0.5);
        padding: 16px;
        border-radius: 4px;
        display: flex;
        gap: 12px;
      }

      .recommendation-icon {
        font-size: 20px;
        flex-shrink: 0;
      }

      .recommendation p {
        margin: 0;
        font-size: 14px;
        line-height: 1.5;
      }

      .brief-footer {
        margin-top: 20px;
        padding-top: 16px;
        border-top: 1px solid rgba(255,255,255,0.1);
      }

      .brief-actions {
        display: flex;
        gap: 12px;
        margin-bottom: 12px;
      }

      .action-btn {
        flex: 1;
        padding: 10px 16px;
        border: 1px solid rgba(255,255,255,0.2);
        background: rgba(255,255,255,0.05);
        color: white;
        border-radius: 4px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        transition: all 0.2s;
      }

      .action-btn:hover {
        background: rgba(255,255,255,0.1);
      }

      .action-btn.primary {
        background: rgba(255,193,7,0.3);
        border-color: rgba(255,193,7,0.5);
      }

      .action-btn.primary:hover {
        background: rgba(255,193,7,0.4);
      }

      .brief-note {
        font-size: 12px;
        color: rgba(255,255,255,0.5);
        margin: 0;
        text-align: center;
      }
    </style>
  `
}
