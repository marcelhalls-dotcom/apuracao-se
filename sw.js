/* Cadê Meu Voto — service worker (app instalável).
 *
 * O que fica no cache: SÓ o "casco" do app neste domínio (HTML, JS, CSS, fontes, ícones) e a página offline.
 * O que NUNCA passa por aqui: qualquer outro domínio (api.cademeuvoto.com.br, dados.cademeuvoto.com.br, Turnstile, Stripe…),
 * pedidos que não sejam GET, e caminhos de dados (/dados/, /mapa/, /fotos/, /tse/). Esses vão direto à rede, com o
 * cache HTTP normal do navegador. Relatórios (PDF/Excel) são gerados no aparelho e nunca são guardados aqui.
 *
 * Atualização: a cada deploy que mude o casco, troque VERSAO. O HTML vem sempre da rede primeiro (nada de app velho);
 * JS/CSS com ?v= vêm do cache (rápido) e o ?v= novo do index.html força a versão nova. O site mostra "Nova versão —
 * Atualizar" quando um service worker novo estiver esperando.
 */
const VERSAO = '20261008bairro2';
const CACHE = 'cmv-casco-' + VERSAO;
const OFFLINE = '/offline.html';
const PRECACHE = [
  OFFLINE,
  '/brand/icon-192.png?v=20261007pwa4',
  '/brand/icon-512.png?v=20261007pwa4',
  '/brand/icon-maskable-512.png?v=20261007pwa4',
  '/apple-touch-icon.png?v=20261007pwa4',
  '/favicon.svg?v=20261007br1',
];
// Só estes tipos de arquivo do próprio domínio entram no cache em tempo de uso.
const CASCO_RE = /\.(?:js|css|woff2|svg|png|ico|webmanifest|jpg)$/i;
const NUNCA_RE = /^\/(?:dados|mapa|fotos|tse|api|chat|relatorios|conta|auth|admin|stripe|__dev)(?:\/|$)/;

self.addEventListener('install', ev => {
  ev.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE.map(u => new Request(u, { cache: 'reload' })))));
  // Não chama skipWaiting aqui: a página pergunta ao usuário ("Atualizar") e só então trocamos.
});

self.addEventListener('activate', ev => {
  ev.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('cmv-') && k !== CACHE) await caches.delete(k);
    // sem navigation preload: ele usaria o cache HTTP (max-age do Pages) e poderia abrir um index velho/offline
    if (self.registration.navigationPreload) { try { await self.registration.navigationPreload.disable(); } catch (_) {} }
    await self.clients.claim();
  })());
});

self.addEventListener('message', ev => {
  if (ev.data && ev.data.tipo === 'ATUALIZAR') self.skipWaiting();
  if (ev.data && ev.data.tipo === 'VERSAO' && ev.ports[0]) ev.ports[0].postMessage({ versao: VERSAO, cache: CACHE });
});

self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;           // API, dados (R2), Turnstile etc.: rede direta
  if (NUNCA_RE.test(url.pathname)) return;
  if (req.headers.has('authorization') || req.headers.has('range')) return;

  if (req.mode === 'navigate') { ev.respondWith(navegar(ev)); return; }
  if (url.pathname === '/sw.js') return;
  if (CASCO_RE.test(url.pathname)) ev.respondWith(casco(req, url));
});

// HTML: sempre da rede, revalidando (cache:'no-cache' → 304 barato), para nunca abrir versão velha.
// Sem rede: página offline amigável.
async function navegar(ev) {
  try {
    return await fetch(ev.request, { cache: 'no-cache' });
  } catch (_) {
    const c = await caches.open(CACHE);
    return (await c.match(OFFLINE)) || new Response('<h1>Sem conexão</h1>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

// Casco: com ?v= → cache primeiro (o ?v= muda a cada deploy); sem ?v= → usa o cache e atualiza em segundo plano.
async function casco(req, url) {
  const c = await caches.open(CACHE);
  const hit = await c.match(req);
  const versionado = url.searchParams.has('v');
  const daRede = fetch(req).then(async r => {
    if (r.ok && r.type === 'basic' && !/no-store|private/i.test(r.headers.get('Cache-Control') || '')) {
      await c.put(req, r.clone());
      if (versionado) limparVersoesAntigas(c, url);
    }
    return r;
  });
  if (hit) { if (!versionado) daRede.catch(() => {}); return hit; }
  try { return await daRede; } catch (e) { return hit || Response.error(); }
}

async function limparVersoesAntigas(c, url) {
  for (const k of await c.keys()) {
    const u = new URL(k.url);
    if (u.pathname === url.pathname && u.search !== url.search && !PRECACHE.includes(u.pathname + u.search)) await c.delete(k);
  }
}
