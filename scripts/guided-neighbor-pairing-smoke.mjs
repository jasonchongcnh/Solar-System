import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const server = http.createServer(async (request, response) => {
  const relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/+/, '');
  const file = path.resolve(root, relative || 'management-console.html');
  if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    const extension = path.extname(file);
    response.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' })[extension] || 'text/plain');
    response.end(body);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  try { browser = await chromium.launch({ headless: true }); }
  catch { browser = await chromium.launch({ channel: 'chrome', headless: true }); }
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('https://fonts.gstatic.com/**', route => route.abort());
  const url = `http://127.0.0.1:${server.address().port}/management-console.html?lang=en`;
  await page.goto(url);
  await page.evaluate(() => {
    completeUserSwitch(getStoredUsers().admin);
    hideLoginOverlay();
    consoleI18n.setLanguage('en');
    navigateTo('devices');
  });
  await page.waitForFunction(() => getComputedStyle(document.getElementById('loginOverlay')).visibility === 'hidden');
  await page.locator('#btnPairNeighbors').click();
  await page.locator('#btnStartGuidedPairing').click();
  assert.equal(await page.evaluate(() => getGuidedPairingEngine().getSession().state), 'idle', 'A real transport is required before pairing');
  await page.keyboard.press('Escape');

  async function installFixture(masks = { 1: 0, 4: 0, 6: 0 }) {
    await page.evaluate(async masks => {
      completeUserSwitch(getStoredUsers().admin);
      hideLoginOverlay();
      consoleI18n.setLanguage('en');
      window.pairingSmokeTime = Date.now();
      Date.now = () => window.pairingSmokeTime;
      const ids = [1, 4, 6], sequences = {}, boots = {};
      class FixtureSocket {
        static OPEN = 1;
        constructor(url) { this.url = url; this.readyState = 0; this.writes = []; }
        open() { this.readyState = 1; this.onopen?.(); }
        send(line) { this.writes.push(line); }
        close() { this.readyState = 3; this.onclose?.(); }
      }
      window.WebSocket = FixtureSocket;
      const packet = id => ({
        type: 'telemetry', id, seq: sequences[id] = (sequences[id] || 0) + 1,
        boot_id: boots[id] || 1000 + id, mac: `02:11:22:33:44:${String(id).padStart(2, '0')}`,
        hall_mask: masks[id], neighbor_detection: 'disabled', edge_neighbors: Array(6).fill(null),
        enabled: true, status: 'online', power_control_available: false,
        q: id === 1 ? 0 : id === 4 ? 1 : 2, r: 0
      });
      const sample = (elapsed = 0) => {
        window.pairingSmokeTime += elapsed;
        for (const id of ids) wsClient.onmessage({ data: JSON.stringify(packet(id)) });
      };
      const connect = async () => { await connectWebSocket('ws://pairing.test/gateway'); wsClient.open(); };
      window.pairingSmoke = {
        masks, boots, packet, sample, connect,
        tick(elapsed) { window.pairingSmokeTime += elapsed; refreshNeighborTopology(); }
      };
      await connect(); sample(); navigateTo('devices');
    }, masks);
    await page.waitForFunction(() => getComputedStyle(document.getElementById('loginOverlay')).visibility === 'hidden');
  }
  await installFixture();
  await page.locator('#btnPairNeighbors').click();
  await page.locator('#btnStartGuidedPairing').click();
  assert.equal(await page.evaluate(() => getGuidedPairingEngine().getSession().state), 'waiting');
  await page.evaluate(() => { pairingSmoke.masks[1] = 4; pairingSmoke.masks[4] = 32; pairingSmoke.sample(100); pairingSmoke.tick(1600); });
  await page.waitForFunction(() => !document.getElementById('btnConfirmGuidedPairing').disabled);
  assert.match(await page.locator('#guidedPairingCandidate').textContent(), /HEX-01 D2.*HEX-04 D5/);
  assert.equal(await page.evaluate(() => getGuidedPairingEngine().getLinks().length), 0, 'Two Hall changes alone must not create a pairing');
  await page.locator('#btnConfirmGuidedPairing').click();
  assert.deepEqual(await page.evaluate(() => ({
    kind: getNeighborSideState(1, 2).kind, count: edges.length, dashed: edges[0]?.operatorPaired,
    saved: JSON.parse(localStorage.getItem(GUIDED_PAIRING_STORAGE_KEY)).links.length,
    automatic: getAutomaticNeighborSideState(1, 2).kind
  })), { kind: 'paired', count: 1, dashed: true, saved: 1, automatic: 'disabled' });
  await page.evaluate(() => consoleI18n.setLanguage('zh-TW'));
  await page.waitForFunction(() => document.getElementById('guidedPairingLinks').textContent.includes('已由操作員配對'));
  await page.evaluate(() => { consoleI18n.setLanguage('en'); closeModal(); viewDevice(1); });
  await page.waitForFunction(() => document.querySelector('[data-neighbor-side="2"]').textContent.includes('Paired by operator'));
  await page.waitForFunction(() => Number(getComputedStyle(document.getElementById('modalBox')).opacity) >= 0.99);
  const screenshotDir = path.join(root, '.artifacts/neighbors');
  await mkdir(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, 'operator-paired.png'), fullPage: true, animations: 'disabled' });

  await page.evaluate(() => { pairingSmoke.masks[1] = 0; pairingSmoke.sample(100); pairingSmoke.masks[1] = 4; pairingSmoke.sample(100); });
  assert.equal(await page.evaluate(() => getNeighborSideState(1, 2).kind), 'pairing_required', 'Reattachment must not restore operator confirmation');
  await page.evaluate(() => openNeighborPairingModal());
  await page.locator('[data-pairing-reconfirm]').click();
  assert.equal(await page.evaluate(() => getNeighborSideState(1, 2).kind), 'paired');
  await page.evaluate(async () => { await pairingSmoke.connect(); });
  assert.equal(await page.evaluate(() => getNeighborSideState(1, 2).kind), 'pairing_required', 'Replacing a transport must invalidate the old pairing even before a health-monitor tick');
  await page.evaluate(() => pairingSmoke.sample(100));
  await page.locator('[data-pairing-reconfirm]').click();
  assert.equal(await page.evaluate(() => getNeighborSideState(1, 2).kind), 'paired');
  await page.evaluate(() => { disconnectWebSocket(); pairingSmoke.tick(1); });
  await page.evaluate(async () => { await pairingSmoke.connect(); pairingSmoke.sample(100); });
  assert.equal(await page.evaluate(() => getNeighborSideState(1, 2).kind), 'pairing_required', 'Fresh reports after reconnect still require a human confirmation');
  await page.locator('[data-pairing-reconfirm]').click();
  assert.equal(await page.evaluate(() => getNeighborSideState(1, 2).kind), 'paired');

  await page.reload();
  await installFixture({ 1: 4, 4: 32, 6: 0 });
  assert.equal(await page.evaluate(() => getNeighborSideState(1, 2).kind), 'pairing_required', 'Reloading restores the map, not its active confidence');
  await page.locator('#btnPairNeighbors').click();
  await page.locator('[data-pairing-reconfirm]').click();
  assert.equal(await page.evaluate(() => getNeighborSideState(1, 2).kind), 'paired');
  await page.locator('[data-pairing-forget]').click();
  assert.equal(await page.evaluate(() => getGuidedPairingEngine().getLinks().length), 0);
  await page.evaluate(() => { pairingSmoke.masks[1] = 0; pairingSmoke.masks[4] = 0; pairingSmoke.sample(100); });
  await page.locator('#btnStartGuidedPairing').click();
  await page.evaluate(() => { pairingSmoke.masks[1] = 4; pairingSmoke.masks[4] = 32; pairingSmoke.masks[6] = 1; pairingSmoke.sample(100); pairingSmoke.tick(1600); });
  assert.equal(await page.evaluate(() => getGuidedPairingEngine().getSession().reason), 'too_many_edges');
  assert.equal(await page.locator('#btnConfirmGuidedPairing').isDisabled(), true, 'Ambiguous simultaneous changes cannot be confirmed');

  await page.locator('#btnCancelGuidedPairing').click();
  await page.evaluate(() => { pairingSmoke.masks[1] = 0; pairingSmoke.masks[4] = 0; pairingSmoke.masks[6] = 0; pairingSmoke.sample(100); });
  await page.locator('#btnStartGuidedPairing').click();
  await page.evaluate(() => {
    pairingSmoke.masks[1] = 4; pairingSmoke.masks[4] = 32;
    parseHardwarePacket(JSON.stringify(pairingSmoke.packet(1)), { demo: true });
    parseHardwarePacket(JSON.stringify(pairingSmoke.packet(4)), { demo: true });
    pairingSmoke.tick(1600);
  });
  assert.equal(await page.locator('#btnConfirmGuidedPairing').isDisabled(), true, 'Even complete demo packets cannot provide pairing evidence');
  assert.equal(await page.evaluate(() => getGuidedPairingEngine().getLinks().length), 0);

  await page.locator('#btnCancelGuidedPairing').click();
  await page.evaluate(() => { pairingSmoke.masks[1] = 0; pairingSmoke.masks[4] = 0; pairingSmoke.sample(100); });
  await page.locator('#btnStartGuidedPairing').click();
  await page.evaluate(() => { pairingSmoke.masks[1] = 4; pairingSmoke.masks[4] = 32; pairingSmoke.sample(100); pairingSmoke.tick(1600); });
  await page.evaluate(() => {
    window.pairingSmokeOriginalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === GUIDED_PAIRING_STORAGE_KEY) throw new Error('Storage fixture');
      return window.pairingSmokeOriginalSetItem.call(this, key, value);
    };
  });
  await page.locator('#btnConfirmGuidedPairing').click();
  assert.equal(await page.evaluate(() => getNeighborSideState(1, 2).kind), 'paired');
  await page.waitForFunction(() => document.getElementById('guidedPairingStorage').textContent.includes('only active for this session'));
  await page.evaluate(() => { Storage.prototype.setItem = window.pairingSmokeOriginalSetItem; });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Pairing controls must fit the mobile viewport');
  await page.evaluate(() => { closeModal(); completeUserSwitch(getStoredUsers().guest); openNeighborPairingModal(); });
  assert.equal(await page.locator('#modalRoot').evaluate(element => element.classList.contains('active')), false, 'Guests cannot edit neighbor pairings');
  assert.deepEqual(errors, []);
  console.log('Guided pairing browser smoke passed: real transport, explicit confirmation, persistence/reload, detach/reconnect, ambiguous edges, demo exclusion, storage failure, bilingual labels and mobile controls.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
