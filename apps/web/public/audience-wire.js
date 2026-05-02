/* Audience page interactivity (heatmap generation, chip toggles) */
(function(){
  'use strict';

  // Generate the heatmap: 7 rows (days) x 24 hours
  var root = document.getElementById('heat');
  if(!root) return;

  var days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  // Base activity by hour (0-23): low night, morning peak, midday dip, evening rise
  var hourBase = [0.15,0.1,0.08,0.06,0.07,0.1,0.22,0.45,0.62,0.58,0.48,0.42,0.52,0.5,0.48,0.52,0.62,0.72,0.82,0.88,0.82,0.68,0.52,0.3];
  // Day multipliers — Sun evening peaks hard
  var dayMult = [1.0,1.0,1.0,1.05,1.1,1.15,1.28]; // Mon..Sun

  days.forEach(function(d, di){
    var lbl = document.createElement('div');
    lbl.className = 'day';
    lbl.textContent = d;
    root.appendChild(lbl);
    for(var h = 0; h < 24; h++){
      var cell = document.createElement('div');
      cell.className = 'hr';
      var v = hourBase[h] * dayMult[di];
      // Sun 19-22 extra boost
      if(di === 6 && h >= 19 && h <= 22) v = Math.min(1, v * 1.25);
      // tiny jitter
      v = Math.max(0, Math.min(1, v + (Math.random() - 0.5) * 0.08));
      var pct = Math.round(v * 100);
      cell.style.background = 'color-mix(in srgb, var(--accent) ' + pct + '%, var(--bg))';
      if(v > 0.2) cell.style.borderColor = 'transparent';
      cell.title = d + ' ' + String(h).padStart(2,'0') + ':00 \u00b7 ' + pct + '% activity';
      root.appendChild(cell);
    }
  });

  // Scope chip toggle
  document.querySelectorAll('#view-db-audience .scope').forEach(function(scope){
    scope.addEventListener('click', function(e){
      var b = e.target.closest('.chip');
      if(!b) return;
      // Find sibling chips in the same label group
      var prev = b.previousElementSibling;
      while(prev && !prev.classList.contains('lab')) prev = prev.previousElementSibling;
      var next = b;
      var siblings = [];
      while(next){
        if(next.classList.contains('chip')) siblings.push(next);
        next = next.nextElementSibling;
        if(next && next.classList.contains('lab')) break;
      }
      siblings.forEach(function(x){ x.classList.remove('on'); });
      b.classList.add('on');
    });
  });
})();
