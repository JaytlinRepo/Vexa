/**
 * Weekly Hooks Wire
 *
 * Displays: Alex's ranked hooks for each day of the week
 * Rendered Sunday 7:00 PM when Alex's hooks are available
 * Shows 3 hooks per day, ranked by predicted performance
 */

export function renderWeeklyHooks(hooksTask) {
  const output = hooksTask.outputs?.[0]?.content || {}
  const weeklyHooks = output.weeklyHooks || []

  return `
    <div class="brief-card weekly-hooks" data-brief="weekly-hooks">
      <div class="brief-header">
        <div class="brief-title">
          <span class="time-badge">📝 HOOKS</span>
          <h2>Alex's Weekly Hooks</h2>
          <p class="subtitle">3 ranked hooks per day, ready to use</p>
        </div>
      </div>

      <div class="brief-body">
        <!-- HOOKS BY DAY -->
        ${weeklyHooks.map(dayHooks => `
          <section class="brief-section hooks-day-section">
            <h3 class="section-title">${dayHooks.day} — ${dayHooks.contentBrief}</h3>

            <div class="hooks-container">
              ${dayHooks.hooks.map(hook => `
                <div class="hook-card" data-rank="${hook.rank}">
                  <div class="hook-header">
                    <span class="hook-rank">
                      ${hook.rank === 1 ? '🥇' : hook.rank === 2 ? '🥈' : '🥉'}
                      #${hook.rank}
                    </span>
                    <span class="hook-type">${hook.hookType.replace(/_/g, ' ').toUpperCase()}</span>
                    <span class="engagement-boost">${hook.predictedEngagementBoost}</span>
                  </div>

                  <div class="hook-text">
                    "<strong>${hook.text}</strong>"
                  </div>

                  <div class="hook-insight">
                    <strong>Why ranked #${hook.rank}:</strong> ${hook.why}
                  </div>

                  <div class="hook-actions">
                    <button class="copy-btn" onclick="window.copyToClipboard('${hook.text.replace(/'/g, "\\'")}')">
                      📋 Copy
                    </button>
                    <button class="use-btn" onclick="window.useHook('${dayHooks.day}', '${hook.rank}')">
                      ✓ Use
                    </button>
                  </div>
                </div>
              `).join('')}
            </div>
          </section>
        `).join('')}

        <!-- NOTE -->
        <section class="brief-section">
          <p class="hooks-note">
            Each hook is ranked by predicted engagement for your audience.
            These are ready to post — just select and use.
          </p>
        </section>
      </div>

      <div class="brief-footer">
        <div class="brief-actions">
          <button class="action-btn primary" onclick="window.navigateTo('weekly-briefs')">
            See Riley's Production Briefs
          </button>
          <button class="action-btn secondary" onclick="window.briefEvent('dismiss', 'weekly-hooks')">
            Done
          </button>
        </div>
        <p class="brief-note">From Alex • Sunday 7:00 PM UTC</p>
      </div>
    </div>

    <style>
      .weekly-hooks {
        max-width: 800px;
        margin: 0 auto 24px;
        border: 1px solid rgba(200,100,200,0.3);
        border-radius: 8px;
        background: linear-gradient(135deg, rgba(200,100,200,0.08) 0%, rgba(150,80,150,0.03) 100%);
        padding: 24px;
      }

      .hooks-day-section {
        margin-bottom: 24px;
      }

      .hooks-container {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .hook-card {
        background: rgba(255,255,255,0.05);
        border-left: 4px solid rgba(200,100,200,0.4);
        padding: 14px;
        border-radius: 4px;
        transition: all 0.2s;
      }

      .hook-card:hover {
        background: rgba(255,255,255,0.08);
        border-left-color: rgba(200,100,200,0.6);
      }

      .hook-card[data-rank="1"] {
        border-left-color: rgba(255,193,7,0.6);
        background: rgba(255,193,7,0.08);
      }

      .hook-card[data-rank="1"]:hover {
        background: rgba(255,193,7,0.12);
      }

      .hook-header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 10px;
      }

      .hook-rank {
        font-weight: 600;
        font-size: 13px;
        min-width: 40px;
      }

      .hook-type {
        background: rgba(200,100,200,0.2);
        color: rgba(255,255,255,0.8);
        padding: 3px 8px;
        border-radius: 3px;
        font-size: 11px;
        font-weight: 500;
        text-transform: uppercase;
      }

      .engagement-boost {
        margin-left: auto;
        color: rgba(76,175,80,0.7);
        font-weight: 600;
        font-size: 12px;
      }

      .hook-text {
        font-size: 13px;
        line-height: 1.5;
        margin-bottom: 10px;
        padding: 10px;
        background: rgba(255,255,255,0.03);
        border-radius: 3px;
        color: rgba(255,255,255,0.9);
      }

      .hook-insight {
        font-size: 12px;
        color: rgba(255,255,255,0.6);
        margin-bottom: 10px;
        padding: 8px;
        background: rgba(255,255,255,0.02);
        border-radius: 3px;
      }

      .hook-insight strong {
        color: rgba(255,255,255,0.7);
      }

      .hook-actions {
        display: flex;
        gap: 8px;
      }

      .copy-btn,
      .use-btn {
        flex: 1;
        padding: 7px 12px;
        border: 1px solid rgba(255,255,255,0.2);
        background: rgba(255,255,255,0.05);
        color: white;
        border-radius: 3px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 500;
        transition: all 0.2s;
      }

      .copy-btn:hover {
        background: rgba(255,255,255,0.1);
      }

      .use-btn {
        background: rgba(200,100,200,0.25);
        border-color: rgba(200,100,200,0.4);
      }

      .use-btn:hover {
        background: rgba(200,100,200,0.35);
      }

      .hooks-note {
        background: rgba(100,200,255,0.1);
        border-left: 4px solid rgba(100,200,255,0.4);
        padding: 12px;
        border-radius: 3px;
        font-size: 12px;
        color: rgba(255,255,255,0.7);
        margin: 0;
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
