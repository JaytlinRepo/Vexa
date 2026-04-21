/**
 * Briefs Loader
 *
 * Loads and renders brief cards into the dashboard
 * Handles fetching brief data and rendering appropriate wire components
 */

async function loadBriefs() {
  try {
    // Dynamically import wire modules
    const {
      renderMorningBrief,
    } = await import('./morning-brief-wire.js')
    const { renderEveningRecap } = await import('./evening-recap-wire.js')
    const { renderWeeklyPulse } = await import('./weekly-pulse-wire.js')
    const { renderWeeklyPlan } = await import('./weekly-plan-wire.js')
    const { renderWeeklyHooks } = await import('./weekly-hooks-wire.js')
    const { renderWeeklyBriefs } = await import('./weekly-briefs-wire.js')
    const { renderQueueStatus } = await import('./queue-status-wire.js')

    // Fetch all brief tasks in parallel
    const [morning, midday, evening, pulse, plan, hooks, briefs, queue] = await Promise.all([
      fetch('/api/briefs/morning').then(r => r.json()).catch(() => null),
      fetch('/api/briefs/midday').then(r => r.json()).catch(() => null),
      fetch('/api/briefs/evening').then(r => r.json()).catch(() => null),
      fetch('/api/weekly/maya-pulse').then(r => r.json()).catch(() => null),
      fetch('/api/weekly/jordan-plan').then(r => r.json()).catch(() => null),
      fetch('/api/weekly/alex-hooks').then(r => r.json()).catch(() => null),
      fetch('/api/weekly/riley-briefs').then(r => r.json()).catch(() => null),
      fetch('/api/briefs/queue').then(r => r.json()).catch(() => null),
    ])

    // Render to dashboard
    if (morning) renderBrief('morning-brief', morning, renderMorningBrief)
    if (midday) renderBrief('midday-check', midday, renderMorningBrief)
    if (evening) renderBrief('evening-recap', evening, renderEveningRecap)
    if (pulse) renderBrief('weekly-pulse', pulse, renderWeeklyPulse)
    if (plan) renderBrief('weekly-plan', plan, renderWeeklyPlan)
    if (hooks) renderBrief('weekly-hooks', hooks, renderWeeklyHooks)
    if (briefs) renderBrief('weekly-briefs', briefs, renderWeeklyBriefs)
    if (queue) renderQueueBrief(queue, renderQueueStatus)

    console.log('[briefs-loader] briefs loaded and rendered')
  } catch (err) {
    console.error('[briefs-loader] load error:', err)
  }
}

/**
 * Render a single brief to its placeholder
 */
function renderBrief(briefType, taskData, renderFn) {
  const placeholder = document.getElementById(`${briefType}-placeholder`)
  if (!placeholder) {
    console.warn(`[briefs-loader] placeholder not found for ${briefType}`)
    return
  }

  try {
    const html = renderFn(taskData)
    placeholder.innerHTML = html
    console.log(`[briefs-loader] rendered ${briefType}`)
  } catch (err) {
    console.error(`[briefs-loader] render error for ${briefType}:`, err)
    placeholder.innerHTML = `<div class="brief-card error">Failed to load ${briefType}</div>`
  }
}

/**
 * Render queue status
 */
function renderQueueBrief(queueData, renderFn) {
  const queueElements = document.querySelectorAll('[data-queue-status]')
  if (queueElements.length > 0) {
    const html = renderFn(queueData)
    queueElements.forEach(el => {
      el.innerHTML = html
    })
  }
}

/**
 * Initialize briefs on page load
 */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadBriefs)
} else {
  loadBriefs()
}

/**
 * Expose refresh function
 */
window.refreshBriefs = loadBriefs

console.log('[briefs-loader] initialized')
