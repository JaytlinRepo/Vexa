/**
 * Evening Recap Wire
 *
 * Displays: Day summary + learnings + tomorrow's forecast
 * Rendered at 8:00 PM UTC when Maya's evening recap is available
 */

export function renderEveningRecap(recapTask) {
  const output = recapTask.outputs?.[0]?.content || {}
  const bestPost = output.bestPost || {}
  const learnings = output.learnings || []
  const tomorrow = output.tomorrowForecast || {}
  const trend = output.trendOpportunity || {}

  return `
    <div class="brief-card evening-recap" data-brief="evening">
      <div class="brief-header">
        <div class="brief-title">
          <span class="time-badge">🌙 8:00 PM</span>
          <h2>Evening Recap</h2>
          <p class="subtitle">${output.summary || 'Day summary + tomorrow forecast'}</p>
        </div>
      </div>

      <div class="brief-body">
        <!-- BEST POST -->
        ${bestPost.caption ? `
          <section class="brief-section best-post-section">
            <h3 class="section-title">🏆 Best Post Today</h3>
            <div class="best-post-card">
              <p class="caption-preview">"${bestPost.caption.substring(0, 100)}..."</p>
              <div class="metrics-grid">
                <div class="metric-box">
                  <span class="metric-label">Reach</span>
                  <span class="metric-value">${(bestPost.reach || 0).toLocaleString()}</span>
                </div>
                <div class="metric-box">
                  <span class="metric-label">Engagement</span>
                  <span class="metric-value">${(bestPost.engagementRate * 100).toFixed(1)}%</span>
                </div>
                <div class="metric-box">
                  <span class="metric-label">Top Audience</span>
                  <span class="metric-value">${bestPost.topCohort}</span>
                </div>
              </div>
              <p class="post-insight"><strong>Why it worked:</strong> ${bestPost.why}</p>
            </div>
          </section>
        ` : ''}

        <!-- KEY LEARNINGS -->
        ${learnings.length > 0 ? `
          <section class="brief-section">
            <h3 class="section-title">📚 Key Learnings</h3>
            <ul class="learnings-list">
              ${learnings.map(l => `
                <li class="learning-item">
                  <span class="learning-dot"></span>
                  <span class="learning-text">${l}</span>
                </li>
              `).join('')}
            </ul>
          </section>
        ` : ''}

        <!-- TOMORROW'S FORECAST -->
        ${tomorrow.expectedReach ? `
          <section class="brief-section forecast-section">
            <h3 class="section-title">🔮 Tomorrow's Forecast</h3>
            <div class="forecast-card">
              <div class="forecast-metric">
                <span class="forecast-label">Expected Reach</span>
                <span class="forecast-value">${(tomorrow.expectedReach || 0).toLocaleString()}</span>
              </div>
              <p class="forecast-cohort">Top audience: <strong>${tomorrow.topCohort}</strong></p>
              <p class="forecast-recommendation">${tomorrow.recommendation}</p>
            </div>
          </section>
        ` : ''}

        <!-- TREND OPPORTUNITY -->
        ${trend.trend ? `
          <section class="brief-section opportunity-section">
            <h3 class="section-title">💡 Emerging Opportunity</h3>
            <div class="opportunity-card">
              <p class="opportunity-trend">"${trend.trend}" is trending</p>
              <p class="opportunity-reason">${trend.reason}</p>
              ${trend.shouldBrief ? `
                <button class="action-btn primary" onclick="window.briefEvent('approve-trend', '${trend.trend}')">
                  Brief Jordan on this
                </button>
              ` : ''}
            </div>
          </section>
        ` : ''}
      </div>

      <div class="brief-footer">
        <div class="brief-actions">
          <button class="action-btn secondary" onclick="window.navigateTo('analytics')">
            Full report
          </button>
          <button class="action-btn secondary" onclick="window.briefEvent('dismiss', 'evening')">
            Got it
          </button>
        </div>
        <p class="brief-note">From Maya • 8:00 PM UTC</p>
      </div>
    </div>

    <style>
      .evening-recap {
        max-width: 600px;
        margin: 0 auto 24px;
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 8px;
        background: linear-gradient(135deg, rgba(150,100,200,0.05) 0%, rgba(100,80,150,0.02) 100%);
        padding: 24px;
      }

      .best-post-card {
        background: rgba(255,255,255,0.05);
        border-left: 4px solid rgba(255,193,7,0.6);
        padding: 16px;
        border-radius: 4px;
      }

      .caption-preview {
        font-size: 13px;
        font-style: italic;
        margin-bottom: 12px;
        color: rgba(255,255,255,0.8);
      }

      .metrics-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 12px;
        margin-bottom: 12px;
        padding: 12px 0;
        border-top: 1px solid rgba(255,255,255,0.1);
        border-bottom: 1px solid rgba(255,255,255,0.1);
      }

      .metric-box {
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

      .post-insight {
        font-size: 13px;
        color: rgba(255,255,255,0.7);
        margin: 0;
      }

      .learnings-list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .learning-item {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        font-size: 13px;
        line-height: 1.5;
      }

      .learning-dot {
        display: inline-block;
        width: 4px;
        height: 4px;
        border-radius: 50%;
        background: rgba(255,193,7,0.6);
        flex-shrink: 0;
        margin-top: 6px;
      }

      .learning-text {
        color: rgba(255,255,255,0.8);
      }

      .forecast-card {
        background: linear-gradient(135deg, rgba(100,200,255,0.1) 0%, rgba(100,150,255,0.05) 100%);
        border-left: 4px solid rgba(100,200,255,0.5);
        padding: 16px;
        border-radius: 4px;
      }

      .forecast-metric {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
        padding: 12px;
        background: rgba(255,255,255,0.05);
        border-radius: 4px;
      }

      .forecast-label {
        font-size: 12px;
        color: rgba(255,255,255,0.6);
        text-transform: uppercase;
      }

      .forecast-value {
        font-size: 18px;
        font-weight: 600;
      }

      .forecast-cohort {
        font-size: 13px;
        color: rgba(255,255,255,0.7);
        margin: 8px 0;
      }

      .forecast-recommendation {
        font-size: 13px;
        color: rgba(255,255,255,0.8);
        margin: 8px 0 0 0;
      }

      .opportunity-card {
        background: rgba(255,193,7,0.1);
        border-left: 4px solid rgba(255,193,7,0.6);
        padding: 16px;
        border-radius: 4px;
      }

      .opportunity-trend {
        font-size: 14px;
        font-weight: 600;
        margin-bottom: 8px;
      }

      .opportunity-reason {
        font-size: 13px;
        color: rgba(255,255,255,0.7);
        margin-bottom: 12px;
      }

      .brief-header,
      .brief-section,
      .brief-title h2,
      .brief-title .subtitle,
      .time-badge,
      .section-title,
      .brief-footer,
      .brief-actions,
      .action-btn,
      .action-btn:hover,
      .action-btn.primary,
      .action-btn.primary:hover,
      .brief-note {
        /* Reuse styles from morning-brief */
      }
    </style>
  `
}
