/* Destaque da home: mapa de pontos do 2º turno (resultado final TSE), estático em JSON local (2turno/pontos/mini.json).
   Mesmo layout/cores de 2turno/pontos/pontos.js. Sem chamadas ao TSE, sem atualização automática; lazy; respeita reduced-motion. */
(function(){
  var cv=document.getElementById('hm-cv');if(!cv)return;
  var RM=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  var D=null,P=[],W=0,H=0,DPR=1,base=document.createElement('canvas'),raf=0,vis=false,t0=0,ult=0,pul=[];
  function cor(L,F){var t=L+F;if(!t)return '#3A4763';if(L===F)return '#E2E8F0';var mg=Math.abs(L-F)/t,a=(document.documentElement.classList.contains('tema-claro')?0.55:0.35)+Math.min(mg/0.4,1)*(document.documentElement.classList.contains('tema-claro')?0.45:0.65),c=L>F?[228,20,44]:(document.documentElement.classList.contains('tema-claro')?[29,64,200]:[47,95,208]),b=(document.documentElement.classList.contains('tema-claro')?[226,232,240]:[22,36,71]);
    return 'rgb('+c.map(function(v,i){return Math.round(b[i]+(v-b[i])*a)}).join(',')+')'}
  function layout(){W=cv.clientWidth;if(!W||!D)return false;DPR=Math.min(window.devicePixelRatio||1,2);
    var lo0=-74.2,lo1=-34.6,la0=-33.9,la1=5.4,kx=Math.cos(-14*Math.PI/180);H=Math.round(W*(la1-la0)/((lo1-lo0)*kx));
    cv.width=W*DPR;cv.height=H*DPR;cv.style.height=H+'px';base.width=cv.width;base.height=cv.height;
    var pad=6,sc=Math.min((W-2*pad)/((lo1-lo0)*kx),(H-2*pad)/(la1-la0)),maxTe=0;D.forEach(function(m){if(m[2]>maxTe)maxTe=m[2]});
    var rmax=Math.max(7,W*0.03),rmin=Math.max(0.9,W/520),k=rmax/Math.sqrt(maxTe);
    P=D.map(function(m){var x=pad+(m[1]-lo0)*kx*sc,y=pad+(la1-m[0])*sc;return{x0:x,y0:y,x:x,y:y,r:Math.max(rmin,k*Math.sqrt(m[2])),c:cor(m[3],m[4])}});
    P.sort(function(a,b){return b.r-a.r});var cell=rmax*2;
    for(var it=0;it<40;it++){var g={};P.forEach(function(p,i){var key=((p.x/cell)|0)+','+((p.y/cell)|0);(g[key]||(g[key]=[])).push(i)});
      P.forEach(function(p,i){var gx=(p.x/cell)|0,gy=(p.y/cell)|0;for(var dx=-1;dx<=1;dx++)for(var dy=-1;dy<=1;dy++){var c=g[(gx+dx)+','+(gy+dy)];if(!c)continue;
        for(var j=0;j<c.length;j++){if(c[j]<=i)continue;var q=P[c[j]],ex=q.x-p.x,ey=q.y-p.y,d=Math.sqrt(ex*ex+ey*ey)||0.01,mn=p.r+q.r+0.4;
          if(d<mn){var s=(mn-d)/d*0.5,wp=q.r*q.r/(p.r*p.r+q.r*q.r),wq=1-wp;p.x-=ex*s*wp;p.y-=ey*s*wp;q.x+=ex*s*wq;q.y+=ey*s*wq}}}
        p.x+=(p.x0-p.x)*0.02;p.y+=(p.y0-p.y)*0.02})}
    var b=base.getContext('2d');b.setTransform(DPR,0,0,DPR,0,0);b.clearRect(0,0,W,H);
    P.forEach(function(p){b.beginPath();b.arc(p.x,p.y,p.r,0,6.2832);b.fillStyle=p.c;b.fill()});return true}
  function quadro(t){raf=0;if(!vis||document.hidden)return;
    if(t-ult<33){raf=requestAnimationFrame(quadro);return}ult=t;
    var x=cv.getContext('2d');x.setTransform(1,0,0,1,0,0);x.clearRect(0,0,cv.width,cv.height);
    var s=1+0.006*Math.sin((t-t0)/1400);x.setTransform(DPR*s,0,0,DPR*s,DPR*W*(1-s)/2,DPR*H*(1-s)/2);x.drawImage(base,0,0,W,H);
    /* varredura suave */
    var sx=((t-t0)/45)%(W+H)-H*0.5,gr=x.createLinearGradient(sx-60,0,sx+60,H*0.4);gr.addColorStop(0,'rgba(255,255,255,0)');gr.addColorStop(.5,'rgba(255,255,255,.07)');gr.addColorStop(1,'rgba(255,255,255,0)');
    x.globalCompositeOperation='source-atop';x.fillStyle=gr;x.fillRect(0,0,W,H);x.globalCompositeOperation='source-over';
    /* ondas discretas em pontos grandes */
    if(Math.random()<0.04&&P.length){var p=P[(Math.random()*Math.min(400,P.length))|0];pul.push({p:p,t:t})}
    pul=pul.filter(function(o){var a=(t-o.t)/1600;if(a>1)return false;x.beginPath();x.arc(o.p.x,o.p.y,o.p.r+a*14,0,6.2832);x.strokeStyle=(document.documentElement.classList.contains('tema-claro')?'rgba(29,78,216,'+(0.6*(1-a))+')':'rgba(255,255,255,'+(0.35*(1-a))+')');x.lineWidth=1;x.stroke();return true});
    raf=requestAnimationFrame(quadro)}
  function estatico(){var x=cv.getContext('2d');x.setTransform(1,0,0,1,0,0);x.clearRect(0,0,cv.width,cv.height);x.drawImage(base,0,0)}
  function iniciar(){if(!layout())return;if(RM){estatico();return}t0=performance.now();if(!raf)raf=requestAnimationFrame(quadro)}
  function carregar(){fetch('/2turno/pontos/mini.json?v=home2').then(function(r){return r.json()}).then(function(j){D=j.m;cv.parentNode.classList.add('ok');iniciar()}).catch(function(){})}
  var pedido=false;
  function ver(v){vis=v;if(v&&!pedido){pedido=true;carregar()}else if(v&&D&&!RM&&!raf)raf=requestAnimationFrame(quadro)}
  if('IntersectionObserver' in window)new IntersectionObserver(function(e){ver(e[0].isIntersecting)}).observe(cv);else ver(true);
  document.addEventListener('visibilitychange',function(){if(!document.hidden&&vis&&D&&!RM&&!raf)raf=requestAnimationFrame(quadro)});
  var rz=0;window.addEventListener('resize',function(){clearTimeout(rz);rz=setTimeout(function(){if(D&&cv.clientWidth!==W)iniciar()},200)});
})();
