/**
 * Weekly Production Briefs Wire
 *
 * Displays: Riley's weekly production direction
 * Rendered Sunday 7:30 PM when Riley's briefs are available
 * Shows production notes, pacing, mood, and B-roll suggestions for each day
 */

export function renderWeeklyBriefs(briefsTask) {
  const output = briefsTask.outputs?.[0]?.content || {}
  const weeklyProduction = output.weeklyProduction || []

  return `
    <div class="brief-card weekly-briefs" data-brief="weekly-briefs">
      <div class="brief-header">
        <div class="brief-title">
          <span class="time-badge">🎬 PRODUCTION</span>
          <h2>Riley's Weekly Production Briefs</h2>
          <p class="subtitle">Direction optimized for what worked this week</p>
        </div>
      </div>

      <div class="brief-body">
        <!-- PRODUCTION BRIEFS BY DAY -->
        ${weeklyProduction.map(day => `
          <section class="brief-section production-day">
            <div class="day-header-brief">
              <h3>${day.day} — ${day.format}</h3>
              <span class="brief-hook">"${day.hook}"</span>
            </div>

            <div class="production-details">
              <!-- OPENING -->
              <div class="detail-group">
                <h4 class="detail-title">🎞️ Opening (First 2 seconds)</h4>
                <p class="detail-content">${day.productionBrief.opening}</p>
              </div>

              <!-- PACING & MOOD -->
              <div class="detail-grid">
                <div class="detail-box">
                  <h5>Pacing</h5>
                  <p><strong>${day.productionBrief.pacing.toUpperCase()}</strong></p>
                </div>
                <div class="detail-box">
                  <h5>Mood</h5>
                  <p><strong>${day.productionBrief.mood.toUpperCase()}</strong></p>
                </div>
              </div>

              <!-- SEGMENTS -->
              <div class="detail-group">
                <h4 class="detail-title">📹 Shot Breakdown</h4>
                <div class="segments-list">
                  ${day.productionBrief.segments.map(seg => `
                    <div class="segment">
                      <span class="timecode">${seg.timecode}</span>
                      <div class="segment-details">
                        <p class="segment-content">${seg.content}</p>
                        <p class="segment-shots"><em>${seg.shots}</em></p>
                      </div>
                    </div>
                  `).join('')}
                </div>
              </div>

              <!-- MUSIC & TEXT -->
              <div class="detail-grid">
                <div class="detail-box">
                  <h5>Music</h5>
                  <p>${day.productionBrief.musicSuggestion}</p>
                </div>
                <div class="detail-box">
                  <h5>Text Overlay</h5>
                  <p><strong>${day.productionBrief.textOverlay.position.toUpperCase()}</strong></p>
                </div>
              </div>

              <!-- WHY THIS APPROACH -->
              <div class="detail-group insight-group">
                <h4 class="detail-title">💡 Why This Approach</h4>
                <p class="detail-content">${day.productionBrief.whyThisApproach}</p>
              </div>
            </div>
          </section>
        `).join('')}

        <!-- READY TO PRODUCE -->
        <section class="brief-section">
          <div class="production-ready">
            <h4>✓ All briefs are ready for production</h4>
            <p>Each brief is optimized based on this week's performance data.
               Share these with your production team or use as-is for recording.</p>
          </div>
        </section>
      </div>

      <div class="brief-footer">
        <div class="brief-actions">
          <button class="action-btn primary" onclick="window.downloadWeeklyBriefs()">
            📥 Download Briefs (PDF)
          </button>
          <button class="action-btn secondary" onclick="window.briefEvent('dismiss', 'weekly-briefs')">
            Done
          </button>
        </div>
        <p class="brief-note">From Riley • Sunday 7:30 PM UTC</p>
      </div>
    </div>

    <style>
      .weekly-briefs {
        max-width: 900px;
        margin: 0 auto 24px;
        border: 1px solid rgba(255,100,100,0.3);
        border-radius: 8px;
        background: linear-gradient(135deg, rgba(255,100,100,0.08) 0%, rgba(200,80,80,0.03) 100%);
        padding: 24px;
      }

      .production-day {
        background: rgba(255,255,255,0.03);
        border: 1px solid rgba(255,100,100,0.2);
        border-radius: 4px;
        padding: 16px;
        margin-bottom: 16px;
      }

      .day-header-brief {
        margin-bottom: 16px;
        padding-bottom: 12px;
        border-bottom: 2px solid rgba(255,100,100,0.2);
      }

      .day-header-brief h3 {
        margin: 0 0 8px 0;
        font-size: 14px;
        font-weight: 600;
      }

      .brief-hook {
        display: block;
        font-size: 12px;
        color: rgba(255,255,255,0.7);
        font-style: italic;
      }

      .production-details {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .detail-group {
        background: rgba(255,255,255,0.02);
        padding: 12px;
        border-radius: 3px;
        border-left: 3px solid rgba(255,100,100,0.3);
      }

      .detail-title {
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        color: rgba(255,255,255,0.8);
        margin: 0 0 8px 0;
      }

      .detail-content {
        font-size: 12px;
        color: rgba(255,255,255,0.7);
        margin: 0;
        line-height: 1.5;
      }

      .detail-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 12px;
      }

      .detail-box {
        background: rgba(255,255,255,0.03);
        padding: 10px;
        border-radius: 3px;
        border-left: 3px solid rgba(255,100,100,0.3);
      }

      .detail-box h5 {
        font-size: 11px;
        text-transform: uppercase;
        color: rgba(255,255,255,0.6);
        margin: 0 0 6px 0;
      }

      .detail-box p {
        font-size: 12px;
        color: rgba(255,255,255,0.8);
        margin: 0;
      }

      .segments-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .segment {
        display: flex;
        gap: 12px;
        padding: 8px;
        background: rgba(255,255,255,0.02);
        border-radius: 3px;
      }

      .timecode {
        font-size: 11px;
        font-weight: 600;
        color: rgba(255,100,100,0.7);
        min-width: 60px;
        flex-shrink: 0;
      }

      .segment-details {
        flex: 1;
      }

      .segment-content {
        font-size: 12px;
        color: rgba(255,255,255,0.8);
        margin: 0 0 4px 0;
      }

      .segment-shots {
        font-size: 11px;
        color: rgba(255,255,255,0.6);
        margin: 0;
      }

      .insight-group {
        background: linear-gradient(135deg, rgba(100,200,255,0.1) 0%, rgba(100,150,200,0.05) 100%);
        border-left-color: rgba(100,200,255,0.4);
      }

      .production-ready {
        background: rgba(76,175,80,0.1);
        border-left: 4px solid rgba(76,175,80,0.5);
        padding: 14px;
        border-radius: 3px;
      }

      .production-ready h4 {
        font-size: 13px;
        margin: 0 0 6px 0;
        color: rgba(255,255,255,0.9);
      }

      .production-ready p {
        font-size: 12px;
        color: rgba(255,255,255,0.7);
        margin: 0;
        line-height: 1.5;
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
        /* Reuse from other wires */
      }
    </style>
  `
}
