// Shared shell for Vexa tabs — tweaks panel, theme toggle, persistence
(function(){
  const defaults = { theme:'light', accent:'amber' };
  const saved = (()=>{ try{ return JSON.parse(localStorage.getItem('vexa-tw')||'{}'); }catch(e){ return {}; } })();
  let state = Object.assign({}, defaults, saved);

  function apply(){
    document.body.setAttribute('data-theme', state.theme);
    document.body.setAttribute('data-accent', state.accent);
    document.querySelectorAll('#tweaks [data-tk]').forEach(grp=>{
      const k = grp.dataset.tk;
      grp.querySelectorAll('[data-v]').forEach(b=>b.classList.toggle('on', b.dataset.v===state[k]));
    });
    const tb = document.getElementById('theme-btn');
    if(tb) tb.textContent = state.theme==='dark'?'☾':'☀';
  }
  function setKey(k,v){
    state[k]=v; apply();
    try{ localStorage.setItem('vexa-tw', JSON.stringify(state)); }catch(e){}
    try{ window.parent.postMessage({type:'__edit_mode_set_keys',edits:{[k]:v}},'*'); }catch(e){}
  }
  window.vexaSet = setKey;
  document.addEventListener('DOMContentLoaded',()=>{
    document.querySelectorAll('#tweaks [data-tk]').forEach(grp=>{
      const k = grp.dataset.tk;
      grp.addEventListener('click', e=>{
        const b = e.target.closest('[data-v]'); if(!b) return;
        setKey(k, b.dataset.v);
      });
    });
    const tb = document.getElementById('theme-btn');
    if(tb) tb.addEventListener('click',()=>setKey('theme', state.theme==='dark'?'light':'dark'));
    const tx = document.getElementById('tw-x');
    if(tx) tx.addEventListener('click',()=>document.getElementById('tweaks').classList.remove('show'));
    apply();
  });
  window.addEventListener('message',(e)=>{
    const t = e.data && e.data.type;
    const el = document.getElementById('tweaks'); if(!el) return;
    if(t==='__activate_edit_mode') el.classList.add('show');
    if(t==='__deactivate_edit_mode') el.classList.remove('show');
  });
  try{ window.parent.postMessage({type:'__edit_mode_available'},'*'); }catch(e){}
})();
