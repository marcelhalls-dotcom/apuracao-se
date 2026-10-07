/* Cadê Meu Voto — app instalável (PWA): service worker, aviso "Instalar app", aviso de versão nova e
 * downloads no iPhone com o app aberto pela Tela de Início (modo standalone). */
(function (global) {
  'use strict';
  const LS_DISPENSA = 'cmv-pwa-instalar-dispensado';
  const DIAS_DISPENSA = 90;
  const ua = navigator.userAgent || '';
  const isIOS = /iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isIOSSafari = isIOS && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|Instagram|FBAN|FBAV|Line\//.test(ua);
  const standalone = () => (global.matchMedia && global.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  let promptEvt = null;

  /* ---------------- estilos ---------------- */
  const css = `
  .cmv-pwa,.cmv-pwa *,.cmv-upd,.cmv-upd *,.cmv-dl,.cmv-dl *{box-sizing:border-box}
  .cmv-pwa{position:fixed;left:16px;bottom:calc(16px + env(safe-area-inset-bottom));z-index:80;max-width:380px;display:flex;gap:12px;align-items:center;
    background:#111E3A;border:1px solid rgba(148,163,184,.28);border-radius:14px;padding:10px 10px 10px 12px;box-shadow:0 12px 32px rgba(0,0,0,.45);color:#F8FAFC;font-size:.9rem;line-height:1.35}
  .cmv-pwa img{width:36px;height:36px;border-radius:9px;flex:none}
  .cmv-pwa .t{flex:1;min-width:0}.cmv-pwa .t b{display:block;font-size:.92rem}.cmv-pwa .t span{color:#94A3B8;font-size:.8rem}
  .cmv-pwa button{font:inherit;cursor:pointer;border-radius:10px;min-height:40px}
  .cmv-pwa .ok{background:#22C55E;color:#052E16;border:0;font-weight:700;padding:8px 12px;white-space:nowrap}
  .cmv-pwa .x{background:none;border:0;color:#94A3B8;font-size:1.35rem;line-height:1;width:36px;padding:0}
  .cmv-pwa.ios{align-items:flex-start}.cmv-pwa.ios ol{margin:6px 0 0;padding-left:18px;color:#CBD5E1;font-size:.84rem}.cmv-pwa.ios li{margin:2px 0}
  .cmv-pwa.ios svg{width:15px;height:15px;vertical-align:-2px;margin:0 2px}.cmv-pwa.ios li b{display:inline}
  .cmv-upd{position:fixed;left:50%;transform:translateX(-50%);top:calc(70px + env(safe-area-inset-top));z-index:90;display:flex;gap:10px;align-items:center;
    background:#1E3A8A;border:1px solid rgba(147,197,253,.4);border-radius:999px;padding:6px 6px 6px 16px;color:#EFF6FF;font-size:.88rem;box-shadow:0 10px 28px rgba(0,0,0,.45)}
  .cmv-upd button{font:inherit;font-weight:700;border:0;border-radius:999px;background:#F8FAFC;color:#1E3A8A;padding:7px 14px;cursor:pointer;min-height:36px}
  .cmv-dl{position:fixed;inset:0;z-index:10000;display:flex;align-items:flex-end;justify-content:center;background:rgba(2,6,23,.6);padding:16px;padding-bottom:calc(16px + env(safe-area-inset-bottom))}
  .cmv-dl>div{width:100%;max-width:420px;background:#1E293B;border:1px solid rgba(148,163,184,.25);border-radius:16px;padding:18px;color:#F8FAFC}
  .cmv-dl h2{margin:0 0 6px;font-size:1.1rem}.cmv-dl p{margin:0 0 14px;color:#CBD5E1;font-size:.9rem;line-height:1.45;word-break:break-word}
  .cmv-dl .acts{display:flex;gap:8px}.cmv-dl button{flex:1;min-height:46px;border-radius:12px;font:inherit;font-weight:700;cursor:pointer}
  .cmv-dl .ok{background:#22C55E;color:#052E16;border:0}.cmv-dl .sec{background:transparent;color:#E2E8F0;border:1px solid rgba(148,163,184,.4)}
  @media (max-width:860px){.cmv-pwa{left:12px;right:76px;max-width:none;bottom:calc(var(--bn-h,0px) + 12px + env(safe-area-inset-bottom))}}
  @media (display-mode: standalone){.site-header{padding-top:env(safe-area-inset-top)!important}}
  html.cmv-standalone .site-header{padding-top:env(safe-area-inset-top)!important}`;
  function injectCss() { if (document.getElementById('cmv-pwa-css')) return; const s = document.createElement('style'); s.id = 'cmv-pwa-css'; s.textContent = css; document.head.appendChild(s); }

  /* ---------------- service worker + aviso de versão nova ---------------- */
  function registrarSW() {
    if (!('serviceWorker' in navigator) || !global.isSecureContext) return;
    // 1ª visita: o SW assume a página (clients.claim) sem recarregar; só recarrega quando uma versão nova substitui a anterior
    let recarregando = false; const tinhaControle = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (recarregando || !tinhaControle) return; recarregando = true; location.reload(); });
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then(reg => {
      const avisar = w => { if (w && navigator.serviceWorker.controller) mostrarAtualizar(w); };
      if (reg.waiting) avisar(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing; if (!w) return;
        w.addEventListener('statechange', () => { if (w.state === 'installed') avisar(w); });
      });
      // verifica deploy novo ao voltar para o app (e a cada 30 min com ele aberto)
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
      setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
      global.CMV_PWA.registro = reg;
    }).catch(e => console.warn('service worker', e));
  }
  function mostrarAtualizar(worker) {
    if (document.getElementById('cmv-upd')) return;
    injectCss();
    const d = document.createElement('div'); d.id = 'cmv-upd'; d.className = 'cmv-upd'; d.setAttribute('role', 'status');
    d.innerHTML = '<span>Nova versão do Cadê Meu Voto</span><button type="button">Atualizar</button>';
    d.querySelector('button').addEventListener('click', () => { d.querySelector('button').disabled = true; worker.postMessage({ tipo: 'ATUALIZAR' }); });
    document.body.appendChild(d);
  }

  /* ---------------- "Instalar app" ---------------- */
  function dispensado() { try { const t = Number(localStorage.getItem(LS_DISPENSA) || 0); return t && (Date.now() - t) < DIAS_DISPENSA * 864e5; } catch (_) { return false; } }
  function dispensar() { try { localStorage.setItem(LS_DISPENSA, String(Date.now())); } catch (_) {} fecharAviso(); }
  function fecharAviso() { const e = document.getElementById('cmv-pwa'); if (e) e.remove(); }
  const ICONE = '<img src="/brand/icon-192.png?v=20261007pwa1" alt="">';
  function avisoAndroid() {
    if (!promptEvt || standalone() || dispensado() || document.getElementById('cmv-pwa')) return;
    injectCss();
    const d = document.createElement('div'); d.id = 'cmv-pwa'; d.className = 'cmv-pwa'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', 'Instalar o app Cadê Meu Voto');
    d.innerHTML = ICONE + '<div class="t"><b>Instalar app</b><span>Abra o Cadê Meu Voto direto da tela inicial.</span></div>'
      + '<button type="button" class="ok">Instalar</button><button type="button" class="x" aria-label="Agora não">×</button>';
    d.querySelector('.ok').addEventListener('click', async () => {
      const e = promptEvt; promptEvt = null; fecharAviso();
      if (!e) return;
      try { e.prompt(); const r = await e.userChoice; if (r && r.outcome === 'dismissed') dispensar(); } catch (_) {}
    });
    d.querySelector('.x').addEventListener('click', dispensar);
    document.body.appendChild(d);
  }
  const SVG_COMPARTILHAR = '<svg viewBox="0 0 24 24" fill="none" stroke="#60A5FA" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
  const SVG_MAIS = '<svg viewBox="0 0 24 24" fill="none" stroke="#60A5FA" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/></svg>';
  function avisoIOS() {
    if (!isIOSSafari || standalone() || dispensado() || document.getElementById('cmv-pwa')) return;
    injectCss();
    const d = document.createElement('div'); d.id = 'cmv-pwa'; d.className = 'cmv-pwa ios'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', 'Instalar o app no iPhone');
    d.innerHTML = ICONE + '<div class="t"><b>Instale o app no iPhone</b><ol>'
      + '<li>Toque em <b>Compartilhar</b> ' + SVG_COMPARTILHAR + ' na barra do Safari</li>'
      + '<li>Escolha <b>Adicionar à Tela de Início</b> ' + SVG_MAIS + '</li></ol></div>'
      + '<button type="button" class="x" aria-label="Agora não">×</button>';
    d.querySelector('.x').addEventListener('click', dispensar);
    document.body.appendChild(d);
  }
  global.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); promptEvt = e;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(avisoAndroid, 4000));
    else setTimeout(avisoAndroid, 4000);
  });
  global.addEventListener('appinstalled', () => { promptEvt = null; fecharAviso(); try { localStorage.setItem(LS_DISPENSA, String(Date.now() + 3650 * 864e5)); } catch (_) {} });

  /* ---------------- downloads no iPhone (app aberto pela Tela de Início) ----------------
   * No modo standalone do iOS, <a download> com blob abre uma prévia sem jeito fácil de salvar ou voltar.
   * Lá usamos o menu Compartilhar do sistema (Salvar em Arquivos, AirDrop, WhatsApp…). Em todo o resto
   * (Android, computador, Safari normal) o download continua igual. */
  const precisaCompartilhar = () => isIOS && standalone();
  async function compartilhar(file) {
    try { await navigator.share({ files: [file], title: file.name }); return 'compartilhado'; }
    catch (e) { if (e && e.name === 'AbortError') return 'cancelado'; throw e; }
  }
  function baixarNormal(blob, nome) {
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = nome; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return 'baixado';
  }
  function modalSalvar(file) {
    return new Promise(resolve => {
      injectCss();
      const m = document.createElement('div'); m.className = 'cmv-dl'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
      m.innerHTML = '<div><h2>Seu arquivo está pronto</h2><p></p><div class="acts"><button type="button" class="sec">Fechar</button><button type="button" class="ok">Salvar ou enviar</button></div></div>';
      m.querySelector('p').textContent = file.name + ' — toque em “Salvar ou enviar” e escolha “Salvar em Arquivos”, WhatsApp ou outro app.';
      const fim = r => { m.remove(); resolve(r); };
      m.querySelector('.sec').addEventListener('click', () => fim('fechado'));
      m.querySelector('.ok').addEventListener('click', async () => {
        try { fim(await compartilhar(file)); } catch (_) { fim(baixarNormal(file, file.name)); }
      });
      document.body.appendChild(m);
      setTimeout(() => m.querySelector('.ok').focus(), 30);
    });
  }
  /** Salva um arquivo gerado no aparelho (PDF, Excel, JSON). */
  async function salvar(blob, nome) {
    if (!precisaCompartilhar()) return baixarNormal(blob, nome);
    const file = new File([blob], nome, { type: blob.type || 'application/octet-stream' });
    if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
      try { return await compartilhar(file); }        // funciona se o gesto do toque ainda vale
      catch (_) { return modalSalvar(file); }          // relatório demorou: pede um toque novo
    }
    return baixarNormal(blob, nome);
  }

  global.CMV_PWA = { salvar, precisaCompartilhar, standalone, isIOS, registro: null };
  if (standalone()) document.documentElement.classList.add('cmv-standalone');
  const iniciar = () => { registrarSW(); setTimeout(avisoIOS, 4000); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})(window);
