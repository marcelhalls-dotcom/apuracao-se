(function(){'use strict';
const $=s=>document.querySelector(s), FB='Flávio Bolsonaro', ORD=['Verdadeiro','Impreciso','Falso'];
const el=(t,c,txt)=>{const e=document.createElement(t);if(c)e.className=c;if(txt!=null)e.textContent=txt;return e;};
const link=(u,t)=>{const a=el('a',null,t);try{const x=new URL(u);if(x.protocol!=='https:')return el('span',null,t);a.href=x.href;}catch(e){return el('span',null,t);}a.target='_blank';a.rel='noopener noreferrer';return a;};
let D=null,aba='geral';
function intercalar(arr){const f=arr.filter(x=>x.candidato===FB),l=arr.filter(x=>x.candidato==='Lula'),o=[];for(let i=0;i<Math.max(f.length,l.length);i++){if(f[i])o.push(f[i]);if(l[i])o.push(l[i]);}return o;}
function kpis(fs){const k=$('#kpis');k.replaceChildren();const n=v=>fs.filter(x=>x.veredito===v).length;
 [['Falas checadas',fs.length,aba==='geral'?'Flávio '+fs.filter(x=>x.candidato===FB).length+' · Lula '+fs.filter(x=>x.candidato==='Lula').length:'g1 Fato ou Fake'],['Verdadeiro',n('Verdadeiro'),'#FATO'],['Impreciso',n('Impreciso'),'#NÃOÉBEMASSIM'],['Falso',n('Falso'),'#FAKE']]
 .forEach(([t,v,s])=>{const d=el('div','kpi');d.append(el('span',null,t),el('b',null,String(v)),el('small',null,s));k.append(d);});}
function barras(){const b=$('#barras');b.replaceChildren();const cs=aba==='geral'?[FB,'Lula']:[aba];b.classList.toggle('duas',cs.length>1);
 cs.forEach(c=>{const fs=D.falas.filter(x=>x.candidato===c),box=el('div','cand-bar'),h=el('b',null,c+' ');h.append(el('span','n','('+fs.length+' falas)'));box.append(h);
  ORD.forEach(v=>{const q=fs.filter(x=>x.veredito===v).length,p=fs.length?Math.round(q/fs.length*100):0,r=el('div','linha v-'+v),t=el('div','trilho'),i=el('i');i.style.width=p+'%';t.append(i);r.setAttribute('aria-label',v+': '+q+' de '+fs.length);r.append(el('span',null,v),t,el('span',null,p+'%'));box.append(r);});b.append(box);});}
function lista(){const v=$('#f-ver').value,t=$('#f-tema').value,c=aba==='geral'?$('#f-cand').value:aba;
 let fs=D.falas.filter(x=>(!v||x.veredito===v)&&(!t||x.tema===t)&&(!c||x.candidato===c));if(!c)fs=intercalar(fs);
 $('#contagem').textContent=fs.length+' de '+D.falas.length+' falas'+(c||v||t?' (filtradas)':' · ordem intercalada entre os candidatos');
 const ol=$('#lista');ol.replaceChildren();
 fs.forEach(x=>{const li=el('li'),top=el('div','topo-fala');top.append(el('span','pill v-'+x.veredito,x.veredito),el('span','quem',x.candidato),el('span',null,'· '+x.tema));
  const ev=el('div','ev');(x.evidencias||[]).forEach(e=>ev.append(link(e.url,e.titulo)));
  li.append(top,el('p','fala','“'+x.trecho+'”'),el('p','exp',x.explicacao),ev);ol.append(li);});}
function render(){document.querySelectorAll('.abas button').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.aba===aba)));
 const met=aba==='metodologia';$('#conteudo').hidden=met;$('#metodologia').hidden=!met;$('#lb-cand').hidden=aba!=='geral';
 if(met)return;kpis(aba==='geral'?D.falas:D.falas.filter(x=>x.candidato===aba));barras();lista();}
fetch('/checagem/falas.json?v=20261024arc8',{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error(r.status);return r.json();}).then(d=>{D=d;
 $('#titulo').firstChild.textContent=d.titulo+' ';$('#sub').textContent=d.subtitulo;$('#aviso').textContent=d.aviso+' Atualizado em '+d.atualizado_em.split('-').reverse().join('/')+'.';
 [...new Set(d.falas.map(x=>x.tema))].sort((a,b)=>a.localeCompare(b,'pt')).forEach(t=>$('#f-tema').append(new Option(t,t)));
 const m=$('#met');d.metodologia.split('\n').forEach(l=>m.append(el('p',null,l)));
 const f=$('#fontes');d.fontes.forEach(x=>{const li=el('li');li.append(link(x.url,x.nome));f.append(li);});
 const h=decodeURIComponent(location.hash.slice(1));if(h==='flavio')aba=FB;else if(h==='lula')aba='Lula';else if(h==='metodologia')aba='metodologia';
 render();}).catch(()=>{$('#contagem').textContent='Não foi possível carregar a checagem. Tente recarregar a página.';});
document.querySelectorAll('.abas button').forEach(b=>b.addEventListener('click',()=>{aba=b.dataset.aba;render();}));
['#f-ver','#f-tema','#f-cand'].forEach(s=>$(s).addEventListener('change',lista));
})();
