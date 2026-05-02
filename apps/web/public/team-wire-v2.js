/* Team page interactivity (autonomy toggles) */
(function(){
  'use strict';

  // Toggle switches on team member cards
  document.querySelectorAll('#view-db-team .toggle').forEach(function(t){
    t.addEventListener('click', function(){ t.classList.toggle('off'); });
  });
})();
