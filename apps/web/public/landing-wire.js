/* Landing page interactivity (from Sovexa Landing.html) */
(function(){
  'use strict';

  // Stars — sprinkle twinkling dots into the atmosphere layer
  var host = document.getElementById('stars');
  if(host){
    for(var i = 0; i < 28; i++){
      var s = document.createElement('span');
      s.style.left = Math.random()*100 + '%';
      s.style.top = Math.random()*100 + '%';
      s.style.animationDelay = (Math.random()*4).toFixed(2) + 's';
      s.style.animationDuration = (3 + Math.random()*5).toFixed(2) + 's';
      host.appendChild(s);
    }
  }

  // Parallax — gently move blobs with mouse
  var blobs = document.querySelectorAll('.atmo .blob');
  if(blobs.length){
    var tx=0, ty=0, cx=0, cy=0;
    addEventListener('pointermove', function(e){
      tx = (e.clientX / innerWidth - .5) * 30;
      ty = (e.clientY / innerHeight - .5) * 30;
    }, {passive:true});
    function blobTick(){
      cx += (tx-cx)*.04; cy += (ty-cy)*.04;
      blobs.forEach(function(b, i){
        var m = (i+1)*.5;
        b.style.translate = (cx*m)+'px '+(cy*m)+'px';
      });
      requestAnimationFrame(blobTick);
    }
    blobTick();
  }

  // Rotating word in hero
  var morphEl = document.getElementById('morph');
  if(morphEl){
    var slot = morphEl.querySelector('.slot');
    var words = ['CEO.','editor.','founder.','director.','CEO.'];
    var wi = 0;
    var meas = document.createElement('span');
    meas.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font:inherit;font-style:italic';
    document.body.appendChild(meas);
    function widthOf(w){ meas.textContent = w; return meas.offsetWidth; }
    if(slot){
      slot.style.width = widthOf(words[0]) + 'px';
      function nextWord(){
        var cur = slot.querySelector('.on');
        if(!cur) return;
        var nxt = document.createElement('span');
        nxt.textContent = words[(wi+1) % words.length];
        slot.appendChild(nxt);
        slot.style.width = widthOf(words[(wi+1) % words.length]) + 'px';
        requestAnimationFrame(function(){
          cur.classList.remove('on');
          cur.classList.add('out');
          nxt.classList.add('on');
          setTimeout(function(){ cur.remove(); }, 700);
        });
        wi = (wi+1) % words.length;
      }
      setTimeout(function(){ setInterval(nextWord, 2400); }, 3000);
    }
  }

  // Live pipeline simulation
  var agents = document.querySelectorAll('.agent');
  var connectors = document.querySelectorAll('.agent-connector');
  if(agents.length){
    var idx = 0;
    function pipeStep(){
      agents.forEach(function(a){
        a.classList.remove('active');
        var rt = a.querySelector('.rt span:last-child');
        if(rt) rt.textContent = 'IDLE';
      });
      connectors.forEach(function(c){ c.classList.remove('handoff'); });

      var cur = agents[idx];
      cur.classList.add('active');
      var rt = cur.querySelector('.rt span:last-child');
      if(rt) rt.textContent = 'WORKING';

      var taskEl = cur.querySelector('.task');
      if(taskEl && taskEl.dataset.tasks){
        var tasks = JSON.parse(taskEl.dataset.tasks);
        var ti = 0;
        taskEl.innerHTML = tasks[0];
        var taskTimer = setInterval(function(){
          ti = (ti+1) % tasks.length;
          taskEl.style.opacity = 0;
          setTimeout(function(){ taskEl.innerHTML = tasks[ti]; taskEl.style.opacity = 1; }, 200);
        }, 1100);

        setTimeout(function(){
          clearInterval(taskTimer);
          if(idx < agents.length-1) connectors[idx].classList.add('handoff');
          idx = (idx+1) % agents.length;
          if(idx === 0){
            agents.forEach(function(a){
              var bar = a.querySelector('.bar');
              if(bar){ bar.style.animation='none'; setTimeout(function(){ bar.style.animation=''; }, 50); }
            });
          }
          pipeStep();
        }, 3500);
      }
    }
    pipeStep();
  }

  // Ticker micro-updates
  var tkPosts = document.getElementById('tk-posts');
  var tkReach = document.getElementById('tk-reach');
  var tkHrs = document.getElementById('tk-hrs');
  if(tkPosts && tkReach && tkHrs){
    var p = 21, r = 1.8, h = 28.4;
    setInterval(function(){
      if(Math.random() > 0.6){ p++; tkPosts.innerHTML = '<em>' + p + '</em> posts'; }
      if(Math.random() > 0.4){ r = +(r + Math.random()*0.03).toFixed(2); tkReach.innerHTML = '<em>' + r + '</em>M'; }
      if(Math.random() > 0.5){ h = +(h + 0.1).toFixed(1); tkHrs.innerHTML = '<em>' + h + '</em>h saved'; }
    }, 2200);
  }

  // Reveal on scroll
  var revealEls = document.querySelectorAll('.reveal');
  if(revealEls.length){
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, {threshold:.15, rootMargin:'0px 0px -8% 0px'});
    revealEls.forEach(function(el){ io.observe(el); });
  }

  // Stats count-up
  var statEls = document.querySelectorAll('.stats');
  if(statEls.length){
    var statIO = new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if(!e.isIntersecting) return;
        e.target.querySelectorAll('[data-count]').forEach(function(el){
          var target = +el.dataset.count;
          var suffix = el.innerHTML.replace(/<em>0<\/em>/,'').trim();
          var start = performance.now();
          function countTick(t){
            var prog = Math.min(1, (t-start)/1400);
            var eased = 1 - Math.pow(1-prog, 3);
            var n = Math.round(target * eased);
            el.innerHTML = '<em>' + n.toLocaleString() + '</em>' + suffix;
            if(prog < 1) requestAnimationFrame(countTick);
          }
          requestAnimationFrame(countTick);
        });
        statIO.unobserve(e.target);
      });
    }, {threshold:.4});
    statEls.forEach(function(el){ statIO.observe(el); });
  }

  // How it works — cycling frames + click
  var howSteps = document.querySelectorAll('.how-step');
  var howFrames = document.querySelectorAll('.how-frame');
  if(howSteps.length && howFrames.length){
    var howCur = 1;
    var howTimer;
    function howShow(n, user){
      howCur = n;
      howSteps.forEach(function(s){ s.classList.toggle('on', +s.dataset.f === n); });
      howFrames.forEach(function(f){ f.classList.toggle('on', +f.dataset.f === n); });
      if(user){ clearInterval(howTimer); howTimer = setInterval(howAdvance, 5500); }
    }
    function howAdvance(){ howShow(howCur % 4 + 1); }
    howSteps.forEach(function(s){
      s.addEventListener('click', function(){ howShow(+s.dataset.f, true); });
    });
    var howSec = document.getElementById('how');
    if(howSec){
      var howIO = new IntersectionObserver(function(entries){
        entries.forEach(function(e){
          if(e.isIntersecting){ howTimer = setInterval(howAdvance, 5500); }
          else { clearInterval(howTimer); }
        });
      }, {threshold:.2});
      howIO.observe(howSec);
    }
  }

  // Marquee speed pause on hover
  var marquee = document.querySelector('.marquee');
  if(marquee){
    marquee.addEventListener('mouseenter', function(){
      var track = this.querySelector('.track');
      if(track) track.style.animationPlayState = 'paused';
    });
    marquee.addEventListener('mouseleave', function(){
      var track = this.querySelector('.track');
      if(track) track.style.animationPlayState = 'running';
    });
  }
})();
