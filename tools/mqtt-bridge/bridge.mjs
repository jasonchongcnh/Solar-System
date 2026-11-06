import mqtt from 'mqtt';
import { WebSocketServer, WebSocket } from 'ws';
import { pathToFileURL } from 'node:url';

export function createBridge({ broker = 'mqtt://127.0.0.1:1883', host = '127.0.0.1', port = 8081,
  root = 'hexagon/v1', gateway = 'uno-r4', username, password, origins = [] } = {}) {
  if (!/^[a-zA-Z0-9_-]+$/.test(gateway) || /[+#]/.test(root)) throw new Error('Invalid MQTT topic configuration');
  const base = `${root}/gateways/${gateway}`;
  const client = mqtt.connect(broker, { username, password, clean: true, reconnectPeriod: 2000,
    connectTimeout: 5000, queueQoSZero: false, resubscribe: true });
  let subscribed = false;
  const server = new WebSocketServer({ host, port, maxPayload: 512,
    verifyClient: ({ origin }) => !origin || origins.includes(origin) });
  const send = (socket, value) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > 65536) { socket.close(1013, 'Slow client'); return; }
    socket.send(typeof value === 'string' ? value : JSON.stringify(value));
  };
  const report = code => { for (const socket of server.clients) send(socket, { type: 'error', code, msg: code }); };
  client.on('connect', () => client.subscribe(`${base}/events`, { qos: 0 }, (error, granted) => {
    subscribed = !error && granted?.every(item => item.qos !== 128);
    if (!subscribed) report('mqtt_subscribe_failed');
  }));
  client.on('offline', () => { subscribed = false; report('mqtt_offline'); });
  client.on('close', () => { subscribed = false; });
  client.on('error', () => report('mqtt_connection_error'));
  client.on('message', (topic, payload, packet) => {
    if (topic !== `${base}/events` || packet.retain || payload.length > 2048) return;
    try {
      const doc = JSON.parse(payload.toString());
      if (!doc || Array.isArray(doc) || typeof doc.type !== 'string') return;
      for (const socket of server.clients) send(socket, JSON.stringify(doc));
    } catch { /* Invalid events are never forwarded into the console. */ }
  });
  server.on('connection', socket => socket.on('message', (data, binary) => {
    if (binary) { socket.close(1003, 'JSON text required'); return; }
    let doc;
    try { doc = JSON.parse(data.toString()); } catch { send(socket, { type: 'error', code: 'invalid_json' }); return; }
    if (!doc || Array.isArray(doc) || !['ping', 'request_telemetry', 'set_power', 'all_power'].includes(doc.cmd)) {
      send(socket, { type: 'error', code: 'unsupported_command' }); return;
    }
    if (!client.connected || !subscribed) { send(socket, { type: 'error', code: 'mqtt_offline' }); return; }
    // QoS 0 + no offline queue: never replay an old browser command after reconnect.
    client.publish(`${base}/command`, JSON.stringify(doc), { qos: 0, retain: false }, error => {
      if (error) send(socket, { type: 'error', code: 'mqtt_publish_failed' });
    });
  }));
  return { server, client, close: async () => {
    for (const socket of server.clients) socket.terminate();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => client.end(true, resolve))]);
  } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const origins = (process.env.WS_ORIGINS || 'http://localhost:8000,http://127.0.0.1:8000').split(',').filter(Boolean);
  const bridge = createBridge({ broker: process.env.MQTT_URL, host: process.env.WS_HOST || '127.0.0.1',
    port: Number(process.env.WS_PORT || 8081), root: process.env.MQTT_ROOT || 'hexagon/v1',
    gateway: process.env.MQTT_GATEWAY || 'uno-r4', username: process.env.MQTT_USER,
    password: process.env.MQTT_PASSWORD, origins });
  bridge.server.on('listening', () => console.log('Console bridge listening:', bridge.server.address()));
  bridge.server.on('error', error => { console.error(error.message); process.exitCode = 1; bridge.client.end(true); });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => bridge.close());
}
