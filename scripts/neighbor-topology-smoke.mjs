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
    response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/plain');
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
  await page.goto(`http://127.0.0.1:${server.address().port}/management-console.html?lang=en`);
  await page.waitForTimeout(250);
  const checks = await page.evaluate(() => {
    const mac = id => `02:11:22:33:44:${String(id).padStart(2, '0')}`;
    const claim = (id, side, age = 0) => ({ id, side, boot_id: id * 101, mac: mac(id), age_ms: age });
    let sequence = 0;
    const node = (id, side, peer, peerSide) => {
      const neighbors = Array(6).fill(null);
      neighbors[side] = claim(peer, peerSide);
      return { type: 'telemetry', id, boot_id: id * 101, mac: mac(id), seq: ++sequence,
        hall_mask: 1 << side, neighbor_detection: 'ready', edge_neighbors: neighbors,
        enabled: true, status: 'online', power_control_available: false, q: id === 1 ? 0 : 1, r: 0 };
    };
    const publish = packet => parseHardwarePacket(JSON.stringify(packet));
    const pair = () => { publish(node(1, 2, 4, 5)); publish(node(4, 5, 1, 2)); };
    const state = () => getNeighborSideState(1, 2).kind;
    const checks = {};

    publish(node(1, 2, 4, 5));
    checks.oneSided = state() === 'waiting_peer' && edges.length === 0;
    viewDevice(1);
    const footer = document.getElementById('modalFooter');
    const button = footer.querySelector('button');
    button.focus();
    publish(node(4, 5, 1, 2));
    checks.mutual = state() === 'confirmed' && edges.length === 1
      && edges[0].fromSide === 2 && edges[0].toSide === 5;
    checks.detailRefresh = document.querySelector('[data-neighbor-side="2"]').dataset.neighborState === 'confirmed'
      && document.querySelector('[data-neighbor-side="2"]').textContent.includes('HEX-04 D5')
      && document.getElementById('modalFooter') === footer && document.activeElement === button;

    const noReply = node(4, 5, 1, 2); noReply.edge_neighbors[5] = null; publish(noReply);
    checks.noReciprocal = state() === 'waiting_peer' && edges.length === 0;
    pair();
    const wrongSide = node(4, 5, 1, 1); publish(wrongSide);
    checks.sideMismatch = state() === 'conflict' && edges.length === 0;
    pair();
    const wrongBoot = node(1, 2, 4, 5); wrongBoot.edge_neighbors[2].boot_id++; publish(wrongBoot);
    checks.bootMismatch = state() === 'conflict' && edges.length === 0;
    pair();
    const wrongMac = node(1, 2, 4, 5); wrongMac.edge_neighbors[2].mac = mac(6); publish(wrongMac);
    checks.macMismatch = state() === 'conflict' && edges.length === 0;
    pair();
    const reboot = node(4, 5, 1, 2); reboot.boot_id++; publish(reboot);
    checks.peerReboot = state() === 'conflict' && edges.length === 0;
    pair();
    const noHall = node(4, 5, 1, 2); noHall.hall_mask = 0; noHall.edge_neighbors[5] = null; publish(noHall);
    checks.hallConflict = state() === 'conflict' && edges.length === 0;
    pair();
    const noLocalBoot = node(1, 2, 4, 5); delete noLocalBoot.boot_id; publish(noLocalBoot);
    checks.missingBootCleared = state() === 'invalid' && deviceTelemetry.get(1).bootId === null && edges.length === 0;
    pair();
    const noPayload = node(1, 2, 4, 5); delete noPayload.neighbor_detection; delete noPayload.edge_neighbors; publish(noPayload);
    checks.missingPayload = !deviceTelemetry.get(1).edgeNeighbors && state() === 'unavailable' && edges.length === 0;

    const malformed = [
      packet => { packet.edge_neighbors.pop(); },
      packet => { packet.edge_neighbors = {}; },
      packet => { packet.neighbor_detection = 'maybe'; },
      packet => { delete packet.neighbor_detection; },
      packet => { delete packet.edge_neighbors; },
      packet => { packet.edge_neighbors[2] = []; },
      packet => { packet.edge_neighbors[2].id = 0; },
      packet => { packet.edge_neighbors[2].id = 9; },
      packet => { packet.edge_neighbors[2].id = 1; },
      packet => { packet.edge_neighbors[2].id = '4'; },
      packet => { packet.edge_neighbors[2].side = 6; },
      packet => { packet.edge_neighbors[2].side = -1; },
      packet => { packet.edge_neighbors[2].side = 1.5; },
      packet => { packet.edge_neighbors[2].boot_id = 0; },
      packet => { packet.edge_neighbors[2].boot_id = 0x100000000; },
      packet => { packet.edge_neighbors[2].age_ms = 3000; },
      packet => { packet.edge_neighbors[2].age_ms = -1; },
      packet => { packet.edge_neighbors[2].age_ms = '0'; },
      packet => { packet.edge_neighbors[2].mac = '<img src=x onerror=alert(1)>'; },
      packet => { packet.edge_neighbors[2].mac = '00:00:00:00:00:00'; },
      packet => { packet.edge_neighbors[2].mac = 'FF:FF:FF:FF:FF:FF'; },
      packet => { packet.edge_neighbors[2].mac = '01:11:22:33:44:55'; },
      packet => { packet.edge_neighbors[2].mac = mac(1); },
      packet => { packet.hall_mask |= 1; packet.edge_neighbors[0] = claim(4, 0); },
      packet => { packet.hall_mask |= 1; packet.edge_neighbors[0] = { ...claim(3, 0), mac: mac(4) }; },
      packet => { packet.hall_mask = 0; },
      packet => { packet.neighbor_detection = 'disabled'; }
    ];
    checks.malformed = malformed.map(mutate => {
      pair();
      const packet = node(1, 2, 4, 5); mutate(packet); publish(packet);
      return deviceTelemetry.get(1).neighborDetection === 'invalid'
        && deviceTelemetry.get(1).edgeNeighbors === null && edges.length === 0;
    });
    checks.noInjectedHtml = !document.querySelector('#deviceNeighborDetails img');

    pair();
    const disabled = node(1, 2, 4, 5); disabled.neighbor_detection = 'disabled'; disabled.edge_neighbors.fill(null); publish(disabled);
    checks.disabled = state() === 'disabled' && edges.length === 0;
    disabled.neighbor_detection = 'hardware_error'; publish(disabled);
    checks.hardwareError = state() === 'hardware_error' && edges.length === 0;
    disabled.neighbor_detection = 'ready'; publish(disabled);
    checks.awaitingIdentity = state() === 'awaiting_identity' && edges.length === 0;
    pair();
    const lastReport = deviceTelemetry.get(4).lastReport;
    publish({ type: 'node_status', id: 4, status: 'offline' });
    checks.offline = state() === 'offline' && edges.length === 0 && deviceTelemetry.get(4).lastReport === lastReport;
    pair();
    setHardwareConnected(false);
    checks.disconnect = state() === 'disconnected' && edges.length === 0;
    setHardwareConnected(true, 'Neighbor smoke');
    checks.reconnectNeedsReports = state() !== 'confirmed' && edges.length === 0;
    publish(node(1, 2, 4, 5));
    checks.reconnectNeedsBothReports = state() === 'waiting_peer' && edges.length === 0;
    publish(node(4, 5, 1, 2));
    checks.reconnectRecovers = state() === 'confirmed' && edges.length === 1;
    pair();
    deviceTelemetry.get(4).lastReport = Date.now() - 31000;
    refreshNeighborTopology();
    checks.stalePeer = state() === 'stale' && edges.length === 0;
    pair();
    const legacy = node(1, 2, 4, 5); delete legacy.neighbor_detection; delete legacy.edge_neighbors; publish(legacy);
    checks.hallOnlyNoIdentity = state() === 'unavailable' && edges.length === 0;

    pair();
    openModal('Other modal', '<input id="neighborUnrelatedInput" value="retained">');
    const unrelatedInput = document.getElementById('neighborUnrelatedInput'); unrelatedInput.focus();
    publish(node(1, 2, 4, 5));
    refreshNeighborTopology();
    checks.otherModalPreserved = unrelatedInput === document.getElementById('neighborUnrelatedInput')
      && unrelatedInput.value === 'retained' && document.activeElement === unrelatedInput;
    viewDevice(1);
    const aged = node(1, 2, 4, 5); aged.edge_neighbors[2].age_ms = 2900; publish(aged);
    window.neighborSmoke = { pair, publish, node, claim };
    return checks;
  });
  for (const [name, passed] of Object.entries(checks)) {
    if (name === 'malformed') passed.forEach((value, index) => assert.equal(value, true, `Malformed payload case ${index} accepted`));
    else assert.equal(passed, true, `Neighbor topology check failed: ${name}`);
  }
  await page.waitForFunction(() => edges.length === 0
    && document.querySelector('[data-neighbor-side="2"]')?.dataset.neighborState === 'stale', null, { timeout: 2000 });
  await page.evaluate(() => {
    neighborSmoke.pair();
    hideLoginOverlay();
    navigateTo('overview');
    viewDevice(1);
  });
  await page.waitForFunction(() => getComputedStyle(document.getElementById('loginOverlay')).visibility === 'hidden');
  const screenshotDir = path.join(root, '.artifacts/neighbors');
  await mkdir(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, 'confirmed-neighbor.png'), fullPage: true });
  const translated = await page.evaluate(() => {
    consoleI18n.setLanguage('zh-TW');
    const chinese = document.querySelector('[data-neighbor-side="2"]').textContent.includes('已確認');
    consoleI18n.setLanguage('en');
    return chinese && document.querySelector('[data-neighbor-side="2"]').textContent.includes('Confirmed');
  });
  assert.equal(translated, true, 'Neighbor details must translate reversibly');
  assert.deepEqual(errors, []);
  console.log('Neighbor topology smoke passed: reciprocal identities, Hall states, boot/MAC matching, 27 malformed payload cases, missing hardware/data, offline/disconnect, live detail refresh and timed expiry.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
