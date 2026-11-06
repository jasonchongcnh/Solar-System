import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import '../assets/js/array-path.js';

const solve = globalThis.findMaximumModulePath;
assert.equal(typeof solve, 'function', 'The maximum-module path solver must be available');

const modules = ids => ids.map(id => ({ id, enabled: true }));
const edges = pairs => pairs.map(([hexId1, hexId2]) => ({ hexId1, hexId2 }));

function enabledGraph(moduleList, edgeList) {
  const adjacency = new Map(moduleList.filter(module => module.enabled).map(module => [module.id, new Set()]));
  for (const { hexId1, hexId2 } of edgeList) {
    if (hexId1 === hexId2 || !adjacency.has(hexId1) || !adjacency.has(hexId2)) continue;
    adjacency.get(hexId1).add(hexId2);
    adjacency.get(hexId2).add(hexId1);
  }
  return adjacency;
}

// Independent exhaustive oracle: enumerate simple paths without subset DP.
function exhaustiveOptimum(moduleList, edgeList) {
  const adjacency = enabledGraph(moduleList, edgeList);
  let maximum = 0;
  let hasMaximumCycle = false;
  for (const start of adjacency.keys()) {
    const visited = new Set([start]);
    function visit(end) {
      const closed = visited.size >= 3 && adjacency.get(end).has(start);
      if (visited.size > maximum) {
        maximum = visited.size;
        hasMaximumCycle = closed;
      } else if (visited.size === maximum && closed) {
        hasMaximumCycle = true;
      }
      for (const next of adjacency.get(end)) {
        if (visited.has(next)) continue;
        visited.add(next);
        visit(next);
        visited.delete(next);
      }
    }
    visit(start);
  }
  return { maximum, hasMaximumCycle };
}

function verify(name, moduleList, edgeList, expected = exhaustiveOptimum(moduleList, edgeList)) {
  const path = solve(moduleList, edgeList);
  const adjacency = enabledGraph(moduleList, edgeList);
  if (expected.maximum === 0) {
    assert.equal(path, null, `${name}: no enabled modules should return null`);
    return;
  }
  assert.ok(Array.isArray(path) && path.length > 0, `${name}: expected a route`);
  const closed = path.length > 1 && path[0] === path.at(-1);
  const visited = closed ? path.slice(0, -1) : path;
  assert.equal(new Set(visited).size, visited.length, `${name}: route revisits a module`);
  assert.equal(visited.length, expected.maximum, `${name}: route does not cover the maximum number of modules`);
  assert.equal(closed, expected.hasMaximumCycle, `${name}: loop preference is incorrect`);
  if (closed) assert.ok(visited.length >= 3, `${name}: a loop needs at least three distinct modules`);
  for (const id of visited) assert.ok(adjacency.has(id), `${name}: route includes disabled or unknown module ${id}`);
  for (let i = 1; i < path.length; i++) {
    assert.ok(adjacency.get(path[i - 1]).has(path[i]), `${name}: route crosses a missing connection`);
  }
}

verify('empty array', [], []);
verify('all disabled', [{ id: 1, enabled: false }], []);
verify('single module', modules([7]), []);
verify('isolated modules', modules([7, 12, 98]), []);
verify('two modules are an open path', modules([1, 2]), edges([[1, 2]]));
verify('three-arm star cannot cover every module', modules([1, 2, 3, 4]), edges([[1, 2], [1, 3], [1, 4]]));
verify('coverage takes priority over a smaller loop', modules([1, 2, 3, 4, 5, 6, 7]), edges([
  [1, 2], [2, 3], [3, 4], [5, 6], [6, 7], [7, 5],
]));
verify('loop wins when coverage ties', modules([1, 2, 3, 4, 5, 6]), edges([
  [1, 2], [2, 3], [4, 5], [5, 6], [6, 4],
]));
verify('largest component need not have the longest path', modules([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), edges([
  [1, 2], [1, 3], [1, 4], [1, 5], [1, 6], [7, 8], [8, 9], [9, 10],
]));
verify('disabled bridge and noncontiguous IDs', [
  ...modules([10, 20, 30, 50, 60, 70, 80]), { id: 40, enabled: false },
], edges([[10, 20], [20, 30], [30, 40], [40, 50], [50, 60], [60, 70], [70, 80]]));
verify('disabled module is excluded from a possible cycle', [
  ...modules([10, 20, 30]), { id: 40, enabled: false },
], edges([[10, 20], [20, 30], [30, 40], [40, 10]]));
verify('a maximum path may start away from the lowest ID', modules([1, 2, 3, 4, 5]), edges([
  [1, 2], [2, 3], [1, 4], [4, 5],
]));

let seed = 0x5eed1234;
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 0x100000000;
}
let oracleCases = 0;
for (let count = 1; count <= 8; count++) {
  for (let sample = 0; sample < 16; sample++) {
    const moduleList = Array.from({ length: count }, (_, index) => ({ id: index * 11 + 3, enabled: random() > .18 }));
    const edgeList = [];
    const density = .15 + (sample % 4) * .2;
    for (let first = 0; first < count; first++) {
      for (let second = first + 1; second < count; second++) {
        if (random() < density) edgeList.push({ hexId1: moduleList[first].id, hexId2: moduleList[second].id });
      }
    }
    verify(`seeded graph ${count}/${sample}`, moduleList, edgeList);
    oracleCases++;
  }
}

const twentyModules = modules(Array.from({ length: 20 }, (_, index) => index + 1));
const chain = edges(Array.from({ length: 19 }, (_, index) => [index + 1, index + 2]));
const dense = [];
for (let first = 1; first <= 20; first++) {
  for (let second = first + 1; second <= 20; second++) dense.push({ hexId1: first, hexId2: second });
}
const started = performance.now();
verify('20-module chain', twentyModules, chain, { maximum: 20, hasMaximumCycle: false });
verify('20-module dense graph', twentyModules, dense, { maximum: 20, hasMaximumCycle: true });
console.log(`Maximum-module paths passed: fixtures, ${oracleCases} exhaustive-oracle graphs, and 20-module chain/dense cases (${Math.round(performance.now() - started)} ms for the 20-module cases).`);
