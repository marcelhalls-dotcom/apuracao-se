const { chromium, devices } = require('/workspace/eleicoes-se/assinaturas/api/test/sem-analytics.cjs')(require('/workspace/eleicoes-se/build/node_modules/playwright-core'));
const OUT='/workspace/eleicoes-se/rebrand/bairro/presidente/fix-barra';
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  for (const [nm, g] of [['centro', [-9.838, -35.903]], ['praia', [-9.8445, -35.9017]], ['alto', [-9.832, -35.91]]]) {
    const ctx = await b.newContext({ ...devices['iPhone 14 Pro Max'], serviceWorkers: 'block', geolocation: { latitude: g[0], longitude: g[1] }, permissions: ['geolocation'] });
    const p = await ctx.newPage(); const err = []; p.on('pageerror', e => err.push(e.message));
    await p.goto(process.env.BASE + '#bairro'); await p.waitForSelector('#bx-consent');
    await p.click('#bx-consent [data-bx=geo]'); await p.waitForSelector('#bx-c5, .bx-aviso', { timeout: 30000 }); await p.waitForTimeout(2000);
    const ids = await p.$$eval('section.bx-sec', s => s.map(x => x.id));
    console.log(nm, (await p.textContent('#view-bairro h1')).trim(), '|', (await p.textContent('.bx-loc').catch(() => '')).trim().slice(0, 120), '|', ids.join(), err);
    if (ids.includes('bx-c1')) { await p.locator('#bx-c1').scrollIntoViewIfNeeded(); await p.evaluate(() => scrollBy(0, -90)); }
    await p.screenshot({ path: `${OUT}/${process.env.TAG}-geo-${nm}.png` });
    await ctx.close();
  }
  await b.close();
})();
