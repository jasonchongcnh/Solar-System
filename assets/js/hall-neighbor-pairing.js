(function (root) {
  'use strict';
  const uint32 = value => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
  const validId = value => Number.isInteger(value) && value >= 1 && value <= 8;
  const validSide = value => Number.isInteger(value) && value >= 0 && value < 6;
  const newer = (value, previous) => ((value - previous) | 0) > 0;
  function mac(value) {
    if (typeof value !== 'string' || !/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(value)) return null;
    const result = value.toUpperCase();
    return result !== '00:00:00:00:00:00' && result !== 'FF:FF:FF:FF:FF:FF' && !(parseInt(result.slice(0, 2), 16) & 1) ? result : null;
  }
  const endpointKey = endpoint => `${endpoint.id}:${endpoint.side}`;
  const modulePair = (a, b) => [a.id, b.id].sort((x, y) => x - y).join(':');
  const copyEndpoint = endpoint => ({ id: endpoint.id, side: endpoint.side, mac: endpoint.mac });
  function endpoint(value) {
    if (!value || !validId(value.id) || !validSide(value.side)) return null;
    const address = mac(value.mac);
    return address ? { id: value.id, side: value.side, mac: address } : null;
  }
  function create(options = {}) {
    const freshMs = Number.isFinite(options.freshMs) && options.freshMs > 0 ? options.freshMs : 3000;
    const settleMs = Number.isFinite(options.settleMs) && options.settleMs >= 0 ? options.settleMs : 1500;
    const sessionMs = Number.isFinite(options.sessionMs) && options.sessionMs > 0 ? options.sessionMs : 60000;
    const records = new Map(), links = [], used = new Set(), pairs = new Set();
    let connected = false, connectionEpoch = 0, serial = 0, session = { state: 'idle', reason: '', endpoints: null };
    function addStored(a, b) {
      if (!a || !b || a.id === b.id || a.mac === b.mac || used.has(endpointKey(a)) || used.has(endpointKey(b)) || pairs.has(modulePair(a, b))) return null;
      for (const link of links) for (const known of [link.a, link.b]) for (const point of [a, b]) {
        if ((known.id === point.id && known.mac !== point.mac) || (known.mac === point.mac && known.id !== point.id)) return null;
      }
      if (a.id > b.id) [a, b] = [b, a];
      const link = { id: `hall-pair-${++serial}`, a: copyEndpoint(a), b: copyEndpoint(b), active: false, reason: 'confirmation_required', boots: null };
      links.push(link); used.add(endpointKey(a)); used.add(endpointKey(b)); pairs.add(modulePair(a, b));
      return link;
    }
    if (Array.isArray(options.savedLinks)) for (const value of options.savedLinks) {
      if (value && typeof value === 'object') addStored(endpoint(value.a), endpoint(value.b));
    }
    function fresh(record, now) {
      return !!record && record.present && record.online && record.epoch === connectionEpoch && record.receivedAt <= now && now - record.receivedAt < freshMs;
    }
    function fail(reason) {
      session = { state: 'error', reason, endpoints: null };
    }
    function linkProblem(link, now, checkBoots) {
      if (!connected) return 'gateway_disconnected';
      for (const [index, point] of [link.a, link.b].entries()) {
        const record = records.get(point.id);
        if (!record || !record.present || !record.online) return 'node_unavailable';
        if (record.mac !== point.mac) return 'module_identity_changed';
        if (checkBoots && link.boots && record.bootId !== link.boots[index]) return 'node_restarted';
        if (!fresh(record, now)) return 'telemetry_stale';
        if (!(record.hallMask & (1 << point.side))) return 'hall_cleared';
      }
      return '';
    }
    function refreshLinks(now) {
      for (const link of links) if (link.active) {
        const problem = linkProblem(link, now, true);
        if (problem) { link.active = false; link.reason = problem; }
      }
    }
    function refreshSession(now) {
      if (session.state !== 'waiting' && session.state !== 'candidate') return;
      if (!connected) { fail('gateway_disconnected'); return; }
      if (now - session.startedAt >= sessionMs || now < session.startedAt) { fail('pairing_session_expired'); return; }
      for (const [id, record] of records) {
        if (fresh(record, now) && !session.baseline.has(id)) { fail('unexpected_node'); return; }
      }
      for (const [id, baseline] of session.baseline) {
        const record = records.get(id);
        if (!record || !record.present || !record.online) { fail('node_unavailable'); return; }
        if (record.mac !== baseline.mac) { fail('module_identity_changed'); return; }
        if (record.bootId !== baseline.bootId) { fail('node_restarted'); return; }
        if (!fresh(record, now)) { fail('telemetry_stale'); return; }
        if (baseline.lastMask & ~record.hallMask) { fail('hall_cleared'); return; }
        const rising = record.hallMask & ~baseline.lastMask;
        if (rising) {
          session.lastChangeAt = now;
          for (let side = 0; side < 6; ++side) if (rising & (1 << side)) {
            session.rises.set(`${id}:${side}`, { id, side, mac: record.mac, bootId: record.bootId });
          }
        }
        baseline.lastMask = record.hallMask;
      }
      const points = [...session.rises.values()];
      if (points.length > 2) { fail('too_many_edges'); return; }
      if (points.length < 2) { session.state = 'waiting'; session.reason = 'waiting_for_two_edges'; session.endpoints = null; return; }
      if (points[0].id === points[1].id) { fail('same_module_edges'); return; }
      if (points.some(point => used.has(endpointKey(point)))) { fail('edge_already_paired'); return; }
      if (pairs.has(modulePair(points[0], points[1]))) { fail('modules_already_paired'); return; }
      if (now - session.lastChangeAt < settleMs) { session.state = 'waiting'; session.reason = 'settling'; session.endpoints = null; return; }
      session.state = 'candidate'; session.reason = 'awaiting_confirmation'; session.endpoints = points;
    }
    function refresh(now) { refreshLinks(now); refreshSession(now); }
    function update(input, isConnected, now = Date.now()) {
      // A new packet cannot erase an already elapsed observation gap. Revoke
      // confidence against the previous samples before accepting replacements.
      refresh(now);
      const nextConnection = isConnected === true;
      if (nextConnection !== connected) ++connectionEpoch;
      connected = nextConnection;
      for (const record of records.values()) { record.present = false; record.online = false; }
      const seen = new Set();
      for (const value of Array.isArray(input) ? input : []) {
        if (!value || !validId(value.id)) continue;
        let previous = records.get(value.id);
        if (seen.has(value.id)) {
          if (previous) { previous.present = true; previous.online = false; }
          continue;
        }
        seen.add(value.id);
        const live = value.source === 'live' && value.status === 'online' && value.pairingEligible !== false;
        if (previous) { previous.present = true; previous.online = live; }
        if (!live) continue;
        const address = mac(value.mac);
        // An exact/older identity sequence is ignored as a whole: it cannot
        // change Hall state or extend the accepted sample's receipt time.
        if (previous && address === previous.mac && value.bootId === previous.bootId &&
            uint32(value.sequence) && !newer(value.sequence, previous.sequence)) continue;
        if (!address || !uint32(value.bootId) || !value.bootId || !uint32(value.sequence) ||
            !Number.isInteger(value.hallMask) || value.hallMask < 0 || value.hallMask > 63 ||
            !Number.isFinite(value.lastReport) || value.lastReport < 0 || value.lastReport > now || now - value.lastReport >= freshMs) {
          if (previous) previous.online = false;
          continue;
        }
        const identity = `${address}/${value.bootId}`;
        const retired = previous ? previous.retired : new Set();
        if (previous && previous.identity === identity && !newer(value.sequence, previous.sequence)) continue;
        if (retired.has(identity)) continue;
        if (previous && previous.identity !== identity) retired.add(previous.identity);
        records.set(value.id, {
          id: value.id, mac: address, bootId: value.bootId, sequence: value.sequence,
          hallMask: value.hallMask, receivedAt: value.lastReport, present: true, online: true, identity, retired, epoch: connectionEpoch
        });
      }
      // IDs are configured labels. The same physical radio MAC appearing under
      // two fresh IDs cannot supply two independent pairing endpoints.
      const aliases = new Set(), addresses = new Map();
      for (const [id, record] of records) if (fresh(record, now)) {
        if (addresses.has(record.mac)) { aliases.add(id); aliases.add(addresses.get(record.mac)); }
        else addresses.set(record.mac, id);
      }
      for (const id of aliases) records.get(id).online = false;
      refresh(now);
      return getSession(now);
    }
    function start(input, isConnected, now = Date.now()) {
      update(input, isConnected, now);
      if (session.state === 'waiting' || session.state === 'candidate') return { ok: false, reason: 'pairing_in_progress' };
      if (!connected) return { ok: false, reason: 'gateway_disconnected' };
      const baseline = new Map();
      for (const [id, record] of records) if (fresh(record, now)) baseline.set(id, {
        mac: record.mac, bootId: record.bootId, lastMask: record.hallMask
      });
      if (baseline.size < 2) return { ok: false, reason: 'need_two_live_modules' };
      session = { state: 'waiting', reason: 'waiting_for_two_edges', endpoints: null, startedAt: now, lastChangeAt: now, baseline, rises: new Map() };
      return { ok: true, reason: 'waiting_for_two_edges' };
    }
    function getSession(now = Date.now()) {
      refresh(now);
      return { state: session.state, reason: session.reason, endpoints: session.endpoints ? session.endpoints.map(point => ({ ...point })) : null };
    }
    function publicLink(link) {
      return { id: link.id, a: copyEndpoint(link.a), b: copyEndpoint(link.b), active: link.active, reason: link.reason };
    }
    function confirm(now = Date.now()) {
      refresh(now);
      if (session.state !== 'candidate') return { ok: false, reason: session.reason || 'not_ready' };
      const [a, b] = session.endpoints;
      const link = addStored(a, b);
      if (!link) { fail('edge_already_paired'); return { ok: false, reason: session.reason }; }
      link.active = true; link.reason = ''; link.boots = [records.get(link.a.id).bootId, records.get(link.b.id).bootId];
      session = { state: 'idle', reason: '', endpoints: null };
      return { ok: true, reason: '', link: publicLink(link) };
    }
    function getLinks(now = Date.now()) { refresh(now); return links.map(publicLink); }
    function getSide(id, side, now = Date.now()) {
      refresh(now);
      const link = links.find(value => (value.a.id === id && value.a.side === side) || (value.b.id === id && value.b.side === side));
      if (!link) return null;
      const other = link.a.id === id && link.a.side === side ? link.b : link.a;
      return { kind: link.active ? 'paired' : 'pairing_required', neighbor: { id: other.id, side: other.side }, linkId: link.id };
    }
    function reconfirm(linkId, now = Date.now()) {
      refresh(now);
      const link = links.find(value => value.id === linkId);
      if (!link) return { ok: false, reason: 'link_not_found' };
      const problem = linkProblem(link, now, false);
      if (problem) return { ok: false, reason: problem };
      link.boots = [records.get(link.a.id).bootId, records.get(link.b.id).bootId]; link.active = true; link.reason = '';
      return { ok: true, reason: '', link: publicLink(link) };
    }
    function remove(linkId) {
      const index = links.findIndex(value => value.id === linkId);
      if (index < 0) return { ok: false, reason: 'link_not_found' };
      const [link] = links.splice(index, 1);
      used.delete(endpointKey(link.a)); used.delete(endpointKey(link.b)); pairs.delete(modulePair(link.a, link.b));
      return { ok: true, reason: '' };
    }
    return {
      update, start, getSession, confirm, getLinks, getSide, reconfirm, remove,
      cancel() { session = { state: 'idle', reason: '', endpoints: null }; },
      exportSavedLinks() { return links.map(link => ({ a: copyEndpoint(link.a), b: copyEndpoint(link.b) })); }
    };
  }
  root.HallNeighborPairing = Object.freeze({ create });
})(globalThis);
