import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

let playwright;
try {
  playwright = await import('playwright');
} catch (error) {
  if (process.platform !== 'win32') throw error;
  playwright = await import('file:///C:/Users/Jason/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
}

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
  try { browser = await playwright.chromium.launch({ headless: true }); }
  catch (error) {
    if (process.platform !== 'win32') throw error;
    browser = await playwright.chromium.launch({ channel: 'chrome', headless: true });
  }
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('https://fonts.gstatic.com/**', route => route.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}/management-console.html`);
  await page.waitForTimeout(250);
  const result = await page.evaluate(async () => {
    const packet = {
      type: 'telemetry', id: 2, q: 1, r: 0, hall_mask: 37,
      halls: [true, false, true, false, false, true], config_bits: 1,
      enabled: true, power_control_available: false,
      voltage: null, current: null, power: null, temp: null, rssi: -54,
      mac: 'AA:BB:CC:DD:EE:02', uptime: 7, seq: 4, boot_id: 100
    };
    parseHardwarePacket(JSON.stringify(packet));
    viewDevice(2);
    const initial = {
      ids: [...deviceIds], halls: [...deviceTelemetry.get(2).halls],
      voltage: formatMeasurement(deviceTelemetry.get(2), 'voltage', 2),
      power: document.querySelector('#metricCurrentOutput').textContent,
      table: document.querySelector('#deviceTableBody').textContent,
      detail: document.querySelector('#modalBody').textContent,
      logs: powerLogEntries.length, edges: edges.length,
      report: buildDailySummaryReportData().todayGeneration
    };
    const before = hardwareTxCount;
    const blocked = await sendHardwareCommand({ cmd: 'set_power', id: 2, enabled: false });
    const blockedUnsent = before === hardwareTxCount && blocked === false;
    parseHardwarePacket(JSON.stringify({ ...packet, voltage: 12.2, current: 0.5, power: 6.1, temp: 29, seq: 5 }));
    const measured = formatMeasurement(deviceTelemetry.get(2), 'voltage', 2);
    deviceTelemetry.get(2).lastReport = Date.now() - 31000;
    parseHardwarePacket(JSON.stringify({ type: 'heartbeat', uptime: 100, last_rx_ago_ms: 31000 }));
    refreshHardwareHealth();
    const freshness = {
      table: document.querySelector('#deviceTableBody').textContent,
      output: document.querySelector('#metricCurrentOutput').textContent,
      active: document.querySelector('#statActive').textContent,
      gatewayLive: document.querySelector('#baseConnBadge').classList.contains('online')
    };
    const pathTx = hardwareTxCount;
    findPath();
    const noLiveRoute = hardwareTxCount === pathTx && document.querySelector('#toast').textContent.includes('neighboring');
    parseHardwarePacket(JSON.stringify({ ...packet, seq: 6, config_bits: null }));
    const cleared = formatMeasurement(deviceTelemetry.get(2), 'voltage', 2);
    const manualConfig = deviceTelemetry.get(2).configBits;
    parseHardwarePacket(JSON.stringify({ type: 'telemetry', id: 'bad' }));
    const afterInvalid = [...deviceIds];
    parseHardwarePacket(JSON.stringify({ type: 'tx_ack', target: 2, success: false, stage: 'failed', reason: 'timeout' }));
    parseHardwarePacket(JSON.stringify({ type: 'cmd_error', msg: 'unsupported command' }));
    const errorsLogged = terminalLogs.filter(log => log.type === 'err').map(log => log.msg);
    const lastReport = deviceTelemetry.get(2).lastReport;
    parseHardwarePacket(JSON.stringify({ type: 'heartbeat', uptime: 8, last_rx_ago_ms: null }));
    const heartbeatPreservesReport = deviceTelemetry.get(2).lastReport === lastReport;
    parseHardwarePacket(JSON.stringify({ ...packet, id: 8, config_bits: 7, seq: 1 }));
    const discovered = [...deviceIds];
    setHardwareConnected(false);
    await new Promise(resolve => setTimeout(resolve, 3700));
    const retained = deviceTelemetry.get(2).source === 'live' && !hasMeasurement(deviceTelemetry.get(2), 'voltage');
    const sources = {};
    for (const key of ['gateway', 'node', 'nodeConfig', 'gatewayConfig', 'nodeProtocol', 'gatewayProtocol', 'guide']) {
      sources[key] = await loadFirmwareSource(key);
    }
    return { initial, blockedUnsent, measured, freshness, noLiveRoute, cleared, manualConfig, afterInvalid, errorsLogged, heartbeatPreservesReport, discovered, retained, sources };
  });
  assert.deepEqual(result.initial.ids, [2], 'Simulation nodes must be removed on live telemetry');
  assert.deepEqual(result.initial.halls, [true, false, true, false, false, true]);
  assert.equal(result.initial.voltage, '--');
  assert.equal(result.initial.power, '--');
  assert.match(result.initial.table, /-- V/);
  assert.match(result.initial.detail, /D0: DETECTED/);
  assert.match(result.initial.detail, /D5: DETECTED/);
  assert.equal(result.initial.logs, 0);
  assert.equal(result.initial.edges, 0, 'Contact sensors must not invent neighbor identities');
  assert.equal(result.initial.report, '--');
  assert.equal(result.blockedUnsent, true);
  assert.equal(result.measured, '12.20');
  assert.match(result.freshness.table, /STALE/);
  assert.equal(result.freshness.output, '--');
  assert.equal(result.freshness.active, '0');
  assert.equal(result.freshness.gatewayLive, true, 'A live gateway must not hide stale nodes');
  assert.equal(result.noLiveRoute, true);
  assert.equal(result.cleared, '--');
  assert.equal(result.manualConfig, null);
  assert.deepEqual(result.afterInvalid, [2]);
  assert.ok(result.errorsLogged.some(log => log.includes('timeout')));
  assert.ok(result.errorsLogged.some(log => log.includes('unsupported command')));
  assert.equal(result.heartbeatPreservesReport, true);
  assert.deepEqual(result.discovered, [2, 8]);
  assert.equal(result.retained, true, 'Disconnect must not replace measurements with simulation');
  for (const [key, contents] of Object.entries(result.sources)) assert.ok(contents.length > 100, `Firmware source missing: ${key}`);
  assert.equal(result.sources.nodeProtocol, result.sources.gatewayProtocol, 'Protocol headers must match');
  const transports = await page.evaluate(async () => {
    const wait = () => new Promise(resolve => setTimeout(resolve, 20));
    const originalSocket = window.WebSocket;
    class MockSocket {
      static OPEN = 1;
      constructor(url) { this.url = url; this.readyState = 0; this.writes = []; }
      open() { this.readyState = 1; this.onopen?.(); }
      send(line) { this.writes.push(line); }
      close() { this.readyState = 3; this.onclose?.(); }
    }
    window.WebSocket = MockSocket;
    await connectWebSocket('ws://example.test/first');
    const first = wsClient;
    first.open();
    await connectWebSocket('ws://example.test/second');
    const second = wsClient;
    second.open();
    first.onclose(); // A late event from the replaced socket must be ignored.
    const staleCloseIgnored = isHardwareConnected && wsClient === second && !wsReconnectTimer;
    const count = hardwareRxCount;
    second.onmessage({ data: '{"type":"heartbeat","uptime":1}\n{"type":"heartbeat","uptime":2}\n' });
    const ndjson = hardwareRxCount === count + 2;
    second.onmessage({ data: 'x'.repeat(5000) });
    const wsBounded = hardwareRxCount === count + 2 && terminalLogs.some(log => log.msg.includes('Oversized WebSocket line'));
    second.close();
    const scheduled = !!wsReconnectTimer;
    disconnectWebSocket();
    const cancelled = !wsReconnectTimer;
    window.WebSocket = originalSocket;

    let controller;
    let closeUnlocked = false;
    const writes = [];
    const port = {
      readable: new ReadableStream({ start(value) { controller = value; } }),
      writable: new WritableStream({ write(value) { writes.push(new TextDecoder().decode(value)); } }),
      async close() { closeUnlocked = !this.readable.locked && !this.writable.locked; }
    };
    serialPort = port;
    serialWriter = port.writable.getWriter();
    serialKeepReading = true;
    serialReadTask = readSerialLoop(port);
    const frame = JSON.stringify({ type: 'telemetry', id: 3, hall_mask: 2, config_bits: null, enabled: true, power_control_available: false });
    const encode = value => new TextEncoder().encode(value);
    controller.enqueue(encode('x'.repeat(5000) + frame + '\n' + frame.slice(0, 23)));
    controller.enqueue(encode(frame.slice(23) + '\r\n'));
    await wait();
    const framed = deviceTelemetry.get(3)?.hallMask === 2;
    const oversized = terminalLogs.some(log => log.msg.includes('Oversized serial line'));
    const sent = await sendHardwareCommand({ cmd: 'ping' });
    await disconnectSerial();
    const released = closeUnlocked && serialPort === null && serialWriter === null && serialReader === null;
    const disconnectedSend = await sendHardwareCommand({ cmd: 'ping' });

    let errorController;
    const errorPort = {
      readable: new ReadableStream({ start(value) { errorController = value; } }),
      writable: new WritableStream(), async close() {}
    };
    serialPort = errorPort;
    serialWriter = errorPort.writable.getWriter();
    serialKeepReading = true;
    setHardwareConnected(true, 'Mock serial');
    serialReadTask = readSerialLoop(errorPort);
    errorController.error(new Error('USB unplugged'));
    await serialReadTask;
    const errorCleared = serialPort === null && serialReader === null && serialWriter === null && !isHardwareConnected;
    return { staleCloseIgnored, ndjson, wsBounded, scheduled, cancelled, framed, oversized, sent, disconnectedSend, writes, released, errorCleared };
  });
  for (const key of ['staleCloseIgnored', 'ndjson', 'wsBounded', 'scheduled', 'cancelled', 'framed', 'oversized', 'sent', 'released', 'errorCleared']) {
    assert.equal(transports[key], true, `Transport check failed: ${key}`);
  }
  assert.equal(transports.disconnectedSend, false);
  assert.deepEqual(transports.writes, ['{"cmd":"ping"}\n']);
  assert.deepEqual(errors, []);
  console.log('Hardware protocol smoke passed: Hall mapping, missing values, discovery, command errors, firmware sources, serial framing/cleanup and WebSocket ownership.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
