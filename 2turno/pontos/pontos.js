(function(){'use strict';
var EMBED=/[?&]embed=1/.test(location.search);if(EMBED)document.documentElement.classList.add('embed');
function altura(){if(EMBED&&parent!==window)try{parent.postMessage({cmvPontosAltura:document.documentElement.scrollHeight},location.origin)}catch(e){}}
if(EMBED){if(window.ResizeObserver)new ResizeObserver(altura).observe(document.body);window.addEventListener('load',altura);setInterval(altura,2000)}
var TSE='https://resultados.tse.jus.br/oficial/ele2026/6258/dados/';
var UFS='ac al ap am ba ce df es go ma mt ms mg pr pb pa pe pi rj rn rs ro rr sc se sp to zz'.split(' ');
var REG={N:'ac am ap pa ro rr to',NE:'al ba ce ma pb pe pi rn se',CO:'df go ms mt',SE:'es mg rj sp',S:'pr rs sc'};
var REGN={N:'Norte',NE:'Nordeste',CO:'Centro-Oeste',SE:'Sudeste',S:'Sul'};
var ufReg={};Object.keys(REG).forEach(function(r){REG[r].split(' ').forEach(function(u){ufReg[u]=r})});
var M=[],byKey={},modo=1,ufIdg={},ufSt={},hora='';
var cv=document.getElementById('cv'),cx=cv.getContext('2d'),W=0,H=0,DPR=1,sel=null,ufF='';
var fmt=new Intl.NumberFormat('pt-BR');function pc(a,b){return b?(100*a/b).toFixed(2).replace('.',','):'0,00'}
function $(i){return document.getElementById(i)}
var ufR={},brR=null,cache={},temAgg=false;
function res(m){return modo===2?m.r2:m.r1}
function resCor(m){if(modo!==2)return m.r1;if(m.r2&&(temAgg||m.r2.st))return m.r2;return ufR[m.uf]||null}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}

fetch('base-t1.json').then(function(r){return r.json()}).then(function(d){
  d.m.forEach(function(a){var m={uf:a[0],cd:a[1],nm:a[2],cap:a[3],lat:a[4],lon:a[5],te:a[6],r1:{L:a[7],F:a[8],vv:a[9],st:a[10],ts:a[11]},r2:null};
    M.push(m);byKey[m.uf+m.cd]=m});
  var o=$('uf');UFS.slice(0,27).slice().sort().forEach(function(u){var e=document.createElement('option');e.value=u;e.textContent=u.toUpperCase();o.appendChild(e)});
  var e=document.createElement('option');e.value='zz';e.textContent='Exterior';o.appendChild(e);
  layout();draw();painel();ciclo();
});

/* ---------- layout: coordenadas reais + separação de pontos ---------- */
var P=[];
function layout(){
  DPR=Math.min(window.devicePixelRatio||1,2);W=cv.clientWidth;
  var lo0=-74.2,lo1=-34.6,la0=-33.9,la1=5.4,kx=Math.cos(-14*Math.PI/180);
  var asp=((la1-la0))/((lo1-lo0)*kx);H=Math.round(W*asp);
  cv.width=W*DPR;cv.height=H*DPR;cv.style.height=H+'px';
  var pad=8,sc=Math.min((W-2*pad)/((lo1-lo0)*kx),(H-2*pad)/(la1-la0));
  var maxTe=0;M.forEach(function(m){if(m.uf!=='zz'&&m.te>maxTe)maxTe=m.te});
  var rmax=Math.max(9,W*0.03),rmin=Math.max(1.1,W/520),k=rmax/Math.sqrt(maxTe);
  P=M.filter(function(m){return m.uf!=='zz'}).map(function(m){
    var x=pad+(m.lon-lo0)*kx*sc,y=pad+(la1-m.lat)*sc;
    return {m:m,x0:x,y0:y,x:x,y:y,r:Math.max(rmin,k*Math.sqrt(m.te))}});
  P.sort(function(a,b){return b.r-a.r});
  var cell=rmax*2;
  for(var it=0;it<60;it++){
    var g={};P.forEach(function(p,i){var key=((p.x/cell)|0)+','+((p.y/cell)|0);(g[key]||(g[key]=[])).push(i)});
    P.forEach(function(p,i){var gx=(p.x/cell)|0,gy=(p.y/cell)|0;
      for(var dx=-1;dx<=1;dx++)for(var dy=-1;dy<=1;dy++){var c=g[(gx+dx)+','+(gy+dy)];if(!c)continue;
        for(var j=0;j<c.length;j++){var q=P[c[j]];if(c[j]<=i)continue;var ex=q.x-p.x,ey=q.y-p.y,d=Math.sqrt(ex*ex+ey*ey)||0.01,mn=p.r+q.r+0.4;
          if(d<mn){var s=(mn-d)/d*0.5,wp=q.r*q.r/(p.r*p.r+q.r*q.r),wq=1-wp;p.x-=ex*s*wp;p.y-=ey*s*wp;q.x+=ex*s*wq;q.y+=ey*s*wq}}}
      p.x+=(p.x0-p.x)*0.02;p.y+=(p.y0-p.y)*0.02});
  }
}
function cor(r){
  if(!r||!r.st||(r.L+r.F)===0)return '#3A4763';
  var t=r.L+r.F,mg=Math.abs(r.L-r.F)/t;if(r.L===r.F)return '#E2E8F0';
  var a=0.35+Math.min(mg/0.4,1)*0.65,c=r.L>r.F?[228,20,44]:[47,95,208],b=[22,36,71];
  return 'rgb('+c.map(function(v,i){return Math.round(b[i]+(v-b[i])*a)}).join(',')+')';
}
function draw(){
  cx.setTransform(DPR,0,0,DPR,0,0);cx.clearRect(0,0,W,H);
  for(var i=0;i<P.length;i++){var p=P[i];var dim=ufF&&ufF!==p.m.uf;
    cx.globalAlpha=dim?0.12:1;cx.fillStyle=cor(resCor(p.m));cx.beginPath();cx.arc(p.x,p.y,p.r,0,6.2832);cx.fill()}
  cx.globalAlpha=1;
  if(sel){var s=P.find(function(p){return p.m===sel});if(s){cx.lineWidth=2.5;cx.strokeStyle='#FDE047';cx.beginPath();cx.arc(s.x,s.y,s.r+3,0,6.2832);cx.stroke()}}
}
cv.addEventListener('click',function(e){var b=cv.getBoundingClientRect(),x=e.clientX-b.left,y=e.clientY-b.top,best=null,bd=1e9;
  P.forEach(function(p){if(ufF&&ufF!==p.m.uf)return;var d=Math.hypot(p.x-x,p.y-y)-p.r;if(d<bd){bd=d;best=p}});
  if(best&&bd<10)ficha(best.m);else fechar()});
var rt;window.addEventListener('resize',function(){clearTimeout(rt);rt=setTimeout(function(){if(Math.abs(cv.clientWidth-W)>2){layout();draw()}},200)});

/* ---------- ficha ---------- */
function ficha(m){if(modo===2&&!temAgg){var c=cache[m.uf+m.cd];if(!c||Date.now()-c>60000){cache[m.uf+m.cd]=Date.now();gj(m.uf+'/'+m.uf+m.cd+'-c0001-e006258-u.json').then(function(j){m.r2=ext(j);if(sel===m)ficha(m);draw()}).catch(function(){})}}
  sel=m;draw();var r=res(m),f=$('ficha');
  var nada=!r||!r.st;
  f.innerHTML='<button class="x" aria-label="Fechar">×</button><h2>'+esc(m.nm)+'</h2><div class="mut">'+(m.uf==='zz'?'Exterior':m.uf.toUpperCase()+(m.cap?' · capital':''))+' · '+fmt.format(m.te)+' eleitores</div>'+
  (nada?'<p>Aguardando seções totalizadas pelo TSE.</p>':
  '<div class="bar"><b class="l" style="width:'+pc(r.L,r.L+r.F).replace(',','.')+'%"></b><b class="f" style="width:'+pc(r.F,r.L+r.F).replace(',','.')+'%"></b></div>'+
  '<div class="lin"><span>Lula (PT)</span><span class="n">'+fmt.format(r.L)+' · '+pc(r.L,r.vv)+'%</span></div>'+
  '<div class="lin"><span>Flávio (PL)</span><span class="n">'+fmt.format(r.F)+' · '+pc(r.F,r.vv)+'%</span></div>'+
  '<div class="mut">% dos votos válidos'+(modo===1?' do 1º turno (soma dos dois: '+pc(r.L+r.F,r.vv)+'%)':'')+'</div>')+
  '<div class="mut" style="margin-top:6px">Seções totalizadas: '+fmt.format(r?r.st:0)+' de '+fmt.format(r?r.ts:0)+' ('+pc(r?r.st:0,r?r.ts:0)+'%)</div>';
  f.hidden=false;f.querySelector('.x').onclick=fechar}
function fechar(){$('ficha').hidden=true;sel=null;draw()}

/* ---------- busca e filtro ---------- */
function norm(s){return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()}
$('q').addEventListener('input',function(){var q=norm(this.value.trim()),u=$('sug');u.innerHTML='';if(q.length<2)return;
  M.filter(function(m){return norm(m.nm).indexOf(q)>=0&&(!ufF||m.uf===ufF)}).sort(function(a,b){return b.te-a.te}).slice(0,12).forEach(function(m){
    var li=document.createElement('li');li.innerHTML=esc(m.nm)+' <small>'+(m.uf==='zz'?'Exterior':m.uf.toUpperCase())+'</small>';
    li.onclick=function(){u.innerHTML='';$('q').value=m.nm;ficha(m)};u.appendChild(li)})});
$('uf').addEventListener('change',function(){ufF=this.value;draw();painel()});

/* ---------- abas e somas ---------- */
document.querySelectorAll('.aba').forEach(function(b){b.onclick=function(){document.querySelectorAll('.aba').forEach(function(x){x.classList.toggle('on',x===b)});
  document.querySelectorAll('.vista').forEach(function(v){v.classList.toggle('on',v.id==='v-'+b.dataset.aba)});fechar()}});
function soma(f){var s={L:0,F:0,vv:0,st:0,ts:0,te:0,n:0,lL:0,lF:0};M.forEach(function(m){if(!f(m))return;var r=res(m);s.te+=m.te;s.n++;if(!r)return;
  s.L+=r.L;s.F+=r.F;s.vv+=r.vv;s.st+=r.st;s.ts+=r.ts;if(r.st&&r.L>r.F)s.lL++;else if(r.st&&r.F>r.L)s.lF++});return s}
function bloco(t,s){return '<div class="cartao"><h3>'+t+'</h3><div class="mut">'+fmt.format(s.n)+' locais · '+fmt.format(s.te)+' eleitores · '+pc(s.st,s.ts)+'% das seções</div>'+
  '<div class="bar"><b class="l" style="width:'+(s.L+s.F?100*s.L/(s.L+s.F):0)+'%"></b><b class="f" style="width:'+(s.L+s.F?100*s.F/(s.L+s.F):0)+'%"></b></div>'+
  '<div class="lin"><span>Lula (PT)</span><span class="n">'+fmt.format(s.L)+' · '+pc(s.L,s.vv)+'%</span></div><div class="lin"><span>Flávio (PL)</span><span class="n">'+fmt.format(s.F)+' · '+pc(s.F,s.vv)+'%</span></div>'+
  '<div class="mut">Municípios com mais votos: Lula '+fmt.format(s.lL)+' · Flávio '+fmt.format(s.lF)+'</div></div>'}
function somaUF(us){var s={L:0,F:0,vv:0,st:0,ts:0,te:0,n:0,lL:0,lF:0};us.forEach(function(u){var r=ufR[u];M.forEach(function(m){if(m.uf===u){s.te+=m.te;s.n++}});if(!r)return;s.L+=r.L;s.F+=r.F;s.vv+=r.vv;s.st+=r.st;s.ts+=r.ts});return s}
function painel(){
  var f=function(m){return !ufF||m.uf===ufF};
  if(modo===2&&!temAgg){painel2();return}
  $('resumo').innerHTML=bloco(ufF?(ufF==='zz'?'Exterior':ufF.toUpperCase()):'Brasil + exterior',soma(f)).replace('<div class="cartao">','<div>');
  var ex=M.filter(function(m){return m.uf==='zz'}),se=soma(function(m){return m.uf==='zz'});
  $('ext').innerHTML='<h3>Exterior (fora do mapa)</h3><div class="mut">'+fmt.format(se.n)+' cidades · '+fmt.format(se.te)+' eleitores</div>'+
   '<div class="lin"><span>Lula (PT)</span><span class="n">'+pc(se.L,se.vv)+'%</span></div><div class="lin"><span>Flávio (PL)</span><span class="n">'+pc(se.F,se.vv)+'%</span></div><div class="chips">'+
   ex.sort(function(a,b){return b.te-a.te}).slice(0,12).map(function(m){return '<span class="chip" data-k="'+m.uf+m.cd+'" style="border-left:4px solid '+cor(resCor(m))+'">'+esc(m.nm)+'</span>'}).join('')+'</div>';
  $('ext').querySelectorAll('.chip').forEach(function(c){c.onclick=function(){ficha(byKey[c.dataset.k])}});
  $('t-regioes').innerHTML='<div class="grade">'+Object.keys(REG).map(function(r){return bloco(REGN[r],soma(function(m){return ufReg[m.uf]===r&&f(m)}))}).join('')+bloco('Exterior',soma(function(m){return m.uf==='zz'}))+'</div>';
  $('t-capital').innerHTML='<div class="grade">'+bloco('27 capitais',soma(function(m){return m.cap&&f(m)}))+bloco('Interior',soma(function(m){return !m.cap&&m.uf!=='zz'&&f(m)}))+'</div><p class="mut">Capitais = as 26 capitais estaduais e Brasília. Exterior fica fora das duas somas.</p>';
  $('selo').textContent=modo===1?'DADOS DO 1º TURNO':'2º TURNO · APURAÇÃO';$('selo').className='selo'+(modo===2?' t2':'');
  $('hora').textContent=hora;
  $('nota').textContent=modo===1?'O TSE ainda não totalizou seções do 2º turno. Enquanto isso, o mapa mostra o 1º turno (Lula × Flávio, % dos votos válidos do 1º turno; a cor indica quem teve mais votos entre os dois). A troca para o 2º turno é automática.':'2º turno: % dos votos válidos. Municípios em cinza ainda não têm seção totalizada.';
}

function painel2(){
  var todas=UFS.slice(),sb=ufF?somaUF([ufF]):(brR?Object.assign(somaUF(todas),brR):somaUF(todas));
  $('resumo').innerHTML=bloco(ufF?(ufF==='zz'?'Exterior':ufF.toUpperCase()):'Brasil + exterior',sb).replace('<div class="cartao">','<div>').replace(/<div class="mut">Municípios com mais votos[^<]*<\/div>/,'');
  var se=somaUF(['zz']),ex=M.filter(function(m){return m.uf==='zz'});
  $('ext').innerHTML='<h3>Exterior (fora do mapa)</h3><div class="mut">'+fmt.format(se.n)+' cidades · '+pc(se.st,se.ts)+'% das seções</div><div class="lin"><span>Lula (PT)</span><span class="n">'+pc(se.L,se.vv)+'%</span></div><div class="lin"><span>Flávio (PL)</span><span class="n">'+pc(se.F,se.vv)+'%</span></div><div class="chips">'+ex.sort(function(a,b){return b.te-a.te}).slice(0,12).map(function(m){return '<span class="chip" data-k="'+m.uf+m.cd+'">'+esc(m.nm)+'</span>'}).join('')+'</div>';
  $('ext').querySelectorAll('.chip').forEach(function(c){c.onclick=function(){ficha(byKey[c.dataset.k])}});
  var tira=function(h){return h.replace(/<div class="mut">Municípios com mais votos[^<]*<\/div>/g,'')};
  $('t-regioes').innerHTML='<p class="mut">2º turno ao vivo, somando os arquivos de cada estado do TSE.</p><div class="grade">'+tira(Object.keys(REG).map(function(r){return bloco(REGN[r],somaUF(REG[r].split(' ').filter(function(u){return !ufF||u===ufF})))}).join('')+bloco('Exterior',somaUF(['zz'])))+'</div>';
  var capOk=capFeito;
  $('t-capital').innerHTML=capOk?'<p class="mut">2º turno ao vivo. Capitais: arquivos das 27 capitais; interior = estado menos capital.</p><div class="grade">'+tira(bloco('27 capitais',soma(function(m){return m.cap&&f2(m)}))+blocoInt())+'</div>':'<p class="mut"><span class="selo">DADOS DO 1º TURNO</span> Dados das capitais do 2º turno indisponíveis no momento.</p>';
  $('selo').textContent='2º TURNO · APURAÇÃO';$('selo').className='selo t2';$('hora').textContent=hora;
  $('nota').textContent='Cores ao vivo por estado; toque na cidade para ver o resultado dela. % dos votos válidos do 2º turno.';
  $('aviso').hidden=false;
}
function f2(m){return !ufF||m.uf===ufF}
function blocoInt(){var us=UFS.filter(function(u){return u!=='zz'&&(!ufF||u===ufF)}),s=somaUF(us);M.forEach(function(m){if(m.cap&&us.indexOf(m.uf)>=0&&m.r2){s.L-=m.r2.L;s.F-=m.r2.F;s.vv-=m.r2.vv;s.st-=m.r2.st;s.ts-=m.r2.ts;s.te-=m.te;s.n--}});return bloco('Interior',s)}
var capFeito=false;
/* ---------- dados ao vivo (2º turno) ---------- */
function ext(j){var o={L:0,F:0,vv:+j.v.vv,st:+j.s.st,ts:+j.s.ts};j.carg[0].agr.forEach(function(a){a.par.forEach(function(p){p.cand.forEach(function(c){if(c.n==='13')o.L=+c.vap;if(c.n==='22')o.F=+c.vap})})});return o}
function gj(u){window.__pts&&window.__pts.req++;return fetch(TSE+u,{cache:'no-cache'}).then(function(r){if(!r.ok)throw r.status;return r.json()})}
function fila(list,n,fn){var i=0;function w(){if(i>=list.length)return Promise.resolve();var x=list[i++];return fn(x).catch(function(){}).then(w)}var ps=[];for(var k=0;k<n;k++)ps.push(w());return Promise.all(ps)}
var ocupado=false,carimbo='',ultCheio=0;window.__pts={req:0,ciclos:0,cheios:0,sobrepostos:0,redesenho:0};
function hhmmss(hg){return 'Atualizado às '+hg+' (horário do TSE)'}
function ciclo(){if(ocupado){window.__pts.sobrepostos++;return}ocupado=true;window.__pts.ciclos++;
  gj('br/br-c0001-e006258-u.json').then(function(br){hora=hhmmss(br.hg);
    var c=br.dg+' '+br.hg+' '+br.idg,mudou=c!==carimbo;
    if(+br.s.st===0){carimbo=c;modo=1;$('hora').textContent=hora;if(mudou)painel();return}
    var cheio=mudou||modo!==2||Date.now()-ultCheio>60000;
    if(modo!==2){modo=2;M.forEach(function(m){m.r2=null})}
    brR=ext(br);$('hora').textContent=hora;
    if(!cheio)return;
    carimbo=c;ultCheio=Date.now();window.__pts.cheios++;
    if(sel)delete cache[sel.uf+sel.cd];
    return fetch('ao-vivo.json',{cache:'no-cache'}).then(function(r){if(!r.ok)throw 0;return r.json()}).then(function(a){
      /* gancho: {"m":{"al27855":[L,F,vv,st,ts],...}} gerado pelo nosso servidor */
      if(!a||!a.m)throw 0;temAgg=true;M.forEach(function(m){var v=a.m[m.uf+m.cd];m.r2=v?{L:v[0],F:v[1],vv:v[2],st:v[3],ts:v[4]}:{L:0,F:0,vv:0,st:0,ts:m.r1.ts}});
    }).catch(function(){temAgg=false;
      return fila(UFS,8,function(u){return gj(u+'/'+u+'-c0001-e006258-u.json').then(function(j){ufR[u]=ext(j)})}).then(function(){
        var caps=M.filter(function(m){return m.cap});
        return fila(caps,8,function(m){cache[m.uf+m.cd]=Date.now();return gj(m.uf+'/'+m.uf+m.cd+'-c0001-e006258-u.json').then(function(j){m.r2=ext(j)})}).then(function(){capFeito=caps.every(function(m){return m.r2})});
      });
    }).then(function(){painel();draw();window.__pts.redesenho=Date.now();if(sel)ficha(sel)});
  }).catch(function(){}).then(function(){ocupado=false;setTimeout(ciclo,document.hidden?15000:5000)});
}
})();
