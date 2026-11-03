import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import mqtt from 'mqtt';
import { WebSocket } from 'ws';
import { createBridge } from './bridge.mjs';

// Exercise the real MQTT.js TCP client and WebSocket server against a tiny
// MQTT 3.1.1 fixture, not the firmware or a substitute for Mosquitto hardware QA.
test('gateway events, browser commands, retained rejection and offline failure', async () => {
  const sockets = new Set(); const publishes = []; let gatewayPeer;
  const packet = (header, payload) => {
    const size = []; let n = payload.length;
    do { let byte = n % 128; n = Math.floor(n / 128); if (n) byte |= 128; size.push(byte); } while (n);
    return Buffer.concat([Buffer.from([header, ...size]), payload]);
  };
  const text = value => { const b = Buffer.from(value); const h = Buffer.alloc(2); h.writeUInt16BE(b.length); return Buffer.concat([h, b]); };
  const broker = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    let input = Buffer.alloc(0);
    socket.on('data', data => {
      input = Buffer.concat([input, data]);
      while (input.length >= 2) {
        let n = 0, multiplier = 1, offset = 1, byte;
        do { if (offset >= input.length) return; byte = input[offset++]; n += (byte & 127) * multiplier; multiplier *= 128; } while (byte & 128);
        if (input.length < offset + n) return;
        const header = input[0], body = input.subarray(offset, offset+n); input = input.subarray(offset+n);
        if (header >> 4 === 1) socket.write(Buffer.from([0x20,2,0,0]));
        if (header >> 4 === 8) { gatewayPeer = socket; socket.write(Buffer.from([0x90,3,body[0],body[1],0])); }
        if (header >> 4 === 3) { const length = body.readUInt16BE(); publishes.push({ header, topic: body.subarray(2,2+length).toString(), payload: body.subarray(2+length).toString() }); }
        if (header >> 4 === 12) socket.write(Buffer.from([0xd0,0]));
      }
    });
  });
  broker.listen(0, '127.0.0.1'); await once(broker, 'listening');
  const bridge = createBridge({ broker: `mqtt://127.0.0.1:${broker.address().port}`, port: 0 });
  await once(bridge.server, 'listening');
  const ws = new WebSocket(`ws://127.0.0.1:${bridge.server.address().port}`); await once(ws, 'open');
  const waitFor = async predicate => { const end = Date.now()+3000; while (!predicate()) { if (Date.now()>end) throw new Error('timeout'); await new Promise(r => setTimeout(r,10)); } };
  try {
    await waitFor(() => gatewayPeer);
    const topic = 'hexagon/v1/gateways/uno-r4/events';
    let received = []; ws.on('message', value => received.push(JSON.parse(value)));
    gatewayPeer.write(packet(0x31, Buffer.concat([text(topic), Buffer.from('{"type":"telemetry","id":8}')] )));
    gatewayPeer.write(packet(0x30, Buffer.concat([text(topic), Buffer.from('{"type":"telemetry","id":1,"hall_mask":5}')] )));
    await waitFor(() => received.length);
    assert.equal(received.length,1); assert.equal(received[0].id,1);
    ws.send('{"cmd":"request_telemetry","id":1}');
    await waitFor(() => publishes.length);
    assert.equal(publishes[0].topic,'hexagon/v1/gateways/uno-r4/command');
    assert.equal(publishes[0].header & 7,0); assert.equal(JSON.parse(publishes[0].payload).id,1);
    ws.send('{"cmd":"set_path"}'); await waitFor(() => received.some(x => x.code === 'unsupported_command'));
    bridge.client.end(true); await once(bridge.client,'end');
    ws.send('{"cmd":"all_power","enabled":true}'); await waitFor(() => received.some(x => x.code === 'mqtt_offline'));
    assert.equal(publishes.length,1);
  } finally {
    ws.terminate(); await bridge.close(); for (const socket of sockets) socket.destroy(); await new Promise(r => broker.close(r));
  }
});
