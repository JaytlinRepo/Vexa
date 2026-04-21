/**
 * Weekly Pulse Wire
 *
 * Displays: Maya's weekly learnings, patterns, trajectory, recommendations
 * Rendered Sunday 6:00 PM when Maya's weekly pulse is available
 */

export function renderWeeklyPulse(pulseTask) {
  const output = pulseTask.outputs?.[0]?.content || {}
  const learnings = output.keyLearnings || []
  const pattern = output.bestPerformingPattern || {}
  const recommendations = output.recommendations || []
  const warnings = output.warnings || []

  return `
    <div class="brief-card weekly-pulse" data-brief="weekly-pulse">
      <div class="brief-header">
        <div class="brief-title">
          <span class="time-badge">📊 WEEK SUMMARY</span>
          <h2>Maya's Weekly Pulse</h2>
          <p class="subtitle">${output.weekSummary || 'This week\'s insights and next week\'s focus'}</p>
        </div>
      </div>

      <div class="brief-body">
        <!-- KEY LEARNINGS -->
        ${learnings.length > 0 ? `
          <section class="brief-section">
            <h3 class="section-title">📚 Key Learnings</h3>
            <div class="learnings-container">
              ${learnings.map(l => `
                <div class="learning-card">
                  <p class="learning-insight">${l.learning}</p>
                  <p class="learning-data"><strong>Evidence:</strong> ${l.data}</p>
                </div>
              `).join('')}
            </div>
          </section>
        ` : ''}

        <!-- BEST PERFORMING PATTERN -->
        ${pattern.format ? `
          <section class="brief-section pattern-section">
            <h3 class="section-title">🎯 Best Performing Pattern</h3>
            <div class="pattern-card">
              <div class="pattern-details">
                <div class="pattern-item">
                  <span class="pattern-label">Format</span>
                  <span class="pattern-value">${pattern.format}</span>
                </div>
                <div class="pattern-item">
                  <span class="pattern-label">Content Type</span>
                  <span class="pattern-value">${pattern.contentType}</span>
                </div>
                <div class="pattern-item">
                  <span class="pattern-label">Best Timing</span>
                  <span class="pattern-value">${pattern.timing}</span>
                </div>
              </div>
              <div class="pattern-engagement">
                <span class="engagement-label">Average Engagement:</span>
                <span class="engagement-value">${(pattern.avgEngagement * 100).toFixed(1)}%</span>
              </div>
              <p class="pattern-reason"><strong>Why this works:</strong> ${pattern.reason}</p>
            </div>
          </section>
        ` : ''}

        <!-- TRAJECTORY -->
        <section class="brief-section">
          <h3 class="section-title">📈 Trajectory</h3>
          <div class="trajectory-badge" data-trajectory="${output.trajectory}">
            ${output.trajectory === 'accelerating' ? '🚀 Accelerating' :
              output.trajectory === 'stable' ? '➡️ Stable' :
              '📉 Declining'}
          </div>
          <p class="trajectory-note">
            ${output.trajectory === 'accelerating' ? 'Your momentum is increasing. Keep the current strategy.' :
              output.trajectory === 'stable' ? 'You\'re maintaining consistent performance. Good rhythm.' :
              'Performance is declining. Consider testing new formats or angles.'}
          </p>
        </section>

        <!-- NEXT WEEK FORECAST -->
        ${output.nextWeekForecast ? `
          <section class="brief-section forecast-section">
            <h3 class="section-title">🔮 If You Continue This Pattern...</h3>
            <div class="forecast-box">
              <p>${output.nextWeekForecast}</p>
            </div>
          </section>
        ` : ''}

        <!-- RECOMMENDATIONS -->
        ${recommendations.length > 0 ? `
          <section class="brief-section recommendations-section">
            <h3 class="section-title">💡 Recommendations</h3>
            <ul class="recommendations-list">
              ${recommendations.map(r => `
                <li class="recommendation-item">
                  <span class="rec-icon">→</span>
                  <span>${r}</span>
                </li>
              `).join('')}
            </ul>
          </section>
        ` : ''}

        <!-- WARNINGS -->
        ${warnings.filter(w => w).length > 0 ? `
          <section class="brief-section warnings-section">
            <h3 class="section-title">⚠️ Watch Out For</h3>
            <ul class="warnings-list">
              ${warnings.filter(w => w).map(w => `
                <li class="warning-item">
                  <span class="warning-icon">!</span>
                  <span>${w}</span>
                </li>
              `).join('')}
            </ul>
          </section>
        ` : ''}
      </div>

      <div class="brief-footer">
        <div class="brief-actions">
          <button class="action-btn primary" onclick="window.navigateTo('weekly-plan')">
            See Jordan's Plan
          </button>
          <button class="action-btn secondary" onclick="window.briefEvent('dismiss', 'weekly-pulse')">
            Dismiss
          </button>
        </div>
        <p class="brief-note">From Maya • Sunday 6:00 PM UTC</p>
      </div>
    </div>

    <style>
      .weekly-pulse {
        max-width: 700px;
        margin: 0 auto 24px;
        border: 1px solid rgba(100,200,255,0.3);
        border-radius: 8px;
        background: linear-gradient(135deg, rgba(100,200,255,0.08) 0%, rgba(100,150,200,0.03) 100%);
        padding: 24px;
      }

      .learnings-container {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .learning-card {
        background: rgba(255,255,255,0.05);
        padding: 12px;
        border-radius: 4px;
        border-left: 3px solid rgba(100,200,255,0.4);
      }

      .learning-insight {
        font-size: 13px;
        font-weight: 500;
        margin-bottom: 4px;
        color: rgba(255,255,255,0.9);
      }

      .learning-data {
        font-size: 12px;
        color: rgba(255,255,255,0.6);
        margin: 0;
      }

      .pattern-card {
        background: rgba(100,200,255,0.1);
        border-left: 4px solid rgba(100,200,255,0.5);
        padding: 16px;
        border-radius: 4px;
      }

      .pattern-details {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 12px;
        margin-bottom: 12px;
        padding: 12px 0;
        border-bottom: 1px solid rgba(255,255,255,0.1);
      }

      .pattern-item {
        text-align: center;
      }

      .pattern-label {
        display: block;
        font-size: 11px;
        color: rgba(255,255,255,0.6);
        text-transform: uppercase;
        margin-bottom: 4px;
      }

      .pattern-value {
        display: block;
        font-size: 14px;
        font-weight: 600;
      }

      .pattern-engagement {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
        padding: 8px;
        background: rgba(255,255,255,0.05);
        border-radius: 3px;
      }

      .engagement-label {
        font-size: 12px;
        color: rgba(255,255,255,0.7);
      }

      .engagement-value {
        font-size: 16px;
        font-weight: 600;
        color: rgba(100,200,255,0.9);
      }

      .pattern-reason {
        font-size: 13px;
        color: rgba(255,255,255,0.7);
        margin: 0;
      }

      .trajectory-badge {
        display: inline-block;
        padding: 8px 12px;
        background: rgba(100,200,255,0.2);
        border-radius: 4px;
        font-weight: 600;
        font-size: 13px;
        margin-bottom: 8px;
      }

      .trajectory-badge[data-trajectory="accelerating"] {
        background: rgba(76,175,80,0.2);
      }

      .trajectory-badge[data-trajectory="declining"] {
        background: rgba(255,107,107,0.2);
      }

      .trajectory-note {
        font-size: 13px;
        color: rgba(255,255,255,0.7);
        margin: 8px 0 0 0;
      }

      .forecast-box {
        background: rgba(255,193,7,0.1);
        border-left: 4px solid rgba(255,193,7,0.5);
        padding: 12px;
        border-radius: 4px;
        font-size: 13px;
        line-height: 1.6;
        color: rgba(255,255,255,0.8);
      }

      .forecast-box p {
        margin: 0;
      }

      .recommendations-list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .recommendation-item {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        font-size: 13px;
        line-height: 1.5;
      }

      .rec-icon {
        color: rgba(100,200,255,0.6);
        font-weight: 600;
        flex-shrink: 0;
      }

      .warnings-list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .warning-item {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        font-size: 13px;
        line-height: 1.5;
      }

      .warning-icon {
        color: rgba(255,107,107,0.7);
        font-weight: 600;
        flex-shrink: 0;
      }

      .brief-header,
      .section-title,
      .brief-footer,
      .brief-actions,
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
