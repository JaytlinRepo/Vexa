/* HQ Dashboard interactivity (from CEO Dashboard standalone page) */
(function(){
  'use strict';

  // Pipeline node focus (filter approvals)
  document.querySelectorAll('#pipe .node').forEach(function(n){
    n.addEventListener('click', function(){
      var was = n.classList.contains('active');
      document.querySelectorAll('#pipe .node').forEach(function(x){ x.classList.remove('active'); });
      if(!was) n.classList.add('active');
    });
  });

  // Alex progress tick
  var pct = 72;
  setInterval(function(){
    var el = document.getElementById('alex-prog');
    var eta = document.getElementById('alex-eta');
    if(el && eta && pct < 99){
      pct += 0.3;
      el.style.width = pct + '%';
      eta.textContent = Math.round(pct) + '% \u00b7 writing';
    }
  }, 900);

  // Live clock in pipeline hero
  function tick(){
    var liveEl = document.querySelector('.pipe-meta .live');
    if(!liveEl) return;
    var d = new Date();
    var hh = String(d.getHours()).padStart(2,'0');
    var mm = String(d.getMinutes()).padStart(2,'0');
    var ss = String(d.getSeconds()).padStart(2,'0');
    liveEl.innerHTML = '<span class="dd"></span>LIVE \u00b7 ' + hh + ':' + mm + ':' + ss;
  }
  tick();
  setInterval(tick, 1000);

  // Knowledge tabs
  document.querySelectorAll('#k-tabs button').forEach(function(b){
    b.addEventListener('click', function(){
      document.querySelectorAll('#k-tabs button').forEach(function(x){ x.classList.remove('on'); });
      b.classList.add('on');
      var k = b.dataset.k;
      document.querySelectorAll('.k-item').forEach(function(it){
        it.style.display = (k === 'all' || it.dataset.kind === k) ? '' : 'none';
      });
    });
  });

  // Posts tabs on HQ dashboard
  document.querySelectorAll('.posts-card .ph .f span').forEach(function(s){
    s.addEventListener('click', function(){
      document.querySelectorAll('.posts-card .ph .f span').forEach(function(x){ x.classList.remove('on'); });
      s.classList.add('on');
    });
  });

  // Card approve animation
  document.querySelectorAll('.app-card .btn.primary').forEach(function(btn){
    btn.addEventListener('click', function(){
      var c = btn.closest('.app-card');
      if(!c) return;
      c.style.transition = 'opacity .4s, transform .4s';
      c.style.opacity = '0';
      c.style.transform = 'translateX(16px)';
      setTimeout(function(){ c.style.display = 'none'; }, 420);
    });
  });
})();
