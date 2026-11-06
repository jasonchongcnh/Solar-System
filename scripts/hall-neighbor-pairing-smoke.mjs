import assert from 'node:assert/strict';
import '../assets/js/hall-neighbor-pairing.js';

let checks = 0;
function check(value, expected, description) { ++checks; assert.deepEqual(value, expected, description); }
const address = id => `02:00:00:00:00:${String(id).padStart(2, '0')}`;
const record = (id, hallMask = 0, sequence = 1, lastReport = 1000, extra = {}) => ({
  id, source: 'live', status: 'online', mac: address(id), bootId: 100 + id, sequence, hallMask, lastReport, ...extra
});
function fixture(options = {}) {
  const engine = globalThis.HallNeighborPairing.create(options);
  const baseline = [record(1), record(2), record(3)];
  check(engine.start(baseline, true, 1000).ok, true, 'fresh live modules can start operator pairing');
  return { engine, baseline };
}
function rising(engine, at = 1100, extras = []) {
  const readings = [record(1, 1, 2, at), record(2, 8, 2, at), record(3, 0, 2, at), ...extras];
  engine.update(readings, true, at);
  return readings;
}
function pairedFixture() {
  const { engine } = fixture(); const readings = rising(engine);
  check(engine.getSession(2599).state, 'waiting', 'two rising edges must remain stable for full settle time');
  check(engine.getSession(2600).state, 'candidate', 'exactly two distinct modules form a candidate');
  check(engine.getLinks(2600).length, 0, 'candidate never creates a link without explicit confirmation');
  const confirmation = engine.confirm(2600);
  check(confirmation.ok, true, 'explicit operator confirmation creates the pair');
  return { engine, readings, link: confirmation.link };
}
{
  const { engine, link } = pairedFixture();
  check(engine.getSide(1, 0, 2601), { kind: 'paired', neighbor: { id: 2, side: 3 }, linkId: link.id }, 'paired side points to the operator-selected remote edge');
  check(engine.getSide(2, 3, 2601).neighbor, { id: 1, side: 0 }, 'mapping is reciprocal');
  check(engine.getSide(1, 1, 2601), null, 'unmapped sides have no invented identity');
  const saved = engine.exportSavedLinks();
  check(saved, [{ a: { id: 1, side: 0, mac: address(1) }, b: { id: 2, side: 3, mac: address(2) } }], 'saved map contains only explicit endpoint identity');
  const reload = globalThis.HallNeighborPairing.create({ savedLinks: saved });
  reload.update([record(1, 1, 4, 2700), record(2, 8, 4, 2700)], true, 2700);
  check(reload.getLinks(2700)[0].active, false, 'reloaded mapping is never automatically active');
  check(reload.getSide(1, 0, 2700).kind, 'pairing_required', 'saved mapping asks for explicit confirmation');
  check(reload.reconfirm(reload.getLinks(2700)[0].id, 2700).ok, true, 'saved map can be explicitly confirmed with matching fresh Hall states');
}
for (const [description, readings, expected] of [
  ['two rising edges on one module', [record(1, 3, 2, 1100), record(2, 0, 2, 1100), record(3, 0, 2, 1100)], 'same_module_edges'],
  ['three simultaneous rising edges', [record(1, 1, 2, 1100), record(2, 8, 2, 1100), record(3, 1, 2, 1100)], 'too_many_edges'],
  ['unexpected live node joins', [record(1, 1, 2, 1100), record(2, 8, 2, 1100), record(3, 0, 2, 1100), record(4, 0, 1, 1100)], 'unexpected_node'],
  ['baseline module reboots', [record(1, 1, 2, 1100, { bootId: 999 }), record(2, 8, 2, 1100), record(3, 0, 2, 1100)], 'node_restarted'],
  ['baseline module changes MAC', [record(1, 1, 2, 1100, { mac: address(8) }), record(2, 8, 2, 1100), record(3, 0, 2, 1100)], 'module_identity_changed'],
  ['baseline module becomes offline', [record(1, 1, 2, 1100), record(2, 8, 2, 1100, { status: 'offline' }), record(3, 0, 2, 1100)], 'node_unavailable'],
  ['baseline module disappears', [record(1, 1, 2, 1100), record(2, 8, 2, 1100)], 'node_unavailable'],
]) {
  const { engine } = fixture(); engine.update(readings, true, 1100);
  check(engine.getSession(2600).reason, expected, description);
  check(engine.confirm(2600).ok, false, `${description} cannot be confirmed`);
}
{
  const { engine } = fixture(); rising(engine); check(engine.getSession(2600).state, 'candidate', 'candidate is ready before extra change');
  engine.update([record(1, 1, 3, 2700), record(2, 8, 3, 2700), record(3, 1, 3, 2700)], true, 2700);
  check(engine.getSession(2700).reason, 'too_many_edges', 'a third rise after candidate formation invalidates it');
  check(engine.confirm(2700).ok, false, 'third-edge candidate cannot be explicitly confirmed');
}
{
  const { engine } = fixture(); const readings = rising(engine);
  engine.update([record(1, 0, 1, 2000), record(2, 0, 1, 2000), record(3, 63, 1, 2000)], true, 2000);
  check(engine.getSession(2600).state, 'candidate', 'out-of-order packets cannot replace accepted Hall states');
  const replay = readings.map(value => ({ ...value, lastReport: 4000 })); engine.update(replay, true, 4000);
  check(engine.getSession(4100).reason, 'telemetry_stale', 'duplicate sequence cannot extend telemetry freshness');
  check(engine.confirm(4100).ok, false, 'stale observations cannot support confirmation');
}
{
  const { engine } = fixture(); rising(engine);
  engine.update([record(1, 0, 3, 1200), record(2, 8, 3, 1200), record(3, 0, 3, 1200)], true, 1200);
  check(engine.getSession(2600).reason, 'hall_cleared', 'a rising edge that clears during settling invalidates pairing');
}
{
  const engine = globalThis.HallNeighborPairing.create({ sessionMs: 1700 });
  engine.start([record(1), record(2)], true, 1000);
  engine.update([record(1, 1, 2, 1100), record(2, 8, 2, 1100)], true, 1100);
  check(engine.getSession(2600).state, 'candidate', 'session can form a candidate within its deadline');
  check(engine.getSession(2700).reason, 'pairing_session_expired', 'candidate expires at the session deadline');
}
for (const [description, bad] of [
  ['future timestamp', { lastReport: 1001 }], ['stale timestamp', { lastReport: 0 }],
  ['missing sequence', { sequence: undefined }], ['missing boot ID', { bootId: undefined }],
  ['zero boot ID', { bootId: 0 }], ['bad MAC', { mac: 'FF:FF:FF:FF:FF:FF' }],
  ['simulation source', { source: 'simulation' }], ['explicit demo exclusion', { pairingEligible: false }],
  ['bad mask', { hallMask: 64 }], ['invalid node ID', { id: 9 }]
]) {
  const engine = globalThis.HallNeighborPairing.create({ freshMs: 1000 });
  check(engine.start([record(1), record(2, 0, 1, 1000, bad)], true, 1000).ok, false, `${description} cannot establish a baseline`);
}
{
  const point = (id, side) => ({ id, side, mac: address(id) });
  const engine = globalThis.HallNeighborPairing.create({ savedLinks: [
    null, {}, { a: point(1, 0), b: point(1, 1) },
    { a: point(1, 0), b: point(2, 3) },
    { a: point(1, 0), b: point(3, 4) },
    { a: point(1, 1), b: point(2, 4) },
    { a: point(3, 0), b: point(4, 3) },
    { a: point(3, 8), b: point(5, 1) }
  ] });
  check(engine.getLinks(1000).length, 2, 'invalid, same-node, repeated-endpoint and repeated-module-pair saved entries are discarded');
  check(engine.getLinks(1000).every(link => !link.active), true, 'every valid loaded mapping starts unconfirmed');
}
for (const [description, change, reason] of [
  ['detach', values => values.map(value => value.id === 1 ? { ...value, hallMask: 0 } : value), 'hall_cleared'],
  ['reboot', values => values.map(value => value.id === 1 ? { ...value, bootId: 999 } : value), 'node_restarted'],
  ['MAC replacement', values => values.map(value => value.id === 1 ? { ...value, mac: address(8) } : value), 'module_identity_changed'],
  ['offline', values => values.map(value => value.id === 1 ? { ...value, status: 'offline' } : value), 'node_unavailable']
]) {
  const { engine, link } = pairedFixture();
  const next = [record(1, 1, 3, 2700), record(2, 8, 3, 2700), record(3, 0, 3, 2700)];
  engine.update(change(next), true, 2700);
  check(engine.getLinks(2700)[0].reason, reason, `${description} revokes confidence`);
  engine.update([record(1, 1, 4, 2800), record(2, 8, 4, 2800), record(3, 0, 4, 2800)], true, 2800);
  check(engine.getLinks(2800)[0].active, false, `${description} cannot restore confidence by returning to an active mask`);
  if (description !== 'MAC replacement' && description !== 'reboot') check(engine.reconfirm(link.id, 2800).ok, true, 'explicit user reconfirm can restore matching fresh endpoints');
}
for (const extra of [{ hallMask: undefined }, { hallMask: 64 }, { mac: 'invalid' }, { pairingEligible: false }]) {
  const { engine } = pairedFixture();
  engine.update([record(1, 1, 3, 2700, extra), record(2, 8, 3, 2700)], true, 2700);
  check(engine.getLinks(2700)[0].active, false, 'malformed new telemetry immediately revokes prior Hall confidence');
  engine.update([record(1, 1, 4, 2800), record(2, 8, 4, 2800)], true, 2800);
  check(engine.getLinks(2800)[0].active, false, 'fresh valid data cannot undo malformed-snapshot invalidation');
}
{
  const { engine } = pairedFixture();
  engine.update([record(1, 1, 3, 6000), record(2, 8, 3, 6000)], true, 6000);
  check(engine.getLinks(6000)[0].active, false, 'a new snapshot cannot hide an unobserved stale gap between updates');
  const pending = fixture().engine; rising(pending);
  pending.update([record(1, 1, 3, 6000), record(2, 8, 3, 6000), record(3, 0, 3, 6000)], true, 6000);
  check(pending.getSession(6000).reason, 'telemetry_stale', 'new data after a stale gap cannot repair an interrupted pairing session');
}
{
  const saved = [{ a: { id: 1, side: 0, mac: address(1) }, b: { id: 2, side: 3, mac: address(1) } }];
  const engine = globalThis.HallNeighborPairing.create({ savedLinks: saved });
  check(engine.exportSavedLinks().length, 0, 'saved endpoints cannot pair two IDs of one physical MAC');
  check(engine.start([record(1), record(2, 0, 1, 1000, { mac: address(1) })], true, 1000).ok,
    false, 'one physical MAC under two IDs cannot establish two live modules');
  const valid = pairedFixture().engine;
  valid.update([record(1, 1, 3, 2700), record(2, 8, 3, 2700), record(3, 0, 3, 2700, { mac: address(1) })], true, 2700);
  check(valid.getLinks(2700)[0].active, false, 'a new ID alias of a paired physical MAC revokes its confidence');
}
{
  const { engine, readings, link } = pairedFixture();
  engine.update(readings, false, 2700); check(engine.getLinks(2700)[0].reason, 'gateway_disconnected', 'disconnect revokes confidence');
  engine.update(readings, true, 2800);
  check(engine.reconfirm(link.id, 2800).ok, false, 'reconnect requires fresh post-reconnect telemetry, not cached packets');
  engine.update([record(1, 1, 3, 2900), record(2, 8, 3, 2900)], true, 2900);
  check(engine.getLinks(2900)[0].active, false, 'fresh reconnect observations still require explicit reconfirm');
  check(engine.reconfirm(link.id, 2900).ok, true, 'explicit reconfirm after fresh reconnect restores the mapping');
  check(engine.getLinks(5900)[0].active, false, 'a confirmed mapping expires after three seconds without fresh packets');
  engine.update([record(1, 1, 4, 6000), record(2, 8, 4, 6000)], true, 6000);
  check(engine.getLinks(6000)[0].active, false, 'fresh packets cannot undo sticky stale invalidation');
}
{
  const { engine, link } = pairedFixture();
  engine.update([record(1, 1, 3, 2700), record(2, 8, 3, 2700), record(3, 0, 3, 2700)], true, 2700);
  check(engine.start([record(1, 1, 3, 2700), record(2, 8, 3, 2700), record(3, 0, 3, 2700)], true, 2700).ok, true, 'another pairing session can begin with an existing map');
  engine.update([record(1, 3, 4, 2800), record(2, 24, 4, 2800), record(3, 0, 4, 2800)], true, 2800);
  check(engine.getSession(4300).reason, 'modules_already_paired', 'one physical module pair cannot acquire multiple edge mappings');
  engine.cancel(); check(engine.getSession(4300).state, 'idle', 'operator cancellation resets the session');
  check(engine.remove(link.id).ok, true, 'operator can remove an old mapping');
  check(engine.getSide(1, 0, 4300), null, 'removing a mapping frees both endpoints');
  check(engine.exportSavedLinks().length, 0, 'removed mappings are not persisted');
  check(engine.remove(link.id).ok, false, 'removing an unknown link fails clearly');
}
{
  const { engine, link: first } = pairedFixture();
  const baseline = [record(1, 1, 3, 2700), record(2, 8, 3, 2700), record(3, 0, 3, 2700)];
  check(engine.start(baseline, true, 2700).ok, true, 'a mapped module can pair another free edge with a different module');
  engine.update([record(1, 3, 4, 2800), record(2, 8, 4, 2800), record(3, 16, 4, 2800)], true, 2800);
  const second = engine.confirm(4300);
  check(second.ok, true, 'distinct physical module pairs can share a node on different free edges');
  check(engine.getLinks(4300).filter(link => link.active).length, 2, 'multiple explicitly confirmed links retain independent confidence');
  engine.remove(first.id);
  check(engine.getSide(1, 0, 4300), null, 'removing first link frees its edge');
  check(engine.getSide(1, 1, 4300).neighbor.id, 3, 'removing one link leaves the other edge mapping intact');
}
{
  const { engine, link } = pairedFixture();
  engine.update([record(1, 0, 3, 2700), record(2, 8, 3, 2700), record(3, 0, 3, 2700)], true, 2700);
  engine.start([record(1, 0, 3, 2700), record(2, 8, 3, 2700), record(3, 0, 3, 2700)], true, 2700);
  engine.update([record(1, 1, 4, 2800), record(2, 8, 4, 2800), record(3, 16, 4, 2800)], true, 2800);
  check(engine.getSession(4300).reason, 'edge_already_paired', 'an old mapping must be removed before its edge can pair with another node');
  check(engine.remove(link.id).ok, true, 'operator can explicitly free a conflicting saved edge');
}
{
  const { engine, link } = pairedFixture();
  engine.update([record(1, 1, 1, 2700, { bootId: 999 }), record(2, 8, 3, 2700)], true, 2700);
  check(engine.getLinks(2700)[0].active, false, 'new boot ID invalidates existing confidence');
  engine.update([record(1, 1, 2, 2800, { bootId: 999 }), record(2, 8, 4, 2800)], true, 2800);
  check(engine.reconfirm(link.id, 2800).ok, true, 'operator can bind the saved mapping to a fresh rebooted module');
  engine.update([record(1, 0, 999, 2900), record(2, 8, 5, 2900)], true, 2900);
  check(engine.getLinks(2900)[0].active, true, 'a retired boot replay cannot change the currently confirmed module state');
}
console.log(`Guided Hall neighbor pairing passed: ${checks} checks`);
