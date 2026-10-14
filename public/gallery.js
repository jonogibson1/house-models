/* Small Build Co: gallery of finished models, shown in the same viewer as the order preview. */
(function(){
  'use strict';
  var list=null, cache={}, cur=null, busy=0;
  function el(t,c,x){ var e=document.createElement(t); if(c) e.className=c; if(x!=null) e.textContent=x; return e; }
  var parseSTL=window.parseSTL;
  function spec(m){
    var box=document.getElementById('gal-spec'); box.textContent='';
    box.appendChild(el('h3',null,m.name));
    box.appendChild(el('p','muted',m.place));
    var dl=el('dl','spec');
    [['Scale',m.scale],['Printed size',m.size[0].toFixed(0)+' x '+m.size[1].toFixed(0)+' x '+m.size[2].toFixed(0)+' mm'],['Finish','White, one piece']].concat(m.price?[['Price','A$'+m.price+' ('+({simple:'Simple',standard:'Standard',complex:'Complex'}[m.level]||'')+' detail, '+m.litres.toFixed(1)+' L)']]:[]).forEach(function(r){ dl.appendChild(el('dt',null,r[0])); dl.appendChild(el('dd',null,r[1])); });
    box.appendChild(dl);
  }
  function show(m){
    cur=m; var tok=++busy;
    Array.prototype.forEach.call(document.querySelectorAll('#gal-tabs .btn'),function(b){ b.setAttribute('aria-pressed', b.dataset.id===m.id?'true':'false'); });
    spec(m);
    var v=viewer('gallery',true); v.mount(document.getElementById('stage-gallery'));
    var p = cache[m.id] ? Promise.resolve(cache[m.id]) : fetch(m.file).then(function(r){ if(!r.ok) throw new Error(r.status); return r.arrayBuffer(); }).then(function(b){ cache[m.id]=parseSTL(b); return cache[m.id]; });
    p.then(function(res){ if(tok!==busy) return; v.spin=true; v.set(res); })
     .catch(function(){ var s=document.getElementById('stage-gallery'); s.textContent=''; var n=el('div','nogl','This model could not be loaded. Try again in a moment.'); s.appendChild(n); });
  }
  window.showModels=function(){
    var tabs=document.getElementById('gal-tabs');
    if(list){ if(cur) show(cur); return; }
    fetch('/models/index.json').then(function(r){ return r.json(); }).then(function(ms){
      list=ms; tabs.textContent='';
      ms.forEach(function(m){ var b=el('button','btn ghost sm',m.place.split(',')[0]+'  '+m.scale+(m.price?'  A$'+m.price:'')); b.type='button'; b.dataset.id=m.id; b.addEventListener('click',function(){ show(m); }); tabs.appendChild(b); });
      show(ms[0]);
    });
  };
})();
