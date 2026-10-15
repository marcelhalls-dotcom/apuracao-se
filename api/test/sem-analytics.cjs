// Testes automáticos nunca entram nas estatísticas do site.
// 1) O site não carrega o Cloudflare Web Analytics nem soma no contador quando navigator.webdriver é true (Playwright).
// 2) Reforço aqui: no Chrome dos testes, static.cloudflareinsights.com e cloudflareinsights.com não resolvem (DNS),
//    então o beacon nunca carrega nem envia nada. (Via --host-resolver-rules e não page.route, que desligaria o cache HTTP.)
// Uso: const { chromium, devices } = require('/workspace/eleicoes-se/assinaturas/api/test/sem-analytics.cjs')(require('.../playwright-core'));
const REGRA = 'MAP static.cloudflareinsights.com ~NOTFOUND, MAP cloudflareinsights.com ~NOTFOUND';
module.exports = function semAnalytics(pw) {
  const bt = pw.chromium;
  if (bt && !bt.__semAnalytics) {
    bt.__semAnalytics = true;
    const add = (o = {}) => ({ ...o, args: [...(o.args || []).filter(a => !String(a).startsWith('--host-resolver-rules=')), '--host-resolver-rules=' + REGRA] });
    const launch = bt.launch.bind(bt), persist = bt.launchPersistentContext.bind(bt);
    bt.launch = o => launch(add(o));
    bt.launchPersistentContext = (dir, o) => persist(dir, add(o));
  }
  return pw;
};
module.exports.REGRA = REGRA;
