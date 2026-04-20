/* Posts page interactivity (filter chip toggling) */
(function(){
  'use strict';

  // Filter chip toggle within same group
  document.querySelectorAll('#view-db-posts .fgroup').forEach(function(g){
    g.addEventListener('click', function(e){
      var b = e.target.closest('.fchip');
      if(!b) return;
      g.querySelectorAll('.fchip').forEach(function(x){ x.classList.remove('on'); });
      b.classList.add('on');
    });
  });
})();
