/* Profile avatar — show/hide, photo upload, sign out */
;(function () {
  var profile = document.getElementById('vx-profile')
  var uploadInput = document.getElementById('vx-profile-upload-input')
  if (!profile || !uploadInput) return

  // Close dropdown when clicking outside
  document.addEventListener('click', function (e) {
    if (profile.classList.contains('open') && !profile.contains(e.target)) {
      profile.classList.remove('open')
    }
  })

  // Photo upload — store as base64 in localStorage
  uploadInput.addEventListener('change', function () {
    var file = this.files && this.files[0]
    if (!file) return
    var reader = new FileReader()
    reader.onload = function (e) {
      var dataUrl = e.target.result
      try { localStorage.setItem('vx-profile-photo', dataUrl) } catch (err) {}
      applyPhoto(dataUrl)
    }
    reader.readAsDataURL(file)
  })

  function applyPhoto(dataUrl) {
    var imgs = [document.getElementById('vx-profile-img'), document.getElementById('vx-profile-img-lg')]
    var initials = [document.getElementById('vx-profile-initial'), document.getElementById('vx-profile-initial-lg')]
    imgs.forEach(function (img) {
      if (img) { img.src = dataUrl; img.style.display = 'block' }
    })
    initials.forEach(function (el) {
      if (el) el.style.display = 'none'
    })
  }

  function applyInitial(letter) {
    var initials = [document.getElementById('vx-profile-initial'), document.getElementById('vx-profile-initial-lg')]
    initials.forEach(function (el) {
      if (el) { el.textContent = letter; el.style.display = '' }
    })
  }

  // Restore saved photo on load
  try {
    var saved = localStorage.getItem('vx-profile-photo')
    if (saved) applyPhoto(saved)
  } catch (e) {}

  // Show profile when logged in
  function showProfile() {
    profile.style.display = ''
    // Pull name from nav
    var nameEl = document.getElementById('nav-username')
    var planEl = document.getElementById('nav-userplan')
    var name = (nameEl && nameEl.textContent) || 'User'
    var plan = (planEl && planEl.textContent) || 'Pro Plan'
    var pName = document.getElementById('vx-profile-name')
    var pPlan = document.getElementById('vx-profile-plan')
    if (pName) pName.textContent = name
    if (pPlan) pPlan.textContent = plan
    if (!localStorage.getItem('vx-profile-photo')) {
      applyInitial(name.charAt(0).toUpperCase())
    }
  }

  // Hook into enterDashboard
  var prev = window.enterDashboard
  window.enterDashboard = function () {
    if (typeof prev === 'function') prev.apply(this, arguments)
    setTimeout(showProfile, 150)
  }

  // If already logged in on load
  try {
    if (localStorage.getItem('vx-authed') === '1') {
      setTimeout(showProfile, 300)
    }
  } catch (e) {}

  // Sign out
  var logoutBtn = document.getElementById('vx-profile-logout')
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function () {
      profile.classList.remove('open')
      // Call API logout
      fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(function () {})
      // Clear local state
      try {
        localStorage.removeItem('vx-authed')
        localStorage.removeItem('vx-profile-photo')
      } catch (e) {}
      // Reload to show marketing page
      location.reload()
    })
  }
  // Usage stats in profile dropdown
  function populateUsage() {
    var S = window.__vxDashState
    if (!S || !S.usage) return
    var u = S.usage
    var tasksEl = document.getElementById('vx-usage-tasks')
    var fillEl = document.getElementById('vx-usage-fill')
    var planEl = document.getElementById('vx-usage-plan')
    if (!tasksEl) return

    var used = u.tasks ? u.tasks.used : 0
    var limit = u.tasks ? u.tasks.limit : 0
    var isUnlimited = limit > 9999
    tasksEl.textContent = 'Tasks: ' + used + (isUnlimited ? ' / unlimited' : ' / ' + limit)
    if (fillEl) fillEl.style.width = isUnlimited ? '0%' : Math.min(100, Math.round(used / limit * 100)) + '%'
    if (planEl) planEl.textContent = (u.plan || 'starter').charAt(0).toUpperCase() + (u.plan || 'starter').slice(1) + ' plan'
  }

  // Run usage on dropdown open
  var avatarBtn = document.getElementById('vx-profile-avatar')
  if (avatarBtn) {
    avatarBtn.addEventListener('click', function () { setTimeout(populateUsage, 50) })
  }

  // Theme label — show opposite of current theme
  function updateThemeLabel() {
    var el = document.getElementById('vx-profile-theme')
    if (!el) return
    var isDark = !document.body.getAttribute('data-theme') || document.body.getAttribute('data-theme') === 'dark'
    el.textContent = isDark ? 'Light' : 'Dark'
  }
  updateThemeLabel()

  // Watch for theme changes
  var obs = new MutationObserver(updateThemeLabel)
  obs.observe(document.body, { attributes: true, attributeFilter: ['data-theme'] })
})()
