(function(){
'use strict';
var G = window.HouseGen;
var $ = function(s, r){ return (r||document).querySelector(s); };
var $$ = function(s, r){ return Array.prototype.slice.call((r||document).querySelectorAll(s)); };
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
function money(n){ return 'A$' + Math.round(n); }
function money2(n){ return 'A$' + (+n).toFixed(2); }
function when(t){ try{ return new Date(t).toLocaleString('en-AU',{weekday:'short',day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}); }catch(e){ return ''; } }
function kb(n){ return n > 1048576 ? (n/1048576).toFixed(1)+' MB' : Math.max(1,Math.round(n/1024))+' KB'; }
var toastT;
function toast(msg){ var t=$('#toast'); t.textContent=msg; t.hidden=false; clearTimeout(toastT); toastT=setTimeout(function(){t.hidden=true;},4200); }
function clone(o){ return JSON.parse(JSON.stringify(o)); }
function copyBox(id,label,url){ return '<div class="field"><label for="'+id+'">'+label+'</label><div class="row" style="flex-wrap:nowrap"><input type="text" id="'+id+'" class="mono" readonly value="'+esc(url)+'"><button type="button" class="btn ghost sm" data-copy="'+id+'">Copy</button></div></div>'; }
document.addEventListener('click',function(e){
  var b=e.target.closest('[data-copy]'); if(!b) return; var inp=document.getElementById(b.getAttribute('data-copy')); if(!inp) return;
  function fallback(){ inp.focus(); inp.select(); toast('Link selected. Copy it from here.'); }
  try{ navigator.clipboard.writeText(inp.value).then(function(){ toast('Link copied.'); }, fallback); }catch(_){ fallback(); }
});

/* Sample on the home page: a typical single-storey brick home, about 19 x 9 m, hip roof at 22.5 degrees, garage at the front. */
var SAMPLE = { scale:'auto', blocks:[
  {name:'Main house',x:0,y:0,w:18.95,d:7.55,storeys:1,storeyH:2.74,roof:'hip',pitch:22.5,eave:0.45,ridge:'auto',high:'n'},
  {name:'Garage and porch',x:11.51,y:3.83,w:7.44,d:4.92,storeys:1,storeyH:2.74,roof:'hip',pitch:22.5,eave:0.45,ridge:'auto',high:'n'} ]};
function treeOf(params){ var t=clone(params); t.ornament=true; return t; }
function itemName(c){ return c==='stl'?'STL files':c==='tree'?'Christmas tree version':'Printed model'; }

/* ---------- state: orders live on the server; this browser only remembers which ones are its own ---------- */
var LS='fhm-live-v1';
var mem = null;
try{ mem = JSON.parse(localStorage.getItem(LS)); }catch(e){}
if(!mem || !Array.isArray(mem.mine)) mem = { mine:[], current:null };
function save(){ try{ localStorage.setItem(LS, JSON.stringify(mem)); }catch(e){} }
function keyOf(id){ for(var i=0;i<mem.mine.length;i++) if(mem.mine[i].id===id) return mem.mine[i].k; return ''; }
function remember(id,k){ if(!keyOf(id)) mem.mine.unshift({id:id,k:k}); mem.current=id; save(); }
var cur = null;                                   // the order on screen, as the server last gave it
var cfg = { pricing:{min:200,fee:120,perGram:1.2,stl:45,tree:60}, ready:true };
var admin = { key:'', ok:false, orders:[], sel:null, err:'', gen:0 };
try{ admin.key = sessionStorage.getItem('fhm-owner') || ''; }catch(e){}
var ui = { pay:false, pending:null, err:'', busy:'', edit:null };
var memFrag = {};                                 // the read request for each new order stays in this tab so a failed read can be retried

function api(method, path, body, raw){
  var opts={ method:method, headers:{} };
  if(path.indexOf('/api/admin')===0) opts.headers['x-admin-key']=admin.key;
  if(body!==undefined){ opts.body = raw ? body : JSON.stringify(body); opts.headers['content-type'] = raw ? 'text/plain' : 'application/json'; }
  var offline='The site could not be reached. Check your connection and try again.';
  return fetch(path,opts).then(function(r){
    return r.json().catch(function(){ return null; }).then(function(j){
      if(!r.ok || !j) throw { status:r.status, message:(j && j.error && j.error.message) || offline };
      return j; });
  }, function(){ throw { status:0, message:offline }; });
}
function opath(id, step){ return '/api/orders/'+id+(step||'')+'?k='+encodeURIComponent(keyOf(id)); }
function orderLink(id,k){ return location.origin+'/?o='+id+'.'+k; }

var cache = {};
function built(params, res){
  var k = res + JSON.stringify(params);
  if(!cache[k]){ var n=0; for(var x in cache) n++; if(n>12) cache={}; cache[k] = G.build(params, res); }
  return cache[k];
}
/* Used for the sample on the home page and the owner's live editor. Orders themselves carry the server's quote. */
var POST = [[0.25,10.20],[0.5,11.70],[1,16.00],[3,20.25],[5,24.45]];
function printPrice(r){ var p=cfg.pricing; return Math.max(p.min, Math.round(p.fee + Math.ceil(r.grams) * p.perGram)); }
function shipFor(r){
  var pad=20, L=Math.max(120,Math.ceil((r.size[0]+2*pad)/5)*5), W=Math.max(100,Math.ceil((r.size[1]+2*pad)/5)*5), H=Math.max(60,Math.ceil((r.size[2]+2*pad)/5)*5);
  var actual=(r.grams+150)/1000, cubic=L*W*H/1e9*250, kg=Math.max(actual,cubic), cost=POST[POST.length-1][1];
  for(var i=0;i<POST.length;i++) if(kg<=POST[i][0]){ cost=POST[i][1]; break; }
  return { cost:cost, box:[L,W,H], kg:kg, actual:actual, cubic:cubic };
}

var STATUS = { received:['Plans received','att'], revision:['Change requested','att'], unreadable:['Could not read','bad'], preview:['Preview sent',''], hold_placed:['Needs your OK','att'],
  accepted:['Confirmed, paid','ok'], printing:['Printing','ok'], ready:['Ready','ok'], collected:['Collected',''], delivered:['File sent','ok'], declined:['Declined','bad'] };
function pill(o){ var s=STATUS[o.status]||['?','']; var t=s[0]; if(o.status==='ready') t=o.delivery==='post'?'Posted':'Ready for pickup'; if(o.status==='received' && o.aiErr) t='Read failed'; return '<span class="pill '+s[1]+'">'+t+'</span>'; }

/* ---------- 3D viewer ---------- */
function cssVar(n){ return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888'; }
function Viewer(spin){
  this.az=-0.75; this.el=0.52; this.dist=300; this.explode=false; this.spin=!!spin; this.ok=false; this.holder=null; this.result=null;
  if(!window.THREE) return;
  try{
    this.r = new THREE.WebGLRenderer({antialias:true});
    this.r.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(32,4/3,1,5000);
    this.scene.add(new THREE.HemisphereLight(0xffffff,0x3a5248,0.95));
    var d=new THREE.DirectionalLight(0xffffff,0.75); d.position.set(120,260,160); this.scene.add(d);
    this.world = new THREE.Group(); this.world.rotation.x=-Math.PI/2; this.scene.add(this.world);
    this.model = new THREE.Group(); this.world.add(this.model);
    this.deco = new THREE.Group(); this.world.add(this.deco);
    this.ok = true;
  }catch(e){ this.ok=false; return; }
  var self=this, drag=null;
  var c=this.r.domElement;
  c.addEventListener('pointerdown',function(e){ drag={x:e.clientX,y:e.clientY}; self.spin=false; try{c.setPointerCapture(e.pointerId);}catch(_){} });
  c.addEventListener('pointermove',function(e){ if(!drag) return; self.az-=(e.clientX-drag.x)*0.01; self.el=Math.max(0.08,Math.min(1.45,self.el+(e.clientY-drag.y)*0.006)); drag={x:e.clientX,y:e.clientY}; self.draw(); });
  ['pointerup','pointercancel','pointerleave'].forEach(function(n){ c.addEventListener(n,function(){ drag=null; }); });
  this.ro = window.ResizeObserver ? new ResizeObserver(function(){ self.size(); }) : null;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(spin && !reduce){ (function loop(){ if(self.spin && self.holder && self.holder.offsetParent!==null){ self.az+=0.0022; self.draw(); } if(self.spin) requestAnimationFrame(loop); })(); }
}
Viewer.prototype.mount=function(holder, opts){
  opts=opts||{}; this.holder=holder; holder.textContent='';
  if(!this.ok){ var n=document.createElement('div'); n.className='nogl'; n.textContent='The 3D preview needs WebGL, which this browser has switched off.'; holder.appendChild(n); return; }
  holder.appendChild(this.r.domElement);
  if(opts.watermark){ var w=document.createElement('div'); w.className='wm'; w.setAttribute('aria-hidden','true'); holder.appendChild(w); }
  var self=this, tools=document.createElement('div'); tools.className='tools';
  var b=document.createElement('button'); b.type='button'; b.textContent='Lift roof'; b.setAttribute('aria-pressed',String(this.explode));
  b.addEventListener('click',function(){ self.explode=!self.explode; b.setAttribute('aria-pressed',String(self.explode)); self.place(); self.draw(); });
  tools.appendChild(b); holder.appendChild(tools);
  if(this.ro){ this.ro.disconnect(); this.ro.observe(holder); }
  this.size();
};
Viewer.prototype.size=function(){ if(!this.ok||!this.holder) return; var w=this.holder.clientWidth, h=this.holder.clientHeight; if(!w||!h) return; this.r.setSize(w,h,false); this.cam.aspect=w/h; this.cam.updateProjectionMatrix(); this.draw(); };
Viewer.prototype.set=function(result){
  if(!this.ok) return; this.result=result; var self=this;
  [this.model,this.deco].forEach(function(g){ while(g.children.length){ var m=g.children.pop(); if(m.geometry) m.geometry.dispose(); if(m.material) m.material.dispose(); } });
  this.scene.background = new THREE.Color(cssVar('--mat'));
  var cx=result.size[0]/2, cy=result.size[1]/2;
  result.parts.forEach(function(p){
    var g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(p.tris,3)); g.computeVertexNormals();
    var m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:new THREE.Color(cssVar(p.kind==='roof'?'--roof':'--wall')),roughness:0.85,metalness:0,flatShading:true}));
    m.userData.part=p; m.position.set(-cx,-cy,p.z0); self.model.add(m);
  });
  var span=Math.max(260,Math.max(result.size[0],result.size[1])*1.6);
  var grid=new THREE.GridHelper(Math.ceil(span/10)*10*2, Math.ceil(span/10)*2, new THREE.Color(cssVar('--mat-line')), new THREE.Color(cssVar('--mat-line')));
  grid.rotation.x=Math.PI/2; grid.position.z=-0.05; grid.material.transparent=true; grid.material.opacity=0.55; this.deco.add(grid);
  var land = result.size[0] >= result.size[1], aw=land?210:148, ah=land?148:210;
  var pts=[[-aw/2,-ah/2],[aw/2,-ah/2],[aw/2,ah/2],[-aw/2,ah/2],[-aw/2,-ah/2]].map(function(p){ return new THREE.Vector3(p[0],p[1],0.05); });
  this.deco.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({color:new THREE.Color(cssVar('--rule'))})));
  /* A standard 375 ml drink can beside the model, for size: 66 mm across, 122 mm tall. */
  var can=new THREE.Group(), R=33, CH=122;
  function cyl(r1,r2,h,z,col,metal){ var c=new THREE.Mesh(new THREE.CylinderGeometry(r1,r2,h,48), new THREE.MeshStandardMaterial({color:col,roughness:metal?0.35:0.5,metalness:metal?0.7:0.1})); c.rotation.x=Math.PI/2; c.position.z=z+h/2; can.add(c); }
  cyl(R-3,R-6,5,0,0xc9ccd1,true); cyl(R,R-3,4,5,0xc9ccd1,true); cyl(R,R,CH-20,9,0xc8102e,false); cyl(R*0.98,R*0.98,6,CH-15,0xf2f2f2,false);
  cyl(R-4,R,4,CH-9,0xc9ccd1,true); cyl(R-5,R-4,5,CH-5,0xc9ccd1,true);
  can.position.set(cx+R+22, -cy+R, 0); this.deco.add(can);
  var wide=result.size[0]+2*R+22;
  this.dist=Math.max(250,Math.max(wide*1.15,result.size[1],CH*1.55)*1.85);
  this.target=CH*0.3;
  this.model.position.x=-(2*R+22)/2; can.position.x+=-(2*R+22)/2;
  this.place(); this.draw();
};
Viewer.prototype.place=function(){ if(!this.ok) return; var ex=this.explode; this.model.children.forEach(function(m){ var p=m.userData.part; m.position.z=p.z0+(ex&&p.kind==='roof'?14:0); }); };
Viewer.prototype.draw=function(){
  if(!this.ok||!this.holder) return;
  var d=this.dist, t=this.target||10;
  this.cam.position.set(Math.sin(this.az)*Math.cos(this.el)*d, Math.sin(this.el)*d+t, Math.cos(this.az)*Math.cos(this.el)*d);
  this.cam.lookAt(0,t,0); this.r.render(this.scene,this.cam);
};
var V = { hero:null, order:null, queue:null };
function viewer(name, spin){ if(!V[name]) V[name]=new Viewer(spin); return V[name]; }

/* ---------- routing ---------- */
var VIEWS=['home','start','order','queue'], current='home';
function go(v, noHash){
  if(VIEWS.indexOf(v)<0) v='home';
  current=v;
  VIEWS.forEach(function(n){ $('#v-'+n).hidden = n!==v; });
  $$('.nav button').forEach(function(b){ if(b.getAttribute('data-go')===v) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current'); });
  if(!noHash){ try{ history.replaceState(null,'',location.pathname+'#'+v); }catch(e){ location.hash=v; } }
  if(v==='home') renderHome();
  if(v==='order') showOrder();
  if(v==='queue') showQueue();
  window.scrollTo(0,0);
}
document.addEventListener('click',function(e){ var b=e.target.closest('[data-go]'); if(b){ e.preventDefault(); go(b.getAttribute('data-go')); } });
window.addEventListener('hashchange',function(){ go(location.hash.replace('#',''), true); });

/* ---------- home ---------- */
var PIC_SVG = '<svg viewBox="0 0 300 240" role="img" aria-label="Drawing of a 3D printer with a small house model on its bed">'
 + '<rect width="300" height="240" fill="var(--quiet-bg)"/><rect x="0" y="182" width="300" height="58" fill="var(--line)"/>'
 + '<rect x="62" y="38" width="176" height="150" rx="10" fill="none" stroke="var(--ink)" stroke-width="5"/>'
 + '<rect x="62" y="38" width="176" height="20" rx="8" fill="var(--ink)"/>'
 + '<rect x="84" y="70" width="132" height="6" rx="3" fill="var(--muted)"/><rect x="138" y="64" width="24" height="26" rx="4" fill="var(--ink)"/><path d="M146 90h8l-4 9z" fill="var(--rule)"/>'
 + '<rect x="86" y="160" width="128" height="9" rx="2" fill="var(--mat)"/>'
 + '<path d="M118 160v-22h64v22z" fill="var(--wall)" stroke="var(--ink)" stroke-width="1.5"/><path d="M112 140l38-22 38 22z" fill="var(--roof)"/>'
 + '<circle cx="228" cy="48" r="4" fill="var(--rule)"/></svg>';
var home = { tree:false };
document.addEventListener('click',function(e){ var b=e.target.closest('[data-hero]'); if(!b) return; home.tree = b.getAttribute('data-hero')==='tree'; renderHome(); });
function renderHome(){
  var p=cfg.pricing, r=built(SAMPLE,0.8), sh=shipFor(r);
  $('#price-print').textContent='From '+money(p.min);
  $('#price-print-note').textContent='For most single-storey homes, including the sample above. Larger homes use more filament and cost a little more. You see your exact price with your preview, before you commit to anything. Pickup is free. Postage is Australia Post at cost, '+money2(sh.cost)+' for the sample home.';
  $('#price-stl').textContent=money(p.stl);
  $('#price-tree').textContent=money(p.tree!=null?p.tree:60);
  var tr=built(treeOf(SAMPLE),0.8);
  $('#price-tree-note').textContent='Your house again at about 1:'+tr.scale+', small enough to hang on the tree: the sample is '+Math.round(tr.size[0])+' mm across. Comes with a ribbon through the roof. Same preview, same hold, same pickup or post.';
  var heroTree = home.tree;
  $$('[data-hero]').forEach(function(b){ b.setAttribute('aria-pressed', String((b.getAttribute('data-hero')==='tree')===heroTree)); });
  $$('.from-price').forEach(function(el){ el.textContent=money(p.min); });
  $('#about-pic').innerHTML=PIC_SVG;
  var v=viewer('hero',true); if(v.holder!==$('#stage-hero')) v.mount($('#stage-hero')); v.set(heroTree?tr:r);
  $('#hero-cap').textContent = heroTree ? 'The Christmas tree version of the same home, about 1:'+tr.scale+'. The can is a standard 375 ml drink can. Drag to turn it.'
    : 'A sample single-storey home at 1:'+r.scale+'. The can is a standard 375 ml drink can and the yellow outline an A5 page. Drag to turn it.';
}

/* ---------- turning the PDF into pages Claude can read ---------- */
var IMG_PREFIX='{"type":"image","source":{"type":"base64","media_type":"image/jpeg","data":"';
function part(src,x,y,w,h,max){
  var s=Math.min(1,(max||99999)/Math.max(w,h)), c=document.createElement('canvas'); c.width=Math.round(w*s); c.height=Math.round(h*s);
  var ctx=c.getContext('2d'); ctx.fillStyle='#fff'; ctx.fillRect(0,0,c.width,c.height); ctx.drawImage(src,x,y,w,h,0,0,c.width,c.height);
  var b=c.toDataURL('image/jpeg',0.76).split(',')[1]; c.width=c.height=0; return b;
}
function loadImage(file){ return new Promise(function(res,rej){ var u=URL.createObjectURL(file), im=new Image(); im.onload=function(){ res(im); }; im.onerror=function(){ URL.revokeObjectURL(u); rej(); }; im.src=u; }); }
async function prep(files, prog){
  var maxN=20, docs=[], total=0, i;
  for(i=0;i<files.length;i++){ var buf=new Uint8Array(await files[i].arrayBuffer()); var doc=await window.pdfjsLib.getDocument({data:buf}).promise; docs.push(doc); total+=doc.numPages; }
  /* Real plan sets run to 20 or more sheets. Rank each sheet by its words, keep the floor plan, elevations and roof plan
     at full detail, and drop electrical, detail and similar sheets that say nothing about the outside shape. */
  /* Sheet titles are set in big type, so the big words on each sheet decide what it is. */
  var W=[[/(^|[^b])floor\s*plan/g,8],[/roof\s*plan/g,7],[/elevation/g,6],[/section/g,3],[/site\s*plan/g,1],
    [/internal|interior|electrical|lighting|bracing|tie\s*down|sub\s*floor|floor\s*covering|detail|landscap|slab\s*(plan|layout)|drainage|cover\s*sheet|schedule|joinery/g,-7]];
  var all=[], at=0;
  for(var d0=0; d0<docs.length; d0++) for(var p0=1; p0<=docs[d0].numPages; p0++){
    at++; prog('Looking through your plans, sheet '+at+' of '+total);
    var words='', sc0=0;
    try{
      var it0=(await (await docs[d0].getPage(p0)).getTextContent()).items.filter(function(t){ return (t.str||'').trim(); });
      var hs=it0.map(function(t){ return Math.hypot(t.transform[2],t.transform[3]); }).sort(function(a,b){ return a-b; }), med=hs[Math.floor(hs.length/2)]||0;
      words=it0.filter(function(t){ return Math.hypot(t.transform[2],t.transform[3])>=med*1.8; }).map(function(t){ return t.str; }).join(' / ').toLowerCase();
    }catch(e){}
    W.forEach(function(w){ var m=words.match(w[0]); if(m) sc0+=w[1]*Math.min(m.length,2); });
    all.push({d:d0,p:p0,no:at,score:sc0});
  }
  var ranked=all.slice().sort(function(a,b){ return b.score-a.score || a.no-b.no; });
  var good=ranked.filter(function(x){ return x.score>0; });
  var pick, used;
  if(good.length>=2){
    pick=good.slice(0,Math.min(8,maxN)); used=pick.length; pick.forEach(function(x){ x.per=1; });
    for(var k0=0;k0<pick.length;k0++){ if(pick[k0].score>=6 && used+4<=maxN){ pick[k0].per=5; used+=4; } }
  } else {
    /* No readable sheet titles: send the first sheets in order, as much detail as fits. */
    pick=all.slice(0,12); var per0 = maxN>=pick.length*5 ? 5 : 1; if(per0===1) pick=pick.slice(0,maxN);
    pick.forEach(function(x){ x.per=per0; });
  }
  pick.sort(function(a,b){ return a.no-b.no; });
  var pages=pick.length, images=[], manifest=[], lines=[], n=0;
  for(var q0=0; q0<pick.length; q0++){
    var d=pick[q0].d, p=pick[q0].p, per=pick[q0].per;
    {
      n++; prog('Opening your plans, sheet '+n+' of '+pages);
      var page=await docs[d].getPage(p), v0=page.getViewport({scale:1}), sc=Math.min(4,(per===5?2400:1800)/Math.max(v0.width,v0.height)), vp=page.getViewport({scale:sc});
      var c=document.createElement('canvas'); c.width=Math.round(vp.width); c.height=Math.round(vp.height);
      var ctx=c.getContext('2d'); ctx.fillStyle='#fff'; ctx.fillRect(0,0,c.width,c.height);
      await page.render({canvasContext:ctx,viewport:vp}).promise;
      var w=c.width, h=c.height, ov=0.08;
      images.push(part(c,0,0,w,h,1300)); manifest.push('sheet '+pick[q0].no+' of '+total+', whole sheet');
      if(per===5){
        var qw=Math.round(w*(0.5+ov)), qh=Math.round(h*(0.5+ov));
        images.push(part(c,0,0,qw,qh)); manifest.push('sheet '+pick[q0].no+', top-left quarter enlarged');
        images.push(part(c,w-qw,0,qw,qh)); manifest.push('sheet '+pick[q0].no+', top-right quarter enlarged');
        images.push(part(c,0,h-qh,qw,qh)); manifest.push('sheet '+pick[q0].no+', bottom-left quarter enlarged');
        images.push(part(c,w-qw,h-qh,qw,qh)); manifest.push('sheet '+pick[q0].no+', bottom-right quarter enlarged');
      } else if(per===3){
        if(w>=h){ var hw=Math.round(w*(0.5+ov)); images.push(part(c,0,0,hw,h)); manifest.push('page '+n+', left half enlarged'); images.push(part(c,w-hw,0,hw,h)); manifest.push('page '+n+', right half enlarged'); }
        else { var hh=Math.round(h*(0.5+ov)); images.push(part(c,0,0,w,hh)); manifest.push('page '+n+', top half enlarged'); images.push(part(c,0,h-hh,w,hh)); manifest.push('page '+n+', bottom half enlarged'); }
      }
      try{
        var tc=await page.getTextContent(), cnt=0;
        for(var k=0;k<tc.items.length && cnt<350;k++){
          var str=(tc.items[k].str||'').trim(); if(!str) continue;
          var t=window.pdfjsLib.Util.transform(vp.transform, tc.items[k].transform);
          lines.push('p'+pick[q0].no+' x'+(t[4]/vp.width).toFixed(3)+' y'+(t[5]/vp.height).toFixed(3)+' '+JSON.stringify(str.slice(0,60))); cnt++;
        }
      }catch(e){}
      c.width=c.height=0;
      await new Promise(function(r){ setTimeout(r,0); });
    }
  }
  return { frag:images.map(function(b){ return IMG_PREFIX+b+'"}}'; }).join(','), manifest:manifest, text:lines.join('\n').slice(0,70000), pages:n };
}

/* ---------- upload ---------- */
var sampleF=null;
if(window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc='/vendor/pdf.worker.min.js';
function listFiles(files, ul){ ul.innerHTML = Array.prototype.map.call(files,function(f){ return '<li><span>'+esc(f.name)+'</span><span>'+kb(f.size)+'</span></li>'; }).join(''); }
$('#in-plans').addEventListener('change',function(){ sampleF=null; listFiles(this.files,$('#list-plans')); });
$('#fill-test').addEventListener('click',function(){
  $('#in-name').value='Test Neighbour'; $('#in-email').value='neighbour@example.com'; $('#in-addr').value='1 Test Street';
  ['c1','c2','c3'].forEach(function(c){ $('#in-'+c).checked=true; });
  toast('Details filled in. Add your PDF plans, or use the sample plan set.');
});
$('#use-sample').addEventListener('click',function(){
  fetch('/sample-house-plans.pdf').then(function(r){ if(!r.ok) throw 0; return r.blob(); }).then(function(b){
    sampleF=new File([b],'sample-house-plans.pdf',{type:'application/pdf'}); $('#in-plans').value=''; listFiles([sampleF],$('#list-plans'));
    toast('Sample plan set attached: floor plan, elevations and roof plan of a made-up house.');
  }, function(){ toast('The sample plans could not be loaded. Try again.'); });
});
$('#f-start').addEventListener('submit',function(e){
  e.preventDefault();
  var err=$('#start-err'), plans=sampleF ? [sampleF] : Array.prototype.slice.call($('#in-plans').files), msg='';
  var f={ name:$('#in-name').value.trim(), email:$('#in-email').value.trim(), addr:$('#in-addr').value.trim(), suburb:$('#in-suburb').value.trim() };
  if(!f.name) msg='Add your name.';
  else if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) msg='Add an email address so Jono can reach you about your model.';
  else if(!f.addr) msg='Add the street address of the house.';
  else if(!plans.length) msg='Add your building plans as a PDF. The model is built from them.';
  else if(plans.some(function(x){ return !/\.pdf$/i.test(x.name); })) msg='Plans need to be PDF files.';
  else if(!$('#in-c1').checked||!$('#in-c2').checked||!$('#in-c3').checked) msg='Tick all three boxes to continue.';
  if(msg){ err.textContent=msg; err.hidden=false; return; }
  err.hidden=true;
  this.reset(); $('#in-suburb').value='Ferny Hills'; $('#list-plans').innerHTML=''; sampleF=null;
  startOrder(f, plans);
});
function setPending(msg){ if(ui.pending){ ui.pending.msg=msg; var el=$('#read-msg'); if(el) el.textContent=msg; } }
async function startOrder(f, plans){
  ui.pending={ addr:f.addr+(f.suburb?', '+f.suburb:''), msg:'Getting ready' }; ui.err=''; cur=null; mem.current=null; ui.pay=false;
  go('order');
  var pack, id;
  try{
    if(!window.pdfjsLib) throw { message:'The PDF reader did not load. Reload the page and try again.' };
    try{ pack=await prep(plans, setPending); }catch(e){ throw { message:'That PDF could not be opened. Is it password protected?' }; }
    if(!pack.frag && !pack.text) throw { message:'No readable pages were found in that PDF.' };
    setPending('Sending your plans');
    f.files=plans.map(function(x){ return {name:x.name,size:x.size}; });
    var made=await api('POST','/api/orders',f);
    id=made.order.id; remember(id, made.key); cur=made.order;
    memFrag[id]=JSON.stringify({manifest:pack.manifest,text:pack.text,pages:pack.pages})+'\n'+pack.frag; pack=null;
    await readNow(id);
  }catch(e){ ui.pending=null; ui.err=e.message||'Something went wrong. Try again.'; renderOrder(); }
}
async function readNow(id){
  if(!ui.pending) ui.pending={ addr:cur?cur.addr:'', msg:'' };
  ui.err=''; renderOrder();
  setPending('Reading your plans and working out the house. This usually takes one to three minutes.');
  try{
    var res=await api('POST', opath(id,'/read'), memFrag[id]||'', true);
    cur=res.order; ui.pending=null; renderOrder();
    if(cur.status==='preview'){ delete memFrag[id]; toast('Your preview is ready.'); }
  }catch(e){ ui.pending=null; ui.err=e.message; renderOrder(); }
}

/* ---------- customer order ---------- */
function timeline(o){
  var steps = o.choice==='stl' ? ['Plans received','Preview ready','Card hold placed','Confirmed and charged','File sent']
    : ['Plans received','Preview ready','Card hold placed','Confirmed and charged','Printing', o.delivery==='post'?'Posted':'Ready for pickup'];
  var at = {received:0,revision:0,unreadable:0,preview:1,hold_placed:2,accepted:3,printing:4,ready:5,collected:5,delivered:4,declined:2}[o.status];
  var fin = o.status==='collected'||o.status==='delivered'||o.status==='ready';
  return '<ol class="tl">'+steps.map(function(s,i){ return '<li class="'+(i<at||(fin&&i===at)?'done':i===at?'now':'')+'">'+s+'</li>'; }).join('')+'</ol>';
}
function facts(o, choice){
  var q=o.quote;
  if(choice==='tree' && q.tree) return '<dl class="spec"><dt>Scale</dt><dd>1:'+q.tree.scale+'</dd><dt>Size</dt><dd>'+q.tree.size.map(function(v){return Math.round(v);}).join(' x ')+' mm</dd>'
   +'<dt>Hanging</dt><dd>ribbon through a hole in the roof</dd><dt>Filament</dt><dd>about '+q.tree.grams+' g</dd></dl>';
  return '<dl class="spec"><dt>Scale</dt><dd>1:'+q.scale+'</dd><dt>Model size</dt><dd>'+q.size.map(function(v){return Math.round(v);}).join(' x ')+' mm</dd>'
   +'<dt>Parts</dt><dd>'+q.parts.map(function(p){return esc(String(p.label).toLowerCase());}).join(', ')+'</dd><dt>Filament</dt><dd>about '+q.grams+' g</dd></dl>';
}
function ulist(a){ return '<ul class="plain">'+a.map(function(x){ return '<li>'+esc(x)+'</li>'; }).join('')+'</ul>'; }
function shipOf(o, choice){ return choice==='tree' && o.quote.tree ? o.quote.tree.ship : o.quote.ship; }
function totalsOf(o, choice, delivery){ var tr=choice==='tree' && o.quote.tree, price=choice==='stl'?o.quote.stl:tr?o.quote.tree.price:o.quote.print, ship=(choice!=='stl' && delivery==='post')?shipOf(o,choice).cost:0; return { price:price, ship:ship, total:price+ship }; }
function modelFor(o){ return o.choice==='tree' && o.quote && o.quote.tree ? treeOf(o.params) : o.params; }
var pollT=null;
function showOrder(){
  clearInterval(pollT);
  pollT=setInterval(function(){
    if(document.hidden || current!=='order' || !cur || ui.pending || ui.busy || ['hold_placed','accepted','printing'].indexOf(cur.status)<0) return;
    api('GET', opath(cur.id)).then(function(r){ if(cur && r.order.id===cur.id && r.order.status!==cur.status && !ui.busy){ cur=r.order; renderOrder(); toast('Your order has been updated.'); } }, function(){});
  }, 15000);
  if(ui.pending){ renderOrder(); return; }
  if(mem.current && (!cur || cur.id!==mem.current)){
    $('#order-root').innerHTML='<p class="muted">Fetching your order...</p>';
    api('GET', opath(mem.current)).then(function(r){ cur=r.order; renderOrder(); }, function(e){ cur=null; ui.err=e.status===404?'That order could not be found on this site.':e.message; renderOrder(); });
  } else renderOrder();
}
function renderOrder(){
  var root=$('#order-root'), o=cur, h='';
  if(ui.pending){
    root.innerHTML='<div class="stack" style="max-width:640px"><span class="eyebrow">Step 1 of 4</span><h2>Building your house</h2><div class="row" style="flex-wrap:nowrap;align-items:flex-start"><span class="spin" aria-hidden="true"></span><p id="read-msg" role="status">'+esc(ui.pending.msg)+'</p></div>'
      +'<p class="muted small">Keep this page open. Your preview appears here as soon as it is ready.</p></div>';
    return;
  }
  if(!o){
    root.innerHTML='<div class="stack" style="max-width:640px">'+(ui.err?'<div class="note bad">'+esc(ui.err)+'</div>':'')+'<h2>Your house will appear here</h2><p class="muted">Upload your plans and your 3D preview shows up on this page, followed by each step after it.</p><div class="row"><button class="btn" data-go="start">See your house as a model</button></div></div>';
    return;
  }
  var link=copyBox('my-link','Your order link. Save it to come back on any device.',orderLink(o.id,keyOf(o.id)));
  var head='<div class="row" style="justify-content:space-between"><div class="stack tight"><span class="eyebrow">Order <span class="mono">'+esc(o.id)+'</span></span><h2>'+esc(o.addr)+(o.suburb?', '+esc(o.suburb):'')+'</h2></div></div>';
  if(o.status==='received'||o.status==='unreadable'){
    var body;
    var again = memFrag[o.id]!==undefined ? '<button class="btn ghost" id="read-go">Try reading again</button>' : '';
    if(o.status==='unreadable'){
      var pr=(o.ai&&o.ai.problems.length)?o.ai.problems:['The plans did not show enough to work out the shape of the house.'];
      body='<h3>I couldn\'t read these plans well enough</h3><div class="note bad">'+ulist(pr)+'</div><p class="muted">A floor plan with overall dimensions and at least two elevations usually does it.</p><div class="row">'+again+'<button class="btn" data-go="start">Upload different plans</button></div>';
    } else {
      body='<h3>That didn\'t go through</h3><div class="note bad">'+esc(ui.err||o.aiErr||'The read did not finish. The page may have been closed part way through.')+'</div><div class="row">'+(again?again.replace('btn ghost','btn'):'')+'<button class="btn'+(again?' ghost':'')+'" data-go="start">Upload plans again</button></div>';
    }
    root.innerHTML=head+'<div class="split" style="margin-top:22px"><div class="stack">'+body+'</div><div>'+timeline(o)+'</div></div>';
    var rg=$('#read-go'); if(rg) rg.addEventListener('click',function(){ readNow(o.id); });
    return;
  }
  var r=built(modelFor(o),0.8), q=o.quote, sh=shipOf(o,o.choice);
  if(o.status==='preview' && ui.pay){
    var t=totalsOf(o,o.choice,o.delivery);
    h=head+'<div class="split" style="margin-top:22px"><div class="stack"><span class="eyebrow">Step 3 of 4</span><h3>Card hold</h3>'
     +'<p class="muted">A hold of '+money2(t.total)+' is placed on your card now. Nothing is charged until Jono confirms your job, usually within 72 hours. If he can\'t take it on, the hold is released.</p>'
     +'<div class="cardmock"><div class="note warn"><b>Test mode.</b> This is a pretend payment page. No card details are collected and nothing is charged. The test card is filled in for you.</div>'
     +'<div class="field"><label for="pay-num">Card number</label><input type="text" id="pay-num" class="mono" value="4242 4242 4242 4242" readonly></div>'
     +'<div class="grid2"><div class="field"><label for="pay-exp">Expiry</label><input type="text" id="pay-exp" class="mono" value="12 / 34" readonly></div><div class="field"><label for="pay-cvc">CVC</label><input type="text" id="pay-cvc" class="mono" value="123" readonly></div></div></div>'
     +'<div class="row"><button class="btn" id="pay-go">Place hold of '+money2(t.total)+'</button><button class="btn ghost" id="pay-back">Back to preview</button></div></div>'
     +'<div class="card stack"><h3>Your order</h3><dl class="spec"><dt>Item</dt><dd>'+(o.choice==='stl'?'STL files':o.choice==='tree'?'Christmas tree version, 1:'+q.tree.scale:'Printed model, 1:'+q.scale)+'</dd><dt>House</dt><dd>'+esc(o.addr)+'</dd>'
     +'<dt>Handover</dt><dd>'+(o.choice==='stl'?'Download here':o.delivery==='post'?'Australia Post to '+esc(o.addr)+(o.suburb?', '+esc(o.suburb):''):'Pickup, Ferny Hills')+'</dd></dl>'
     +'<div class="totals"><span>'+itemName(o.choice)+'</span><span>'+money2(t.price)+'</span>'+(o.choice==='stl'?'':'<span>'+(o.delivery==='post'?'Postage, Parcel Post':'Pickup')+'</span><span>'+money2(t.ship)+'</span>')
     +'<span class="t">Total</span><span class="t">'+money2(t.total)+'</span></div></div></div>';
    root.innerHTML=h;
    $('#pay-back').addEventListener('click',function(){ ui.pay=false; renderOrder(); });
    $('#pay-go').addEventListener('click',function(){
      var b=this; b.disabled=true; ui.busy='hold';
      api('POST', opath(o.id,'/hold'), {choice:o.choice,delivery:o.delivery}).then(function(res){ cur=res.order; ui.pay=false; ui.busy=''; renderOrder(); toast('Hold placed. Jono has 72 hours to confirm.'); }, function(e){ ui.busy=''; b.disabled=false; toast(e.message); });
    });
    return;
  }
  var right='';
  if(o.status==='preview'){
    var ch=o.choice||'print', dv=o.delivery||'pickup';
    right='<span class="eyebrow">Step 2 of 4</span><h3>Here is your house</h3><p class="muted">Turn it around. This is the shape and roof your printed model will have. If something is off, ask for one change before you order.</p>'+facts(o,ch)
     +((o.ai&&(o.ai.assumptions.length||o.ai.problems.length))?'<details><summary>What was assumed from your plans</summary>'+ulist(o.ai.assumptions.concat(o.ai.problems))+'</details>':'')
     +'<div class="choice three" role="radiogroup" aria-label="What would you like?">'
     +'<label><input type="radio" name="choice" id="ch-print" value="print"'+(ch==='print'?' checked':'')+'><span class="lab">Printed model</span><span class="price">'+money(q.print)+'</span><span class="muted small">Printed in two colours at 1:'+q.scale+'. Yours to keep.</span></label>'
     +(q.tree?'<label><input type="radio" name="choice" id="ch-tree" value="tree"'+(ch==='tree'?' checked':'')+'><span class="lab">Christmas tree version</span><span class="price">'+money(q.tree.price)+'</span><span class="muted small">Your house, '+Math.round(Math.max(q.tree.size[0],q.tree.size[1]))+' mm across, with a ribbon to hang it.</span></label>':'')
     +'<label><input type="radio" name="choice" id="ch-stl" value="stl"'+(ch==='stl'?' checked':'')+'><span class="lab">STL files only</span><span class="price">'+money(q.stl)+'</span><span class="muted small">Print it yourself. No supports needed.</span></label></div>'
     +'<div class="choice" id="dv-box" role="radiogroup" aria-label="How would you like to get it?"'+(ch==='stl'?' hidden':'')+'>'
     +'<label><input type="radio" name="dv" id="dv-pickup" value="pickup"'+(dv==='pickup'?' checked':'')+'><span class="lab">Pickup, Ferny Hills</span><span class="price">Free</span><span class="muted small">Jono messages you a time.</span></label>'
     +'<label><input type="radio" name="dv" id="dv-post" value="post"'+(dv==='post'?' checked':'')+'><span class="lab">Australia Post</span><span class="price">'+money2(sh.cost)+'</span><span class="muted small">Parcel Post. Box about '+sh.box.join(' x ')+' mm, charged as '+(sh.kg<1?Math.ceil(sh.kg*1000)+' g':sh.kg.toFixed(2)+' kg')+'.</span></label></div>'
     +'<div class="row"><button class="btn" id="to-pay">Order this model</button><span class="muted small">Nothing is charged until Jono confirms.</span></div>'
     +(ui.busy==='revise'?'<div class="row" style="flex-wrap:nowrap"><span class="spin" aria-hidden="true"></span><span>Working your change into the model. This usually takes a minute or two.</span></div>'
       :o.revUsed?'<p class="muted small">You have used your one change request.</p>'
       :'<details><summary>Ask for one change</summary><div class="stack tight" style="margin-top:10px"><label for="rev-note" class="small">What should be different?</label><textarea id="rev-note" placeholder="For example: the garage has a hip roof like the rest of the house."></textarea><div class="row"><button class="btn ghost sm" id="rev-send">Send change request</button></div></div></details>');
  } else if(o.status==='hold_placed'){
    right='<h3>Hold placed. Waiting on Jono.</h3><p class="muted">A hold of '+money2(o.total)+' is on your card. Jono confirms by <b>'+when(o.holdAt+72*3600e3)+'</b>. If he doesn\'t, the hold drops off by itself.</p>'+timeline(o)
     +'<p class="muted small">This page updates by itself when he confirms.</p>';
  } else if(o.status==='declined'){
    right='<h3>Sorry, I can\'t make this one</h3><div class="note bad">'+esc(o.declineReason||'Jono could not take this job on.')+' The hold on your card has been released and nothing was charged.</div>';
  } else {
    var msg={accepted:'Confirmed. Your card has been charged '+money2(o.total)+' (test).',printing:'Your model is on the printer.',ready:(o.delivery==='post'?'Your model has been posted with Australia Post.':'Your model is ready. Pickup from Ferny Hills. Jono will message you the address and a time.'),collected:'Collected. Enjoy it.',delivered:'Confirmed and charged '+money2(o.total)+' (test). Your files are ready.'}[o.status];
    right='<h3>'+(o.status==='ready'?(o.delivery==='post'?'Posted':'Ready for pickup'):o.status==='delivered'?'Your files are ready':'Confirmed')+'</h3><p>'+msg+'</p>'+timeline(o)
     +(o.status==='delivered'?'<div class="row"><button class="btn" id="cust-dl">Download STL files (zip)</button></div>':'');
  }
  h=head+'<div class="split" style="margin-top:22px"><div class="stagebox"><div class="stage" id="stage-order"></div><span class="cap">Drag to turn it. The can beside it is a standard 375 ml drink can, for size. The yellow outline is an A5 page.'+(['accepted','printing','ready','collected','delivered'].indexOf(o.status)<0?' The PREVIEW mark comes off once your order is confirmed.':'')+'</span></div><div class="stack">'+right+link+'</div></div>';
  root.innerHTML=h;
  var v=viewer('order'); v.mount($('#stage-order'),{watermark:['accepted','printing','ready','collected','delivered'].indexOf(o.status)<0}); v.set(r);
  $$('input[name=choice]',root).forEach(function(i){ i.addEventListener('change',function(){ var dv=$('#dv-post'); o.choice=this.value; if(dv) o.delivery=dv.checked?'post':'pickup'; renderOrder(); var f=$('#ch-'+o.choice); if(f) f.focus({preventScroll:true}); }); });
  $$('input[name=dv]',root).forEach(function(i){ i.addEventListener('change',function(){ o.delivery=this.value; }); });
  var tp=$('#to-pay'); if(tp) tp.addEventListener('click',function(){ o.choice=($('#ch-stl').checked?'stl':$('#ch-tree')&&$('#ch-tree').checked?'tree':'print'); o.delivery=($('#dv-post').checked?'post':'pickup'); ui.pay=true; renderOrder(); window.scrollTo(0,0); });
  var rs=$('#rev-send'); if(rs) rs.addEventListener('click',function(){
    var n=$('#rev-note').value.trim(); if(!n){ toast('Say what should change first.'); return; }
    ui.busy='revise'; renderOrder();
    api('POST', opath(o.id,'/revise'), {note:n}).then(function(res){ ui.busy=''; cur=res.order; renderOrder(); toast('Your model has been updated.'); }, function(e){ ui.busy=''; renderOrder(); toast(e.message); });
  });
  var cd=$('#cust-dl'); if(cd) cd.addEventListener('click',function(){ saveZip(o); });
}

/* ---------- print files ---------- */
function saveZip(o){
  toast('Building print files at full detail...');
  setTimeout(function(){
    var tree=o.choice==='tree', r=G.build(tree?treeOf(o.params):o.params,0.5), enc=new TextEncoder();
    var files=r.parts.map(function(p){ return {name:p.name+'.stl',data:G.stl(p.tris)}; });
    var notes=(tree?'Christmas tree version ':'House model ')+o.id+'\r\n'+o.addr+'\r\nScale 1:'+r.scale+'\r\nSize '+r.size.map(function(v){return v.toFixed(1);}).join(' x ')+' mm assembled\r\n\r\n'
      +'Print each STL as loaded, flat side down. No supports. 0.2 mm layers, 2 walls, 10 to 15 percent infill.\r\n'
      +(tree?'Walls in a light colour, roof in a dark one. Thread a ribbon down through the hole in the roof and the walls, knot it under the walls, and add a dab of glue between roof and walls.\r\n'
        :'Walls in a light colour, roof in a dark one. The roof drops onto the pegs on top of the walls.\r\n')
      +'Estimated filament: '+Math.ceil(r.grams)+' g. Estimated print time: '+r.hours.toFixed(1)+' h. Both are rough figures; the slicer has the real ones.\r\n';
    files.push({name:'README.txt',data:enc.encode(notes)});
    var url=URL.createObjectURL(new Blob([G.zip(files)],{type:'application/zip'})), a=document.createElement('a');
    a.href=url; a.download=(tree?'tree-model-':'house-model-')+o.id+'.zip'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function(){ URL.revokeObjectURL(url); },4000);
  },60);
}

/* ---------- owner queue ---------- */
var BF=[['name','Name','text'],['x','East offset m','n'],['y','North offset m','n'],['w','Width E-W m','n'],['d','Depth N-S m','n'],['storeys','Storeys','n'],['storeyH','Storey height m','n'],
  ['roof','Roof',['hip','gable','skillion','flat']],['pitch','Pitch deg','n'],['eave','Eave m','n'],['ridge','Gable ridge runs',[['auto','Auto'],['ew','East-west'],['ns','North-south']]],['high','Skillion high side',[['n','North'],['s','South'],['e','East'],['w','West']]]];
function blockEditor(params){
  return params.blocks.map(function(b,i){
    return '<fieldset class="blk"><legend>Block '+(i+1)+(params.blocks.length>1?' <button type="button" class="btn ghost sm" data-rm="'+i+'">Remove</button>':'')+'</legend><div class="blkgrid">'
      + BF.map(function(f){
          var id='b'+i+'-'+f[0], inner;
          if(Array.isArray(f[2])) inner='<select id="'+id+'" data-b="'+i+'" data-f="'+f[0]+'">'+f[2].map(function(op){ var v=Array.isArray(op)?op[0]:op, t=Array.isArray(op)?op[1]:op; return '<option value="'+v+'"'+(String(b[f[0]])===v?' selected':'')+'>'+t+'</option>'; }).join('')+'</select>';
          else inner='<input id="'+id+'" data-b="'+i+'" data-f="'+f[0]+'" type="'+(f[2]==='n'?'number':'text')+'"'+(f[2]==='n'?' step="any"':'')+' value="'+esc(b[f[0]])+'">';
          return '<label>'+f[1]+inner+'</label>';
        }).join('')+'</div></fieldset>';
  }).join('');
}
function flagList(flags){ return '<ul class="flags">'+flags.map(function(f){ return '<li class="'+esc(f.lvl)+'">'+esc(f.text)+'</li>'; }).join('')+'</ul>'; }
function estFromBuild(r){ var sh=shipFor(r); return { scale:r.scale, size:r.size, grams:Math.ceil(r.grams), hours:r.hours, parts:r.parts, print:printPrice(r), stl:cfg.pricing.stl, ship:sh, flags:r.flags, fits:r.fits }; }
function estTable(q){
  var sh=q.ship;
  return '<dl class="spec"><dt>Scale</dt><dd>1:'+q.scale+'</dd><dt>Size</dt><dd>'+q.size.map(function(v){return (+v).toFixed(1);}).join(' x ')+' mm</dd><dt>Parts</dt><dd>'+q.parts.length+' ('+q.parts.map(function(p){return esc(p.name);}).join(', ')+')</dd>'
   +'<dt>Filament</dt><dd>about '+q.grams+' g</dd><dt>Print time</dt><dd>about '+(+q.hours).toFixed(1)+' h</dd><dt>Printed price</dt><dd>'+money(q.print)+'</dd>'+(q.tree?'<dt>Tree version</dt><dd>'+money(q.tree.price)+', 1:'+q.tree.scale+', about '+q.tree.grams+' g</dd>':'')+'<dt>STL price</dt><dd>'+money(q.stl)+'</dd>'
   +'<dt>Post box</dt><dd>'+sh.box.join(' x ')+' mm</dd><dt>Post weight</dt><dd>'+Math.round(sh.actual*1000)+' g actual, '+Math.round(sh.cubic*1000)+' g cubic</dd><dt>Postage</dt><dd>'+money2(sh.cost)+'</dd></dl>';
}
function aiBlock(o){
  if(!o.ai) return '';
  var c=o.ai.confidence, lvl=c>=0.75?['ok','High']:c>=0.5?['att','Medium']:['bad','Low'];
  return '<div class="stack tight"><div class="row"><h3>Read from the plans</h3><span class="pill '+lvl[0]+'">'+lvl[1]+' confidence, '+Math.round(c*100)+'%</span></div>'
    +'<p class="muted small">'+(o.ai.pages?o.ai.pages+' pages, '+o.ai.images+' images sent.':'')+(o.ai.revised?' Includes the customer\'s change.':'')+'</p>'
    +(o.ai.assumptions.length?'<span class="lab">Assumed</span>'+ulist(o.ai.assumptions):'')+(o.ai.problems.length?'<span class="lab">Problems</span>'+ulist(o.ai.problems):'')+'</div>';
}
function aorder(id){ for(var i=0;i<admin.orders.length;i++) if(admin.orders[i].id===id) return admin.orders[i]; return null; }
function loadQueue(quiet){
  var gen=admin.gen;                                // a reply that lands after the queue was locked or re-opened is dropped
  return api('GET','/api/admin/orders').then(function(r){
    if(gen!==admin.gen) return;
    admin.ok=true; admin.err=''; admin.orders=r.orders; cfg.pricing=r.pricing; try{ sessionStorage.setItem('fhm-owner',admin.key); }catch(e){}
    if(!ui.edit || !quiet) renderQueue();
  }, function(e){
    if(gen!==admin.gen) return;
    if(e.status===401 || e.status===429){ admin.ok=false; admin.err=e.status===429?e.message:(admin.key?'That passcode is not right.':''); admin.key=''; try{ sessionStorage.removeItem('fhm-owner'); }catch(_){} renderQueue(); }
    else if(!quiet) toast(e.message);
  });
}
var qPollT=null;
function showQueue(){
  clearInterval(qPollT);
  renderQueue();
  if(admin.key) loadQueue();
  qPollT=setInterval(function(){ if(!document.hidden && current==='queue' && admin.ok && !ui.edit && !document.querySelector('#queue-root details[open]')) loadQueue(true); }, 15000);
}
function act(o, body, done){
  admin.gen++;
  api('POST','/api/admin/orders/'+o.id, body).then(function(r){ for(var i=0;i<admin.orders.length;i++) if(admin.orders[i].id===o.id) admin.orders[i]=r.order; ui.edit=null; renderQueue(); if(done) toast(done); }, function(e){ toast(e.message); });
}
var edT;
function renderQueue(){
  var root=$('#queue-root');
  if(!admin.ok){
    root.innerHTML='<form id="own-f" class="stack" style="max-width:420px"><span class="eyebrow">Owner</span><h2>Jono\'s queue</h2><p class="muted">This part of the site is for the owner.</p>'
      +'<div class="field"><label for="own-key">Passcode</label><input type="password" id="own-key" autocomplete="current-password"></div>'
      +(admin.err?'<p class="err" role="alert">'+esc(admin.err)+'</p>':'')+'<div class="row"><button class="btn" type="submit">Open the queue</button></div></form>';
    $('#own-f').addEventListener('submit',function(e){ e.preventDefault(); admin.gen++; admin.key=$('#own-key').value.trim(); if(admin.key) loadQueue(); });
    return;
  }
  if(!admin.sel || !aorder(admin.sel)) admin.sel = admin.orders.length ? admin.orders[0].id : null;
  var o=admin.sel?aorder(admin.sel):null;
  var list=admin.orders.length?'<ul class="olist">'+admin.orders.map(function(x){ return '<li><button type="button" data-sel="'+x.id+'" aria-current="'+(x.id===admin.sel)+'"><span class="row" style="justify-content:space-between;gap:6px"><span class="mono">'+x.id+'</span>'+pill(x)+'</span><span>'+esc(x.name)+'</span><span class="muted small">'+esc(x.addr)+' &middot; '+when(x.created)+'</span></button></li>'; }).join('')+'</ul>'
    :'<p class="muted">No orders yet. They appear here as soon as someone uploads plans.</p>';
  var p=cfg.pricing;
  var settings='<details style="margin-top:18px"><summary>Prices</summary><div class="stack tight" style="margin-top:10px">'
    +'<div class="field"><label for="set-min">Minimum price A$</label><input type="number" id="set-min" value="'+p.min+'"></div>'
    +'<div class="field"><label for="set-fee">Making fee A$</label><input type="number" id="set-fee" value="'+p.fee+'"></div>'
    +'<div class="field"><label for="set-g">Filament A$ per gram</label><input type="number" step="0.05" id="set-g" value="'+p.perGram+'"></div>'
    +'<div class="field"><label for="set-stl">STL files A$</label><input type="number" id="set-stl" value="'+p.stl+'"></div>'
    +'<div class="field"><label for="set-tree">Christmas tree version A$</label><input type="number" id="set-tree" value="'+(p.tree!=null?p.tree:60)+'"></div>'
    +'<div class="row"><button type="button" class="btn sm" id="set-save">Save prices</button></div>'
    +'<p class="muted small">New prices apply to previews made from now on. Postage uses Australia Post Parcel Post rates for own packaging as at 1 July 2026: '+POST.map(function(b){ return 'up to '+(b[0]<1?b[0]*1000+' g':b[0]+' kg')+' '+money2(b[1]); }).join(', ')+'. Box is the model plus 20 mm padding each side, plus 150 g of packaging, charged on the greater of actual and cubic weight.</p>'
    +'</div></details>';
  var d='';
  if(!o) d='<p class="muted">Nothing selected.</p>';
  else {
    d='<div class="row" style="justify-content:space-between"><div class="stack tight"><span class="eyebrow">Order <span class="mono">'+o.id+'</span></span><h2>'+esc(o.name)+'</h2></div>'+pill(o)+'</div>'
     +'<dl class="spec" style="margin-top:14px"><dt>House</dt><dd>'+esc(o.addr)+(o.suburb?', '+esc(o.suburb):'')+'</dd><dt>Email</dt><dd>'+esc(o.email)+'</dd><dt>Plans</dt><dd>'+(o.files||[]).map(function(f){return esc(f.name)+(f.size?' ('+kb(f.size)+')':'');}).join('<br>')+'</dd>'
     +(o.notes?'<dt>Notes</dt><dd>'+esc(o.notes)+'</dd>':'')+(o.revNote?'<dt>Change asked</dt><dd>'+esc(o.revNote)+'</dd>':'')
     +(o.total!=null?'<dt>Ordered</dt><dd>'+itemName(o.choice)+', '+money2(o.price)+(o.choice==='stl'?'':(o.delivery==='post'?' plus '+money2(o.ship)+' postage':', pickup'))+'</dd><dt>Total held</dt><dd>'+money2(o.total)+'</dd>':'')+'</dl>';
    var early = o.status==='received'||o.status==='revision'||o.status==='unreadable';
    var editing = ui.edit && ui.edit.id===o.id;
    var stage='<div class="stagebox" style="margin-top:18px"><div class="stage" id="stage-queue"></div></div>';
    var ed='';
    if(editing){
      var er=built(ui.edit.params,0.8), eq=estFromBuild(er);
      ed=stage+'<div class="stack" style="margin-top:14px"><div class="grid2"><div class="field"><label for="ed-scale">Scale</label><select id="ed-scale">'
        +[['auto','Auto (fit an A5 page)'],['100','1:100'],['150','1:150'],['200','1:200'],['250','1:250']].map(function(s){ return '<option value="'+s[0]+'"'+(String(ui.edit.params.scale)===s[0]?' selected':'')+'>'+s[1]+'</option>'; }).join('')+'</select></div></div>'
        +'<div id="ed-blocks" class="stack tight">'+blockEditor(ui.edit.params)+'</div>'
        +'<div class="row"><button type="button" class="btn ghost sm" id="ed-add">Add a block</button><span class="muted small">A block is one rectangle of the house with its own roof. Offsets are measured from the south-west corner.</span></div>'
        +'<div id="ed-out" class="stack">'+flagList(eq.flags)+estTable(eq)+'</div>'
        +'<div class="row"><button type="button" class="btn" id="ed-send"'+(eq.fits?'':' disabled')+'>Send this preview to the customer</button><button type="button" class="btn ghost" id="ed-cancel">Cancel</button></div></div>';
    }
    var stepIn = (early || o.status==='preview') && !editing ? '<div class="row"><button type="button" class="btn ghost sm" id="ed-open">Step in and adjust the model by hand</button></div>' : '';
    if(early){
      d+='<div class="stack" style="margin-top:18px">'
       +(o.aiErr?'<div class="note bad">'+esc(o.aiErr)+'</div>'
         :o.status==='unreadable'?'<div class="note bad"><b>The plans could not be read well enough.</b> The customer has been told and asked for better plans. Nothing for you to do unless you want to step in.</div>'
         :'<div class="note quiet">The plans are being read. This starts by itself when the customer uploads.</div>')
       +aiBlock(o)+stepIn+ed+'</div>';
    } else if(o.params){
      d+=(editing?ed:stage)+'<div class="stack" style="margin-top:16px">'+copyBox('cl-url','Customer\'s order link, in case they lose theirs.',orderLink(o.id,o.key))+aiBlock(o)+(editing?'':flagList(o.quote.flags)+estTable(o.quote));
      if(o.status==='preview' && !editing) d+='<div class="note quiet">Preview is with the customer. Nothing for you to do until they place a hold.</div>'+stepIn;
      if(o.status==='hold_placed') d+='<div class="note warn"><b>Your one decision.</b> The customer has seen this preview and a hold of '+money2(o.total)+' is on their card. Accept to charge it and take the job. Confirm by '+when(o.holdAt+72*3600e3)+' or the hold lapses.</div>'
        +'<div class="row"><button type="button" class="btn" id="q-accept">Accept and charge '+money2(o.total)+'</button></div>'
        +'<div class="row"><div class="field" style="flex:1 1 220px"><label for="q-reason">Reason if declining</label><select id="q-reason"><option>The plans did not have enough detail to model this house well.</option><option>This roof is too complex for the simple model right now.</option><option>The printer is booked out for the next few weeks.</option></select></div><button type="button" class="btn danger" id="q-decline">Decline and release hold</button></div>';
      var nxt={accepted:['printing','Start printing'],printing:['ready',o.delivery==='post'?'Mark posted':'Mark ready for pickup'],ready:o.delivery==='post'?null:['collected','Mark collected']}[o.status];
      if(nxt) d+='<div class="row"><button type="button" class="btn" id="q-next" data-to="'+nxt[0]+'">'+nxt[1]+'</button></div>';
      d+='<div class="row"><button type="button" class="btn ghost" id="q-dl">Download STL files (zip)</button></div></div>';
    }
  }
  root.innerHTML='<div class="stack tight" style="margin-bottom:20px"><span class="eyebrow">Owner view</span><h2>Jono\'s queue</h2><p class="muted">Plans are read and modelled without you. Your jobs: accept or decline, then print and hand over.</p></div><div class="queue"><div>'+list+settings+'<div class="row" style="margin-top:14px"><button type="button" class="btn ghost sm" id="own-out">Lock the queue</button></div></div><div class="card">'+d+'</div></div>';
  var showP = o && (ui.edit && ui.edit.id===o.id ? ui.edit.params : o.params && modelFor(o));
  if(showP && $('#stage-queue')){ var v=viewer('queue'); v.mount($('#stage-queue')); v.set(built(showP,0.8)); }
  $$('[data-sel]',root).forEach(function(b){ b.addEventListener('click',function(){ admin.sel=this.getAttribute('data-sel'); ui.edit=null; renderQueue(); }); });
  $('#own-out').addEventListener('click',function(){ admin.gen++; admin.ok=false; admin.key=''; admin.orders=[]; try{ sessionStorage.removeItem('fhm-owner'); }catch(e){} renderQueue(); });
  var eo=$('#ed-open'); if(eo) eo.addEventListener('click',function(){ ui.edit={ id:o.id, params:o.params?clone(o.params):{scale:'auto',blocks:[{name:'Main house',x:0,y:0,w:12,d:8,storeys:1,storeyH:2.7,roof:'hip',pitch:22.5,eave:0.6,ridge:'auto',high:'n'}]} }; renderQueue(); });
  function refresh(){ var r=built(ui.edit.params,0.8), q=estFromBuild(r); $('#ed-out').innerHTML=flagList(q.flags)+estTable(q); $('#ed-send').disabled=!q.fits; viewer('queue').set(r); }
  var eb=$('#ed-blocks');
  if(eb){
    eb.addEventListener('input',function(e){ var t=e.target, i=t.getAttribute('data-b'), f=t.getAttribute('data-f'); if(i==null) return; var val=t.type==='number'?parseFloat(t.value):t.value; if(t.type==='number'&&isNaN(val)) return; ui.edit.params.blocks[+i][f]=val; clearTimeout(edT); edT=setTimeout(refresh,180); });
    eb.addEventListener('click',function(e){ var b=e.target.closest('[data-rm]'); if(!b) return; ui.edit.params.blocks.splice(+b.getAttribute('data-rm'),1); renderQueue(); });
    $('#ed-scale').addEventListener('change',function(){ ui.edit.params.scale=this.value==='auto'?'auto':+this.value; refresh(); });
    $('#ed-add').addEventListener('click',function(){ var l=ui.edit.params.blocks[ui.edit.params.blocks.length-1]; ui.edit.params.blocks.push({name:'Block '+(ui.edit.params.blocks.length+1),x:(+l.x||0)+(+l.w||0)-2,y:+l.y||0,w:5,d:5,storeys:1,storeyH:2.7,roof:'hip',pitch:22.5,eave:0.6,ridge:'auto',high:'n'}); renderQueue(); });
    $('#ed-send').addEventListener('click',function(){ act(o,{action:'override',params:ui.edit.params},'Preview sent to the customer.'); });
    $('#ed-cancel').addEventListener('click',function(){ ui.edit=null; renderQueue(); });
  }
  var qd=$('#q-dl'); if(qd) qd.addEventListener('click',function(){ saveZip(o); });
  var a=$('#q-accept'); if(a) a.addEventListener('click',function(){ act(o,{action:'accept'}, o.choice==='stl'?'Charged (test). Files released to the customer.':'Charged (test). Job accepted.'); });
  var dc=$('#q-decline'); if(dc) dc.addEventListener('click',function(){ act(o,{action:'decline',reason:$('#q-reason').value},'Declined. Hold released (test).'); });
  var nx=$('#q-next'); if(nx) nx.addEventListener('click',function(){ act(o,{action:this.getAttribute('data-to')}); });
  $('#set-save').addEventListener('click',function(){
    api('PUT','/api/admin/pricing',{min:$('#set-min').value,fee:$('#set-fee').value,perGram:$('#set-g').value,stl:$('#set-stl').value,tree:$('#set-tree').value}).then(function(r){ cfg.pricing=r.pricing; toast('Prices saved.'); }, function(e){ toast(e.message); });
  });
}

/* ---------- start ---------- */
api('GET','/api/config').then(function(c){ cfg=c; if(current==='home') renderHome(); var nr=$('#not-ready'); if(nr) nr.hidden=!!c.ready; }, function(){});
(function(){
  var m=/[?&]o=([A-Z0-9-]{4,12})\.([a-z0-9]{8,40})/.exec(location.search);
  if(m){ remember(m[1],m[2]); cur=null; go('order'); return; }
  var h=(location.hash||'').replace('#','');
  go(h||'home', true);
})();
})();
