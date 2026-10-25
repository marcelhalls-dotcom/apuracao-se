/* Mapa de pontos embutido na /2turno/: iframe isolado; nada aqui toca no placar. */
(function(){try{var f=document.getElementById('pontos-frame');if(!f)return;
window.addEventListener('message',function(e){try{if(e.origin!==location.origin||e.source!==f.contentWindow)return;var h=+(e.data&&e.data.cmvPontosAltura);if(h>200&&h<20000)f.style.height=h+'px'}catch(_){}});
}catch(_){}})();
