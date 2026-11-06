/* Exact maximum-coverage stroke paths for the Array Lab's 20-module limit. */
(function () {
  'use strict';

  globalThis.findMaximumModulePath = function (modules, edges) {
    const ids = modules.filter(module => module.enabled).map(module => module.id);
    if (!ids.length) return null;
    if (ids.length > 20) throw new RangeError('Array Lab supports up to 20 enabled modules.');

    const indices = new Map(ids.map((id, index) => [id, index]));
    const neighbors = new Uint32Array(ids.length);
    for (const edge of edges) {
      const first = indices.get(edge.hexId1);
      const second = indices.get(edge.hexId2);
      if (first === undefined || second === undefined || first === second) continue;
      neighbors[first] |= 1 << second;
      neighbors[second] |= 1 << first;
    }

    const stateCount = 1 << ids.length;
    // Each bit represents a possible endpoint of a path visiting exactly this subset.
    const endpoints = new Uint32Array(stateCount);
    // These paths must start at the subset's lowest bit, allowing exact cycle detection.
    const anchoredEndpoints = new Uint32Array(stateCount);
    const sizes = new Uint8Array(stateCount);
    let bestMask = 0;
    let bestSize = 0;
    let bestEnd = 0;
    let bestClosed = false;

    for (let mask = 1; mask < stateCount; mask++) {
      const startBit = mask & -mask;
      sizes[mask] = sizes[mask ^ startBit] + 1;
      if (mask === startBit) {
        endpoints[mask] = anchoredEndpoints[mask] = mask;
      } else {
        for (let remaining = mask; remaining; remaining &= remaining - 1) {
          const endBit = remaining & -remaining;
          const adjacent = neighbors[31 - Math.clz32(endBit)];
          const previous = mask ^ endBit;
          if (adjacent & endpoints[previous]) endpoints[mask] |= endBit;
          if (endBit !== startBit && (adjacent & anchoredEndpoints[previous])) {
            anchoredEndpoints[mask] |= endBit;
          }
        }
      }

      if (!endpoints[mask] || sizes[mask] < bestSize) continue;
      // A loop needs at least three distinct modules; a two-module route stays open.
      const closingEnds = sizes[mask] >= 3
        ? anchoredEndpoints[mask] & neighbors[31 - Math.clz32(startBit)] : 0;
      const closed = closingEnds !== 0;
      if (sizes[mask] > bestSize || (closed && !bestClosed)) {
        bestMask = mask;
        bestSize = sizes[mask];
        const ends = closed ? closingEnds : endpoints[mask];
        bestEnd = ends & -ends;
        bestClosed = closed;
      }
    }

    const table = bestClosed ? anchoredEndpoints : endpoints;
    const path = [];
    for (let mask = bestMask, endBit = bestEnd; mask;) {
      const end = 31 - Math.clz32(endBit);
      path.push(ids[end]);
      mask ^= endBit;
      const previousEnds = table[mask] & neighbors[end];
      endBit = previousEnds & -previousEnds;
    }
    path.reverse();
    if (bestClosed) path.push(path[0]);
    return path;
  };
})();
