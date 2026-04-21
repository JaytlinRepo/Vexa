/**
 * Queue Status Wire
 *
 * Displays: Posts in queue (ready to post, scheduled, in production)
 * Used in: Morning brief, quick status checks
 * Features: Post-now, preview, edit, reschedule actions
 */

export function renderQueueStatus(queueData) {
  if (!queueData || !queueData.ready) {
    return `
      <div class="queue-card empty">
        <p>No posts in queue yet.</p>
      </div>
    `
  }

  const { ready = [], scheduled = [], inProduction = [] } = queueData

  return `
    <div class="queue-status-container">
      <!-- READY TO POST -->
      ${ready.length > 0 ? `
        <section class="queue-section ready-section">
          <h4 class="queue-header">✅ Ready to Post (${ready.length})</h4>
          <div class="queue-list">
            ${ready.map(post => `
              <div class="queue-item ready-item" data-post-id="${post.id}">
                <div class="queue-item-header">
                  <span class="queue-title">${post.caption.substring(0, 60)}...</span>
                  <span class="queue-time">${post.scheduledFor || 'Now'}</span>
                </div>
                <div class="queue-item-meta">
                  <span class="queue-format">${post.format}</span>
                  <span class="queue-cohort">${post.targetCohort}</span>
                </div>
                <div class="queue-item-actions">
                  <button class="queue-action preview-btn" onclick="window.previewPost('${post.id}')">
                    👁️ Preview
                  </button>
                  <button class="queue-action edit-btn" onclick="window.editPost('${post.id}')">
                    ✏️ Edit
                  </button>
                  <button class="queue-action post-now-btn" onclick="window.postNow('${post.id}')">
                    📤 Post Now
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
        </section>
      ` : ''}

      <!-- SCHEDULED -->
      ${scheduled.length > 0 ? `
        <section class="queue-section scheduled-section">
          <h4 class="queue-header">⏰ Scheduled (${scheduled.length})</h4>
          <div class="queue-list">
            ${scheduled.map(post => `
              <div class="queue-item scheduled-item" data-post-id="${post.id}">
                <div class="queue-item-header">
                  <span class="queue-title">${post.caption.substring(0, 60)}...</span>
                  <span class="queue-time">${post.scheduledFor}</span>
                </div>
                <div class="queue-item-meta">
                  <span class="queue-format">${post.format}</span>
                  <span class="queue-cohort">${post.targetCohort}</span>
                </div>
                <div class="queue-item-actions">
                  <button class="queue-action preview-btn" onclick="window.previewPost('${post.id}')">
                    👁️ Preview
                  </button>
                  <button class="queue-action reschedule-btn" onclick="window.reschedulePost('${post.id}')">
                    🕐 Reschedule
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
        </section>
      ` : ''}

      <!-- IN PRODUCTION -->
      ${inProduction.length > 0 ? `
        <section class="queue-section production-section">
          <h4 class="queue-header">🎬 In Production (${inProduction.length})</h4>
          <div class="queue-list">
            ${inProduction.map(post => `
              <div class="queue-item production-item" data-post-id="${post.id}">
                <div class="queue-item-header">
                  <span class="queue-title">${post.caption.substring(0, 60)}...</span>
                  <span class="queue-status">${post.productionStatus}</span>
                </div>
                <div class="queue-item-meta">
                  <span class="queue-format">${post.format}</span>
                  <span class="queue-progress">${post.progress || '50%'}</span>
                </div>
                <div class="queue-item-actions">
                  <button class="queue-action view-brief-btn" onclick="window.viewProductionBrief('${post.id}')">
                    📋 View Brief
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
        </section>
      ` : ''}
    </div>

    <style>
      .queue-status-container {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      .queue-card.empty {
        background: rgba(255,255,255,0.03);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 4px;
        padding: 16px;
        text-align: center;
        color: rgba(255,255,255,0.5);
        font-size: 13px;
      }

      .queue-section {
        background: rgba(255,255,255,0.03);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 4px;
        padding: 12px;
      }

      .ready-section {
        border-left: 4px solid rgba(76,175,80,0.6);
      }

      .scheduled-section {
        border-left: 4px solid rgba(255,193,7,0.6);
      }

      .production-section {
        border-left: 4px solid rgba(255,100,100,0.6);
      }

      .queue-header {
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        color: rgba(255,255,255,0.8);
        margin: 0 0 12px 0;
      }

      .queue-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .queue-item {
        background: rgba(255,255,255,0.05);
        border-radius: 3px;
        padding: 10px;
        transition: all 0.2s;
      }

      .queue-item:hover {
        background: rgba(255,255,255,0.08);
      }

      .queue-item-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
      }

      .queue-title {
        font-size: 12px;
        font-weight: 500;
        color: rgba(255,255,255,0.9);
        flex: 1;
      }

      .queue-time,
      .queue-status {
        font-size: 11px;
        color: rgba(255,255,255,0.6);
        margin-left: 8px;
        white-space: nowrap;
      }

      .queue-item-meta {
        display: flex;
        gap: 8px;
        margin-bottom: 8px;
      }

      .queue-format,
      .queue-cohort,
      .queue-progress {
        font-size: 10px;
        background: rgba(255,255,255,0.05);
        padding: 3px 6px;
        border-radius: 2px;
        color: rgba(255,255,255,0.6);
      }

      .queue-item-actions {
        display: flex;
        gap: 6px;
      }

      .queue-action {
        flex: 1;
        padding: 6px 10px;
        font-size: 11px;
        font-weight: 500;
        border: 1px solid rgba(255,255,255,0.2);
        background: rgba(255,255,255,0.05);
        color: white;
        border-radius: 2px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .queue-action:hover {
        background: rgba(255,255,255,0.1);
      }

      .post-now-btn {
        background: rgba(76,175,80,0.2);
        border-color: rgba(76,175,80,0.4);
      }

      .post-now-btn:hover {
        background: rgba(76,175,80,0.3);
      }

      .edit-btn,
      .reschedule-btn {
        background: rgba(255,193,7,0.2);
        border-color: rgba(255,193,7,0.4);
      }

      .edit-btn:hover,
      .reschedule-btn:hover {
        background: rgba(255,193,7,0.3);
      }

      .preview-btn,
      .view-brief-btn {
        background: rgba(100,200,255,0.2);
        border-color: rgba(100,200,255,0.4);
      }

      .preview-btn:hover,
      .view-brief-btn:hover {
        background: rgba(100,200,255,0.3);
      }
    </style>
  `
}
