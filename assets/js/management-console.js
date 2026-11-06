// ==================== 變數初始化 ====================
    const canvas = document.getElementById('hexCanvas');
    const ctx = canvas.getContext('2d');
    let canvasWidth = 0, canvasHeight = 0;
    let hexagons = [];
    let edges = [];
    let hexPaths = [];
    let showLabels = true;
    let viewMode = 'id';
    let currentZoom = 1;
    let offsetX = 0, offsetY = 0;
    let focusedHexId = null;
    let modalReturnFocus = null;
    let modalReturnDeviceFocus = null;

    // ==================== 實體網關 / Web Serial / WebSocket 變數 ====================
    let isHardwareConnected = false;
    let hardwareSessionStarted = false;
    let serialPort = null;
    let serialReader = null;
    let serialWriter = null;
    let serialKeepReading = false;
    let serialReadTask = null;
    let serialConnecting = false;
    let wsClient = null;
    let hardwareRxCount = 0;
    let hardwareTxCount = 0;
    let lastHardwarePacketTime = 0;
    let baseStationUptime = 0;
    let baseStationLatency = '12ms';
    let activePeerNodes = new Map(); // id -> lastSeenTimestamp
    let terminalLogs = [];           // { type: 'rx'|'tx'|'sys'|'err', time: string, msg: string }
    let simulationInterval = null;
    let connectionHealthInterval = null;
    let neighborHealthInterval = null;
    let wsReconnectTimer = null;
    let wsReconnectAttempts = 0;
    let wsShouldReconnect = false;
    let wsLastUrl = '';
    let wsConnectGeneration = 0;
    const MAX_WS_RECONNECT_ATTEMPTS = 5;
    const TELEMETRY_STALE_MS = 30000;
    const NEIGHBOR_IDENTITY_TIMEOUT_MS = 3000;
    const TELEMETRY_SOURCE_SIM = 'simulation';
    const TELEMETRY_SOURCE_LIVE = 'live';
    const deviceTelemetry = new Map();
    const powerLogEntries = [];
    const DEFAULT_DEVICE_LAYOUT = [
      [0, 0], [1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1], [2, -1]
    ];

    // ==================== 畫布初始化 ====================
    function arrayModuleSize() {
      const availableHeight = canvasHeight - (canvasWidth < 560 ? 70 : 0);
      return Math.min(canvasWidth / 7.4, availableHeight / 5.2, 68) * currentZoom;
    }

    function arrayCenterY() {
      return (canvasHeight - (canvasWidth < 560 ? 70 : 0)) / 2;
    }

    function resizeCanvas() {
      const wrapper = canvas.parentElement;
      const width = wrapper.clientWidth;
      const height = wrapper.clientHeight;
      // Hidden pages have no layout. Preserve the geometry until they are shown.
      if (!width || !height) return;
      canvasWidth = width;
      canvasHeight = height;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
      zoomHex(0);
    }

    // ==================== 六邊形類別 ====================
    class Hexagon {
      constructor(id, q, r, size) {
        this.id = id;
        this.q = q;
        this.r = r;
        this.size = size;
        const hexWidth = size * Math.sqrt(3);
        const hexHeight = size * 1.5;
        const cx = canvasWidth / 2 + hexWidth * (q + r * 0.5);
        const cy = arrayCenterY() + hexHeight * r;
        const sample = ensureDeviceTelemetry(id);
        this.centerX = cx;
        this.centerY = cy;
        this.enabled = sample.status !== 'offline';
        this.power = sample.power.toFixed(1);
        this.temp = sample.temp.toFixed(1);
        this.signal = sample.signal;
        this.voltage = sample.voltage;
        this.current = sample.current;
        this.vertices = this.calcVertices();
        updateTelemetryFromHex(this, TELEMETRY_SOURCE_SIM, { preserveLastReport: true });
      }
      calcVertices() {
        const v = [];
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI / 3) * i - Math.PI / 6;
          v.push({
            x: this.centerX + this.size * 0.91 * Math.cos(angle),
            y: this.centerY + this.size * 0.91 * Math.sin(angle)
          });
        }
        return v;
      }
      containsPoint(x, y) {
        let inside = false;
        for (let i = 0, j = 5; i < 6; j = i++) {
          const xi = this.vertices[i].x, yi = this.vertices[i].y;
          const xj = this.vertices[j].x, yj = this.vertices[j].y;
          const intersect = ((yi > y) !== (yj > y)) &&
            (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
          if (intersect) inside = !inside;
        }
        return inside;
      }
      draw() {
        ctx.save();
        let fill, stroke, glow;
        const stale = isRecordStale(ensureDeviceTelemetry(this.id));
        if (this.enabled && !stale) {
          fill = '#2c5147';
          stroke = '#9ebaa7';
          glow = 'rgba(32, 61, 49, 0.18)';
        } else {
          fill = '#75515a';
          stroke = '#d2aeb6';
          glow = 'rgba(77, 41, 49, 0.15)';
        }
        if (viewMode === 'power' && this.enabled) {
          const p = Math.max(0, Math.min(1, parseFloat(this.power) / 10));
          fill = `hsl(150, 28%, ${24 + p * 16}%)`;
        } else if (viewMode === 'temp' && hasMeasurement(ensureDeviceTelemetry(this.id), 'temp')) {
          const t = Math.max(0, Math.min(1, (parseFloat(this.temp) - 30) / 15));
          fill = `hsl(${180 - t * 165}, 30%, 32%)`;
          stroke = '#cad7d1';
        } else if (viewMode === 'signal' && hasMeasurement(ensureDeviceTelemetry(this.id), 'signal')) {
          const s = Math.max(0, Math.min(1, (this.signal + 80) / 40));
          fill = `hsl(212, 30%, ${26 + s * 14}%)`;
        }
        ctx.shadowColor = glow;
        ctx.shadowBlur = 10;
        ctx.shadowOffsetY = 5;
        ctx.beginPath();
        ctx.moveTo(this.vertices[0].x, this.vertices[0].y);
        for (let i = 1; i < 6; i++) ctx.lineTo(this.vertices[i].x, this.vertices[i].y);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = focusedHexId === this.id ? 3 : 2;
        if (focusedHexId === this.id) ctx.strokeStyle = '#3161ab';
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Photovoltaic cell lines stay clipped to each module's physical outline.
        ctx.save();
        ctx.clip();
        ctx.strokeStyle = '#e0f0e314';
        ctx.lineWidth = 1;
        const cell = this.size / 4;
        for (let step = -4; step <= 4; step++) {
          ctx.beginPath();
          ctx.moveTo(this.centerX + step * cell, this.centerY - this.size);
          ctx.lineTo(this.centerX + step * cell, this.centerY + this.size);
          ctx.moveTo(this.centerX - this.size, this.centerY + step * cell);
          ctx.lineTo(this.centerX + this.size, this.centerY + step * cell);
          ctx.stroke();
        }
        ctx.restore();

        if (showLabels) {
          ctx.fillStyle = '#ffffff';
          const labelSize = Math.min(14, this.size * 0.42);
          const lineOffset = Math.min(12, this.size * 0.32);
          ctx.font = `500 ${labelSize}px Consolas, monospace`;
          ctx.textAlign = 'center';
          ctx.shadowColor = glow;
          ctx.shadowBlur = 0;
          ctx.fillText(`HEX-${String(this.id).padStart(2, '0')}`, this.centerX, this.centerY - lineOffset);
          ctx.font = `${Math.min(11, labelSize)}px "Segoe UI", "Microsoft JhengHei", sans-serif`;
          const statusText = stale ? 'STALE' : (this.enabled ? 'ON' : 'OFF');
          ctx.fillStyle = this.enabled && !stale ? '#d8efb7' : '#ffdae1';
          ctx.fillText(window.consoleI18n?.translate(statusText) || statusText, this.centerX, this.centerY + lineOffset);
          ctx.shadowBlur = 0;
          ctx.font = `${Math.min(10, this.size * 0.3)}px "Noto Sans TC", sans-serif`;
          ctx.fillStyle = '#e1eee7';
          if (viewMode === 'power' && this.enabled) {
            ctx.fillText(`${formatMeasurement(ensureDeviceTelemetry(this.id), 'power')} ${hardwareSessionStarted ? 'W' : 'kWh'}`, this.centerX, this.centerY + lineOffset * 2.2);
          } else if (viewMode === 'temp') {
            ctx.fillText(`${formatMeasurement(ensureDeviceTelemetry(this.id), 'temp')}°C`, this.centerX, this.centerY + lineOffset * 2.2);
          } else if (viewMode === 'signal') {
            ctx.fillText(`${formatMeasurement(ensureDeviceTelemetry(this.id), 'signal', 0)}dBm`, this.centerX, this.centerY + lineOffset * 2.2);
          }
        }
        ctx.restore();
      }
    }

    // ==================== 畫布繪製控制 ====================
    function clearCanvas() {
      ctx.clearRect(0, 0, canvasWidth, canvasHeight);
      hexagons = [];
      edges = [];
      hexPaths = [];
      updateStats();
    }

    function generateDefault() {
      if (hardwareSessionStarted) return;
      clearCanvas();
      const size = arrayModuleSize();
      DEFAULT_DEVICE_LAYOUT.forEach((p, i) => {
        const hex = new Hexagon(i + 1, p[0], p[1], size);
        hexagons.push(hex);
      });
      seedPowerLog();
      buildEdges();
      updateStats();
      drawAll();
    }

    function buildEdges() {
      edges = [];
      if (hardwareSessionStarted) {
        const used = new Set();
        const now = Date.now();
        hexagons.forEach(from => {
          for (let side = 0; side < 6; side++) {
            const state = getNeighborSideState(from.id, side, now);
            if (state.kind !== 'confirmed') continue;
            const to = hexagons.find(hex => hex.id === state.neighbor.id);
            const key = [`${from.id}:${side}`, `${state.neighbor.id}:${state.neighbor.side}`].sort().join('|');
            if (!to || used.has(key)) continue;
            edges.push({ from, to, fromSide: side, toSide: state.neighbor.side });
            used.add(key);
          }
        });
        return;
      }
      const directions = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
      const map = new Map();
      hexagons.forEach(h => map.set(`${h.q},${h.r}`, h.id));
      const usedPairs = new Set();
      hexagons.forEach(h => {
        directions.forEach(([dq, dr]) => {
          const nq = h.q + dq, nr = h.r + dr;
          const key1 = `${h.id}-${map.get(`${nq},${nr}`)}`;
          const key2 = `${map.get(`${nq},${nr}`)}-${h.id}`;
          if (map.has(`${nq},${nr}`) && !usedPairs.has(key1) && !usedPairs.has(key2)) {
            const neighbor = hexagons.find(x => x.id === map.get(`${nq},${nr}`));
            edges.push({ from: h, to: neighbor });
            usedPairs.add(key1);
          }
        });
      });
    }

    function drawEdges() {
      edges.forEach(e => {
        ctx.save();
        ctx.strokeStyle = '#96aea1';
        ctx.lineWidth = 3;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(e.from.centerX, e.from.centerY);
        ctx.lineTo(e.to.centerX, e.to.centerY);
        ctx.stroke();
        ctx.restore();
      });
    }

    function findPath() {
      if (hardwareSessionStarted) {
        showToast('Live route execution is unavailable: neighboring modules can be detected, but no inspection robot or route executor is configured.');
        return;
      }
      if (hexagons.length === 0) {
        showToast('請先產生蜂窩模組！');
        return;
      }
      const enabled = hexagons.filter(h => h.enabled);
      if (enabled.length < 2) {
        showToast('至少啟用 2 個以上的模組！');
        return;
      }
      // DFS 哈密頓路徑
      const adj = {};
      hexagons.forEach(h => adj[h.id] = []);
      edges.forEach(e => {
        if (e.from.enabled && e.to.enabled) {
          adj[e.from.id].push(e.to.id);
          adj[e.to.id].push(e.from.id);
        }
      });
      const startId = enabled[0].id;
      function solve(curr, visited, path) {
        if (visited.size === enabled.length) return [...path];
        for (const nb of adj[curr]) {
          if (!visited.has(nb)) {
            visited.add(nb); path.push(nb);
            const r = solve(nb, visited, path);
            if (r) return r;
            path.pop(); visited.delete(nb);
          }
        }
        return null;
      }
      const result = solve(startId, new Set([startId]), [startId]);
      if (result) {
        hexPaths = result;
        drawAll();
        animatePath(result);
        sendHardwareCommand({ cmd: "set_path", path: result });
        showToast(`✓ 歐亞迴路找到！長度 ${result.length} 節點 (Simulation route)`);
      } else {
        showToast('未找到連接所有啟用模組的路徑');
      }
    }

    function animatePath(path) {
      let i = 0;
      const step = () => {
        if (i >= path.length - 1) return;
        drawAll();
        drawPathWithProgress(path, i + 2);
        i++;
        setTimeout(step, 200);
      };
      step();
    }

    function drawPathWithProgress(path, progress) {
      for (let i = 0; i < progress - 1 && i < path.length - 1; i++) {
        const h1 = hexagons.find(h => h.id === path[i]);
        const h2 = hexagons.find(h => h.id === path[i + 1]);
        if (!h1 || !h2) continue;
        const hue = (i * 360 / path.length) % 360;
        ctx.save();
        ctx.shadowColor = `hsl(${hue}, 100%, 60%)`;
        ctx.shadowBlur = 20;
        ctx.strokeStyle = `hsl(${hue}, 100%, 60%)`;
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(h1.centerX, h1.centerY);
        ctx.lineTo(h2.centerX, h2.centerY);
        ctx.stroke();
        // arrow
        const dx = h2.centerX - h1.centerX;
        const dy = h2.centerY - h1.centerY;
        const angle = Math.atan2(dy, dx);
        const ax = h1.centerX + dx * 0.65;
        const ay = h1.centerY + dy * 0.65;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax - 12 * Math.cos(angle - Math.PI / 6), ay - 12 * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(ax - 12 * Math.cos(angle + Math.PI / 6), ay - 12 * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fillStyle = `hsl(${hue}, 100%, 60%)`;
        ctx.fill();
        ctx.restore();
        // node marker
        ctx.save();
        ctx.shadowColor = '#ffffff';
        ctx.shadowBlur = 15;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(h1.centerX, h1.centerY, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#0f2a28';
        ctx.font = 'bold 11px Orbitron';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`S:${i + 1}`, h1.centerX, h1.centerY);
        if (i === progress - 2) {
          ctx.shadowColor = '#ffffff';
          ctx.shadowBlur = 15;
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(h2.centerX, h2.centerY, 14, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.fillStyle = '#0f2a28';
          ctx.fillText(`S:${i + 2}`, h2.centerX, h2.centerY);
        }
        ctx.restore();
      }
    }

    function drawAll() {
      ctx.clearRect(0, 0, canvasWidth, canvasHeight);
      ctx.save();
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--diagram-grid').trim();
      for (let x = 18; x < canvasWidth; x += 24) {
        for (let y = 18; y < canvasHeight; y += 24) ctx.fillRect(x, y, 1, 1);
      }
      ctx.restore();
      drawEdges();
      hexagons.forEach(h => h.draw());
      if (hexPaths.length > 1) {
        drawPathWithProgress(hexPaths, hexPaths.length);
      }
    }

    // ==================== 互動控制 ====================
    function toggleLabels() {
      showLabels = !showLabels;
      document.getElementById('toggleLabel').classList.toggle('active');
      document.getElementById('toggleLabel').setAttribute('aria-pressed', String(showLabels));
      drawAll();
    }

    function setViewMode(mode) {
      viewMode = mode;
      document.querySelectorAll('.control-buttons .control-btn').forEach((b, idx) => {
        const modes = ['id', 'power', 'temp', 'signal'];
        b.classList.toggle('active', modes[idx] === mode);
        b.setAttribute('aria-pressed', String(modes[idx] === mode));
      });
      drawAll();
    }

    function allOn() {
      if (!checkPermission('control', '全部啟動模組')) return;
      if (hardwareSessionStarted) { sendHardwareCommand({ cmd: 'all_power', enabled: true }); return; }
      hexagons.forEach(h => h.enabled = true);
      updateStats();
      drawAll();
      sendHardwareCommand({ cmd: "all_power", enabled: true });
      showToast('Simulation: all modules enabled.');
    }

    function allOff() {
      if (!checkPermission('control', '全部停止模組')) return;
      if (hardwareSessionStarted) { sendHardwareCommand({ cmd: 'all_power', enabled: false }); return; }
      hexagons.forEach(h => h.enabled = false);
      updateStats();
      drawAll();
      sendHardwareCommand({ cmd: "all_power", enabled: false });
      showToast('Simulation: all modules disabled.');
    }

    function zoomHex(delta) {
      if (hexagons.length === 0) return;
      currentZoom = Math.max(0.5, Math.min(2, currentZoom + delta));
      const cx = canvasWidth / 2;
      const cy = arrayCenterY();
      const size = arrayModuleSize();
      hexagons.forEach(h => {
        h.size = size;
        const hw = size * Math.sqrt(3);
        const hh = size * 1.5;
        h.centerX = cx + hw * (h.q + h.r * 0.5);
        h.centerY = cy + hh * h.r;
        h.vertices = h.calcVertices();
      });
      buildEdges();
      drawAll();
    }

    function resetZoom() {
      currentZoom = 1;
      zoomHex(0);
    }

    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * canvasWidth / rect.width;
      const y = (e.clientY - rect.top) * canvasHeight / rect.height;
      for (const h of hexagons) {
        if (h.containsPoint(x, y)) {
          focusedHexId = h.id;
          drawAll();
          viewDevice(h.id);
          break;
        }
      }
    });

    // ==================== 頁面切換 ====================
    const navToggle = document.getElementById('navToggle');
    const compactNavigation = window.matchMedia('(max-width: 1024px)');
    function setNavigationOpen(open) {
      const sidebar = document.querySelector('.sidebar');
      if (!open && compactNavigation.matches && sidebar.contains(document.activeElement)) {
        navToggle.focus();
      }
      sidebar.classList.toggle('nav-open', open);
      navToggle.setAttribute('aria-expanded', String(open));
    }
    navToggle.addEventListener('click', () => {
      setNavigationOpen(navToggle.getAttribute('aria-expanded') !== 'true');
    });
    compactNavigation.addEventListener('change', () => setNavigationOpen(false));
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') setNavigationOpen(false);
    });
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => navigateTo(item.dataset.page));
    });

    // ==================== 小工具 & 全域函式 ====================
    function updateStats() {
      syncTelemetryFromHexagons({ preserveLastReport: true });
      const records = getDeviceRecords();
      const total = records.length || hexagons.length;
      const active = records.filter(r => r.status === 'online' && !isRecordStale(r)).length;
      const offline = records.filter(r => r.status === 'offline' || isRecordStale(r)).length;
      const idle = Math.max(0, total - active - offline);
      document.getElementById('statTotal').textContent = total || (hardwareSessionStarted ? '0' : '8');
      document.getElementById('statActive').textContent = active;
      document.getElementById('statIdle').textContent = idle;
      document.getElementById('statOffline').textContent = offline;
      updatePowerSummaryUI();
      window.refreshWorkspace?.();
    }

    function numberOr(value, fallback) {
      if (value === null || value === undefined || value === '') return fallback;
      const n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    }

    const MEASUREMENT_FIELDS = ['voltage', 'current', 'power', 'temp', 'signal'];

    function hasMeasurement(record, field) {
      return record.source !== TELEMETRY_SOURCE_LIVE || record.measurementAvailable?.[field] === true;
    }

    function formatMeasurement(record, field, digits = 1) {
      return hasMeasurement(record, field) ? numberOr(record[field], 0).toFixed(digits) : '--';
    }

    function validNeighborUint(value, nonzero = false) {
      return Number.isInteger(value) && value >= (nonzero ? 1 : 0) && value <= 0xffffffff;
    }

    function normalizedNeighborMac(value) {
      if (typeof value !== 'string' || !/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(value)) return null;
      const bytes = value.split(':').map(byte => parseInt(byte, 16));
      return bytes.some(Boolean) && !(bytes[0] & 1) ? value.toUpperCase() : null;
    }

    function readNeighborPayload(data) {
      const missing = data.neighbor_detection === undefined && data.edge_neighbors === undefined;
      const unavailable = { neighborDetection: missing ? 'unavailable' : 'invalid', edgeNeighbors: null };
      if (!['disabled', 'ready', 'hardware_error'].includes(data.neighbor_detection)
        || !Array.isArray(data.edge_neighbors) || data.edge_neighbors.length !== 6) return unavailable;
      const seen = new Set();
      const seenMacs = new Set();
      const neighbors = [];
      for (const entry of data.edge_neighbors) {
        if (entry === null) { neighbors.push(null); continue; }
        if (data.neighbor_detection !== 'ready' || !Number.isInteger(data.hall_mask)
          || !(data.hall_mask & (1 << neighbors.length)) || !entry || typeof entry !== 'object' || Array.isArray(entry)
          || !Number.isInteger(entry.id) || entry.id < 1 || entry.id > 8 || entry.id === data.id
          || !Number.isInteger(entry.side) || entry.side < 0 || entry.side > 5
          || !validNeighborUint(entry.boot_id, true) || !normalizedNeighborMac(entry.mac)
          || normalizedNeighborMac(entry.mac) === normalizedNeighborMac(data.mac)
          || !validNeighborUint(entry.age_ms) || entry.age_ms >= NEIGHBOR_IDENTITY_TIMEOUT_MS
          || seen.has(entry.id) || seenMacs.has(normalizedNeighborMac(entry.mac))) return { neighborDetection: 'invalid', edgeNeighbors: null };
        seen.add(entry.id);
        seenMacs.add(normalizedNeighborMac(entry.mac));
        neighbors.push({ id: entry.id, side: entry.side, bootId: entry.boot_id, mac: normalizedNeighborMac(entry.mac), ageMs: entry.age_ms });
      }
      return { neighborDetection: data.neighbor_detection, edgeNeighbors: neighbors };
    }

    function currentNodeIdentity(record) {
      return record && Number.isInteger(record.id) && record.id >= 1 && record.id <= 8
        && validNeighborUint(record.bootId, true) && normalizedNeighborMac(record.mac);
    }

    function neighborIdentityExpired(record, identity, now) {
      return !record.lastReport || identity.ageMs + Math.max(0, now - record.lastReport) >= NEIGHBOR_IDENTITY_TIMEOUT_MS;
    }

    function getNeighborSideState(id, side, now = Date.now()) {
      const record = deviceTelemetry.get(id);
      const state = (kind, label, neighbor = null) => ({ kind, label, neighbor });
      if (!record || record.source !== TELEMETRY_SOURCE_LIVE) return state('unavailable', 'No live identity data');
      if (!isHardwareConnected) return state('disconnected', 'Gateway disconnected');
      if (record.status === 'offline') return state('offline', 'Node offline');
      if (isRecordStale(record)) return state('stale', 'Node telemetry stale');
      if (!record.halls) return state('unavailable', 'Hall data unavailable');
      if (!record.halls[side]) return state('clear', 'clear');
      if (record.neighborDetection === 'disabled') return state('disabled', 'Detected; identity hardware disabled');
      if (record.neighborDetection === 'hardware_error') return state('hardware_error', 'Detected; identity hardware error');
      if (record.neighborDetection === 'invalid') return state('invalid', 'Invalid neighbor data');
      if (record.neighborDetection !== 'ready') return state('unavailable', 'Detected; identity hardware unavailable');
      if (!currentNodeIdentity(record)) return state('invalid', 'Invalid node identity');
      const neighbor = record.edgeNeighbors?.[side];
      if (!neighbor) return state('awaiting_identity', 'Detected; awaiting identity');
      if (neighborIdentityExpired(record, neighbor, now)) return state('stale', 'Neighbor identity stale', neighbor);
      const peer = deviceTelemetry.get(neighbor.id);
      if (!peer || peer.source !== TELEMETRY_SOURCE_LIVE) return state('waiting_peer', 'Waiting for peer telemetry', neighbor);
      if (peer.status === 'offline') return state('offline', 'Neighbor offline', neighbor);
      if (isRecordStale(peer)) return state('stale', 'Neighbor telemetry stale', neighbor);
      if (!currentNodeIdentity(peer) || neighbor.bootId !== peer.bootId || neighbor.mac !== normalizedNeighborMac(peer.mac)) {
        return state('conflict', 'Identity conflict', neighbor);
      }
      if (peer.neighborDetection !== 'ready' || !peer.halls) return state('waiting_peer', 'Waiting for peer confirmation', neighbor);
      if (!peer.halls[neighbor.side]) return state('conflict', 'Hall state conflict', neighbor);
      const reciprocal = peer.edgeNeighbors?.[neighbor.side];
      if (!reciprocal) return state('waiting_peer', 'Waiting for peer confirmation', neighbor);
      if (neighborIdentityExpired(peer, reciprocal, now)) return state('stale', 'Neighbor identity stale', neighbor);
      if (reciprocal.id !== id || reciprocal.side !== side || reciprocal.bootId !== record.bootId
        || reciprocal.mac !== normalizedNeighborMac(record.mac)) return state('conflict', 'Identity conflict', neighbor);
      return state('confirmed', 'Confirmed', neighbor);
    }

    function renderNeighborDetails(id) {
      const record = deviceTelemetry.get(id);
      if (!record) return '';
      const readiness = {
        disabled: 'Disabled; install and enable edge identity hardware',
        ready: 'Ready', hardware_error: 'Identity hardware error', invalid: 'Invalid neighbor data',
        unavailable: 'Identity hardware unavailable'
      }[record.neighborDetection] || 'Identity hardware unavailable';
      const rows = Array.from({ length: 6 }, (_, side) => {
        const state = getNeighborSideState(id, side);
        const destination = state.neighbor ? ` → HEX-${String(state.neighbor.id).padStart(2, '0')} D${state.neighbor.side}` : '';
        return `<div data-neighbor-side="${side}" data-neighbor-state="${state.kind}">D${side}${destination} · <span>${state.label}</span></div>`;
      }).join('');
      return `<b style="color:var(--accent-on)">Hall D0–D5：</b>${record.halls ? record.halls.map((active, side) => `D${side}: ${active ? 'DETECTED' : 'clear'}`).join(' · ') : '--'}<br>
        <b style="color:var(--accent-on)">Neighbor detection:</b> <span>${readiness}</span>
        <div style="margin:6px 0" aria-live="polite">${rows}</div>
        <small>Confirmed neighbors require matching identities and active Hall sensors on both modules. Display positions are configured coordinates.</small>`;
    }

    function refreshNeighborDetails() {
      const section = document.getElementById('deviceNeighborDetails');
      if (!section || !document.getElementById('modalRoot').classList.contains('active')) return;
      const html = renderNeighborDetails(Number(section.dataset.nodeId));
      if (section._neighborHtml !== html) {
        section.innerHTML = html;
        section._neighborHtml = html;
      }
    }

    function refreshNeighborTopology() {
      if (!hardwareSessionStarted) return;
      buildEdges();
      refreshNeighborDetails();
      drawAll();
    }

    function startHardwareSession() {
      if (hardwareSessionStarted) return;
      hardwareSessionStarted = true;
      deviceTelemetry.clear();
      activePeerNodes.clear();
      powerLogEntries.length = 0;
      deviceIds = [];
      deviceCount = 0;
      hexagons = [];
      edges = [];
      hexPaths = [];
      updateStats();
      buildDeviceTable();
      buildPowerLog();
      drawAll();
    }

    function deviceCoordinates(id) {
      const layout = DEFAULT_DEVICE_LAYOUT[id - 1] || [(id % 3) - 1, Math.floor(id / 3) - 1];
      return { q: layout[0], r: layout[1] };
    }

    function deterministicDeviceSample(id) {
      const coord = deviceCoordinates(id);
      const onlinePattern = id % 8 === 0 ? 'offline' : (id % 4 === 0 ? 'warning' : 'online');
      const enabled = onlinePattern !== 'offline';
      const voltage = enabled ? 11.9 + (id % 5) * 0.08 : 0;
      const power = enabled ? 3.8 + (id % 6) * 1.35 : 0;
      return {
        id,
        q: coord.q,
        r: coord.r,
        status: onlinePattern,
        enabled,
        voltage,
        current: enabled ? power / voltage : 0,
        power,
        temp: enabled ? 31.5 + (id % 7) * 1.7 : 0,
        signal: enabled ? -42 - (id % 6) * 4 : -90,
        mac: `24:6F:28:AA:BB:${String(id).padStart(2, '0')}`,
        source: TELEMETRY_SOURCE_SIM,
        lastReport: Date.now() - id * 7000
      };
    }

    function ensureDeviceTelemetry(id) {
      if (!deviceTelemetry.has(id)) {
        deviceTelemetry.set(id, deterministicDeviceSample(id));
      }
      return deviceTelemetry.get(id);
    }

    function updateTelemetryRecord(id, updates = {}, source = TELEMETRY_SOURCE_SIM) {
      const existing = ensureDeviceTelemetry(id);
      const cleanUpdates = Object.fromEntries(
        Object.entries(updates).filter(([, value]) => value !== undefined && value !== null && value !== '')
      );
      const next = Object.assign({}, existing, cleanUpdates, {
        id,
        source,
        lastReport: cleanUpdates.lastReport || Date.now()
      });
      next.enabled = cleanUpdates.enabled !== undefined ? !!cleanUpdates.enabled : !!next.enabled;
      next.status = cleanUpdates.status || (next.enabled ? 'online' : 'offline');
      next.voltage = numberOr(next.voltage, 0);
      next.current = numberOr(next.current, next.voltage ? numberOr(next.power, 0) / next.voltage : 0);
      next.power = numberOr(next.power, next.voltage * next.current);
      next.temp = numberOr(next.temp, 0);
      next.signal = numberOr(next.signal, -90);
      if (source === TELEMETRY_SOURCE_LIVE) {
        next.status = cleanUpdates.status || 'online';
        next.measurementAvailable = {};
        MEASUREMENT_FIELDS.forEach(field => {
          const available = typeof updates[field] === 'number' && Number.isFinite(updates[field]);
          next.measurementAvailable[field] = available;
          next[field] = available ? updates[field] : 0;
        });
        next.mac = typeof updates.mac === 'string' ? updates.mac : '--';
        next.powerControlAvailable = updates.powerControlAvailable === true;
      }
      deviceTelemetry.set(id, next);
      return next;
    }

    function updateTelemetryFromHex(hex, source = TELEMETRY_SOURCE_SIM, options = {}) {
      const existing = ensureDeviceTelemetry(hex.id);
      if (existing.source === TELEMETRY_SOURCE_LIVE) return existing;
      return updateTelemetryRecord(hex.id, {
        q: hex.q,
        r: hex.r,
        enabled: !!hex.enabled,
        status: hex.enabled ? (existing.status === 'warning' ? 'warning' : 'online') : 'offline',
        voltage: numberOr(hex.voltage, existing.voltage),
        current: numberOr(hex.current, existing.current),
        power: numberOr(hex.power, existing.power),
        temp: numberOr(hex.temp, existing.temp),
        signal: numberOr(hex.signal, existing.signal),
        mac: existing.mac,
        lastReport: options.preserveLastReport ? existing.lastReport : Date.now()
      }, source);
    }

    function syncTelemetryFromHexagons(options = {}) {
      hexagons.forEach(hex => updateTelemetryFromHex(hex, deviceTelemetry.get(hex.id)?.source || TELEMETRY_SOURCE_SIM, options));
      deviceIds.forEach(id => ensureDeviceTelemetry(id));
    }

    function getDeviceRecords() {
      syncTelemetryFromHexagons({ preserveLastReport: true });
      return deviceIds.map(id => ensureDeviceTelemetry(id));
    }

    function formatSecondsAgo(timestamp) {
      if (!timestamp) return '-';
      const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
      if (seconds < 60) return `${String(seconds).padStart(2, '0')} 秒前`;
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return `${minutes} 分鐘前`;
      return `${Math.floor(minutes / 60)} 小時前`;
    }

    function isRecordStale(record) {
      return record.source === TELEMETRY_SOURCE_LIVE
        && record.lastReport
        && Date.now() - record.lastReport > TELEMETRY_STALE_MS;
    }

    function statusLabel(record) {
      if (isRecordStale(record)) return 'STALE';
      if (record.source === TELEMETRY_SOURCE_LIVE && !record.enabled && record.status !== 'offline') return 'OFF';
      if (record.status === 'warning') return 'WARNING';
      if (record.status === 'offline') return 'OFFLINE';
      return 'ONLINE';
    }

    function statusClass(record) {
      if (isRecordStale(record)) return 'stale';
      return record.status;
    }

    function appendPowerLog(record, time = new Date()) {
      if (record.source === TELEMETRY_SOURCE_LIVE) return;
      powerLogEntries.unshift({
        timestamp: time,
        deviceId: record.id,
        power: record.power,
        voltage: record.voltage,
        current: record.current || (record.voltage ? record.power / record.voltage : 0),
        efficiency: record.status === 'warning' ? 86.5 : Math.min(98, 89 + (record.id % 6) * 1.3),
        status: record.status === 'offline' ? '離線' : (record.status === 'warning' ? '需檢查' : '正常')
      });
      if (powerLogEntries.length > 60) powerLogEntries.length = 60;
    }

    function seedPowerLog() {
      if (hardwareSessionStarted) return;
      if (powerLogEntries.length) return;
      const base = Date.now();
      getDeviceRecords().filter(r => r.status !== 'offline').slice(0, 7).forEach((record, idx) => {
        appendPowerLog(record, new Date(base - idx * 30 * 60 * 1000));
      });
    }

    function updatePowerSummaryUI() {
      const records = getDeviceRecords();
      if (hardwareSessionStarted) {
        const measured = records.filter(r => !isRecordStale(r) && hasMeasurement(r, 'power'));
        setText('#metricCurrentOutput', measured.length ? `${measured.reduce((sum, r) => sum + r.power, 0).toFixed(1)} W` : '--');
        ['#metricPeakLoad', '#metricPowerLog', '#metricPowerToday', '#metricPowerWeek', '#metricPowerMonth', '#metricCarbonReduction'].forEach(selector => setText(selector, '--'));
        const progress = document.getElementById('metricOutputProgress');
        if (progress) progress.style.width = '0%';
        return;
      }
      const activeRecords = records.filter(r => r.status === 'online' || r.status === 'warning');
      const currentOutput = activeRecords.reduce((sum, r) => sum + r.power, 0);
      const peakLoad = Math.max(currentOutput, ...powerLogEntries.map(e => e.power));
      const totalGenerated = powerLogEntries.reduce((sum, e) => sum + e.power, 0);
      setText('#metricCurrentOutput', `${currentOutput.toFixed(1)} kWh`);
      setText('#metricPeakLoad', `${peakLoad.toFixed(1)} kWh`);
      setText('#metricPowerLog', `${totalGenerated.toFixed(1)} kWh`);
      setText('#metricPowerToday', `${totalGenerated.toFixed(1)}`);
      setText('#metricPowerWeek', `${(totalGenerated * 6.2).toFixed(1)}`);
      setText('#metricPowerMonth', `${(totalGenerated * 25.8).toLocaleString(undefined, { maximumFractionDigits: 1 })}`);
      setText('#metricCarbonReduction', `${(totalGenerated * 0.018).toFixed(2)}`);
      const progress = document.getElementById('metricOutputProgress');
      if (progress) progress.style.width = `${Math.max(4, Math.min(100, currentOutput))}%`;
    }

    function setText(selector, value) {
      const el = document.querySelector(selector);
      if (el) el.textContent = value;
    }

    function toggleEnv() {
      if (!checkPermission('control', '現場環境監控開關')) return;
      const el = document.getElementById('envToggle');
      el.classList.toggle('active');
      showToast(el.classList.contains('active') ? '✓ 現場環境監控已開啟' : '現場環境監控已關閉');
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    // ==================== MQTT 網關與硬體直連通訊模組 ====================

    function updateBaseStationUI() {
      const now = Date.now();
      let liveCount = 0;
      activePeerNodes.forEach((time, id) => {
        if (now - time < 15000) liveCount++;
      });
      if (!isHardwareConnected && !hardwareSessionStarted) {
        liveCount = hexagons.filter(h => h.enabled).length || 8;
      }

      const activeEl = document.getElementById('baseActiveLinks');
      if (activeEl) activeEl.textContent = liveCount;

      const rxEl = document.getElementById('baseRxCount');
      if (rxEl) rxEl.textContent = hardwareRxCount;

      const txEl = document.getElementById('baseTxCount');
      if (txEl) txEl.textContent = hardwareTxCount;

      const latEl = document.getElementById('baseLatency');
      if (latEl) latEl.textContent = baseStationLatency;

      const netRxEl = document.getElementById('netRxPackets');
      if (netRxEl) netRxEl.textContent = `${hardwareRxCount} pkts`;
    }

    function setHardwareConnected(connected, endpointLabel) {
      if (connected) startHardwareSession();
      if (!connected) {
        // A new transport session needs fresh identity reports from both endpoints.
        // Retain Hall readings for reference, but never reuse a pre-disconnect claim.
        deviceTelemetry.forEach(record => {
          if (record.source === TELEMETRY_SOURCE_LIVE) record.edgeNeighbors = null;
        });
      }
      isHardwareConnected = connected;
      const badge = document.getElementById('baseConnBadge');
      const btnText = document.getElementById('btnSerialText');
      const endp = document.getElementById('baseEndpointLabel');
      const netDot = document.getElementById('netStatusDot');
      const netStatus = document.getElementById('netStatusText');
      const netMode = document.getElementById('netHardwareMode');
      const netModeDot = document.getElementById('netModeDot');
      const netRxEl = document.getElementById('netRxPackets');

      if (connected) {
        if (badge) {
          badge.textContent = '🟢 HARDWARE LIVE 直連硬體';
          badge.className = 'status-pill online';
          badge.style.cursor = 'pointer';
        }
        if (btnText) btnText.textContent = '斷開網關 (USB)';
        if (endp) {
          endp.dataset.endpointLabel = endpointLabel || 'ESP32 Connected';
          endp.textContent = endp.dataset.endpointLabel;
        }
        if (netDot) netDot.className = 'status-dot';
        if (netStatus) netStatus.textContent = 'Live gateway connected';
        if (netRxEl) netRxEl.title = 'Live telemetry stream active';
        if (netModeDot) netModeDot.className = 'status-dot';
        if (netMode) {
          netMode.textContent = 'Real Hardware Mode';
          netMode.style.color = 'var(--accent-on)';
        }
      } else {
        if (badge) {
          badge.textContent = hardwareSessionStarted ? '🟠 DISCONNECTED 已斷線' : '🟡 SIMULATION 模擬';
          badge.className = 'status-pill warning';
          badge.style.cursor = 'pointer';
        }
        if (btnText) btnText.textContent = '連線網關 (USB Serial)';
        if (endp) endp.textContent = hardwareSessionStarted ? '未連接 (保留最後實測資料)' : '未連接 (模擬模式運行中)';
        if (netStatus) netStatus.textContent = hardwareSessionStarted ? 'Disconnected' : 'Standby (Simulation)';
        if (netRxEl) netRxEl.title = 'Simulation data is active until hardware telemetry is connected';
        if (netModeDot) netModeDot.className = 'status-dot warn';
        if (netMode) {
          netMode.textContent = hardwareSessionStarted ? 'Hardware disconnected' : 'Simulation Mode';
          netMode.style.color = 'var(--accent-warning)';
        }
      }
      updateBaseStationUI();
      refreshNeighborTopology();
    }

    function markConnectionStale(reason = 'Telemetry timeout') {
      if (!isHardwareConnected) return;
      const badge = document.getElementById('baseConnBadge');
      const netDot = document.getElementById('netStatusDot');
      const netStatus = document.getElementById('netStatusText');
      const netModeDot = document.getElementById('netModeDot');
      const netMode = document.getElementById('netHardwareMode');
      const endpoint = document.getElementById('baseEndpointLabel');
      if (badge) {
        badge.textContent = '🟠 STALE DATA 遙測逾時';
        badge.className = 'status-pill stale';
      }
      if (netDot) netDot.className = 'status-dot warn';
      if (netStatus) netStatus.textContent = reason;
      if (netModeDot) netModeDot.className = 'status-dot warn';
      if (netMode) {
        netMode.textContent = 'Live link stale';
        netMode.style.color = 'var(--accent-warning)';
      }
      if (endpoint && lastHardwarePacketTime) {
        endpoint.textContent = `${endpoint.dataset.endpointLabel || 'ESP32 Connected'} · stale ${formatSecondsAgo(lastHardwarePacketTime)}`;
      }
    }

    function startConnectionHealthMonitor() {
      if (connectionHealthInterval) clearInterval(connectionHealthInterval);
      connectionHealthInterval = setInterval(refreshHardwareHealth, 5000);
      if (neighborHealthInterval) clearInterval(neighborHealthInterval);
      neighborHealthInterval = setInterval(refreshNeighborTopology, 250);
    }

    function refreshHardwareHealth() {
      if (!hardwareSessionStarted) return;
      if (isHardwareConnected && lastHardwarePacketTime && Date.now() - lastHardwarePacketTime > TELEMETRY_STALE_MS) {
        markConnectionStale('No gateway packets received recently');
      }
      // Gateway heartbeats keep the link alive; each node ages independently.
      buildDeviceTable();
      updateStats();
      updateBaseStationUI();
      refreshNeighborTopology();
    }

    function toggleBaseMode() {
      if (isHardwareConnected) {
        if (confirm(window.consoleI18n?.translate('Disconnect hardware? The last real readings will be retained.') || 'Disconnect hardware? The last real readings will be retained.')) {
          if (serialPort) disconnectSerial();
          if (wsClient) disconnectWebSocket();
          setHardwareConnected(false);
          showToast('Hardware disconnected; last real readings retained.');
        }
      } else {
        handleConnectSerial();
      }
    }

    function toggleBase(el) {
      if (!checkPermission('control', '網關連線')) return;
      toggleBaseMode();
    }

    // ------------------- Web Serial API (USB 串列通訊) -------------------
    async function handleConnectSerial() {
      if (!checkPermission('control', '網關串列埠連線') || serialConnecting) return;
      if (serialPort) { await disconnectSerial(); return; }
      if (!('serial' in navigator)) {
        showToast('USB Serial requires desktop Chrome/Edge on HTTPS or localhost. Use the local HTTP console with the Wi-Fi gateway otherwise.');
        return;
      }
      serialConnecting = true;
      let port = null;
      try {
        const baudRate = parseInt(document.getElementById('cfgBaudRate')?.value || '115200', 10);
        port = await navigator.serial.requestPort();
        await port.open({ baudRate });
        disconnectWebSocket();
        serialPort = port;
        serialWriter = port.writable.getWriter();
        serialKeepReading = true;
        serialReadTask = readSerialLoop(port);
        lastHardwarePacketTime = Date.now();
        setHardwareConnected(true, `USB Serial (${baudRate} baud)`);
        appendTerminalLog('sys', `[SYS] Web Serial port opened at ${baudRate} baud.`);
        await sendHardwareCommand({ cmd: 'ping' });
      } catch (error) {
        if (error.name !== 'NotFoundError') {
          appendTerminalLog('err', `[ERR] Serial connection: ${error.message}`);
          showToast('Serial connection failed: ' + error.message);
        }
        if (serialPort === port && port) await disconnectSerial();
        else if (port) { try { await port.close(); } catch {} }
      } finally { serialConnecting = false; }
    }

    async function readSerialLoop(port) {
      let reader = null;
      const decoder = new TextDecoder();
      let partial = '';
      let discarding = false;
      try {
        reader = port.readable.getReader();
        serialReader = reader;
        while (serialKeepReading && serialPort === port) {
          const { value, done } = await reader.read();
          if (done) break;
          for (const character of decoder.decode(value, { stream: true })) {
            if (discarding) { if (character === '\n') discarding = false; continue; }
            if (character === '\n') {
              if (partial.trim()) parseHardwarePacket(partial);
              partial = '';
            } else if (partial.length >= 4096) {
              partial = '';
              discarding = true;
              appendTerminalLog('err', '[ERR] Oversized serial line discarded until newline.');
            } else partial += character;
          }
        }
      } catch (error) {
        if (serialKeepReading) appendTerminalLog('err', `[ERR] Serial read: ${error.message}`);
      } finally {
        if (reader) reader.releaseLock();
        if (serialReader === reader) serialReader = null;
        if (serialPort === port && serialKeepReading) {
          serialKeepReading = false;
          if (serialWriter) { try { serialWriter.releaseLock(); } catch {} }
          serialWriter = null;
          serialPort = null;
          try { await port.close(); } catch {}
          setHardwareConnected(false);
          appendTerminalLog('err', '[ERR] Serial stream ended; reconnect the gateway.');
        }
      }
    }

    async function disconnectSerial() {
      const port = serialPort;
      serialKeepReading = false;
      if (serialReader) { try { await serialReader.cancel(); } catch {} }
      if (serialReadTask) { try { await serialReadTask; } catch {} }
      serialReadTask = null;
      if (serialWriter) {
        try { await serialWriter.close(); } catch {}
        try { serialWriter.releaseLock(); } catch {}
      }
      serialWriter = null;
      serialReader = null;
      serialPort = null;
      if (port) { try { await port.close(); } catch (error) { appendTerminalLog('err', `[ERR] Serial close: ${error.message}`); } }
      setHardwareConnected(false);
      appendTerminalLog('sys', '[SYS] USB Serial port disconnected.');
    }

    // ------------------- WebSocket (Wi-Fi 網關) -------------------
    function openWsConnectModal() {
      const currentWs = document.getElementById('cfgWsUrl')?.value || 'ws://127.0.0.1:8081';
      const html = `
    <div style="font-size:13px; color:var(--text-secondary); line-height:1.8">
      <p style="margin-bottom:12px">連接 UNO R4 AP 的 MQTT 中繼服務或舊版 ESP32 WebSocket 網關。</p>
      <div class="settings-group">
        <label class="settings-label">WebSocket URL</label>
        <input class="settings-input" id="modalWsUrlInput" value="${currentWs}">
      </div>
      <div style="font-size:11px; color:var(--text-muted); background:rgba(0,229,200,0.05); padding:10px; border-radius:4px; border:1px solid rgba(0,229,200,0.2)">
        💡 <b>連線提示：</b><br>
        <p>UNO R4 AP / MQTT：電腦與 XIAO 節點連接 HexagonSolar-UNO-R4 熱點；電腦固定 IP 為 192.168.4.250，啟動 Mosquitto 及中繼服務。</p>
        <code data-no-i18n>ws://127.0.0.1:8081</code>
        <p>其他裝置需連接 UNO 熱點，並使用電腦的中繼位址。</p>
        <code data-no-i18n>ws://192.168.4.250:8081</code>
        <p>舊版 ESP-NOW：連接 ESP32 的 HexagonSolar-BaseGateway 熱點，再輸入網關位址。</p>
        <code data-no-i18n>ws://192.168.4.1:81</code>
        <p>HTTPS 頁面需要安全的 wss:// 中繼或 USB Serial；本機 HTTP 可使用 ws://。</p>
      </div>
    </div>
  `;
      const footer = `
    <button class="toolbar-btn" onclick="closeModal()">取消</button>
    <button class="toolbar-btn primary" onclick="confirmConnectWebSocket()">連線 Wi-Fi 網關</button>
  `;
      openModal('📶 連線 Wi-Fi 網關', html, footer);
    }

    function confirmConnectWebSocket() {
      const url = document.getElementById('modalWsUrlInput')?.value.trim();
      closeModal();
      if (!url) return;
      connectWebSocket(url);
    }

    async function connectWebSocket(url, reconnect = false) {
      const generation = ++wsConnectGeneration;
      if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
      if (!reconnect) wsReconnectAttempts = 0;
      wsLastUrl = url;
      wsShouldReconnect = true;
      if (serialPort) await disconnectSerial();
      if (generation !== wsConnectGeneration) return;
      const previous = wsClient;
      wsClient = null;
      previous?.close();
      if (location.protocol === 'https:' && url.startsWith('ws:')) {
        wsShouldReconnect = false;
        showToast('HTTPS cannot connect to an insecure ws:// gateway. Open this console via local HTTP for Wi-Fi, or use USB Serial on HTTPS.');
        return;
      }
      appendTerminalLog('sys', `[SYS] Connecting WebSocket to ${url}...`);
      try {
        const socket = new WebSocket(url);
        wsClient = socket;
        socket.onopen = () => {
          if (wsClient !== socket) return;
          wsReconnectAttempts = 0;
          lastHardwarePacketTime = Date.now();
          setHardwareConnected(true, `Wi-Fi (${url})`);
          appendTerminalLog('sys', '[SYS] WebSocket connected.');
          sendHardwareCommand({ cmd: 'ping' });
        };
        socket.onmessage = event => {
          if (wsClient !== socket || typeof event.data !== 'string') return;
          if (event.data.length > 65536) {
            appendTerminalLog('err', '[ERR] Oversized WebSocket message discarded.');
            return;
          }
          event.data.split(/\r?\n/).filter(line => line.trim()).forEach(line => {
            if (line.length > 4096) appendTerminalLog('err', '[ERR] Oversized WebSocket line discarded.');
            else parseHardwarePacket(line);
          });
        };
        socket.onerror = () => {
          if (wsClient === socket) appendTerminalLog('err', `[ERR] WebSocket error: ${url}`);
        };
        socket.onclose = () => {
          if (wsClient !== socket) return;
          wsClient = null;
          setHardwareConnected(false);
          appendTerminalLog('sys', '[SYS] WebSocket connection closed.');
          if (wsShouldReconnect && !serialPort) scheduleWebSocketReconnect();
        };
      } catch (error) {
        appendTerminalLog('err', `[ERR] WebSocket connection: ${error.message}`);
        scheduleWebSocketReconnect();
      }
    }

    function scheduleWebSocketReconnect() {
      if (!wsShouldReconnect || !wsLastUrl || wsReconnectTimer) return;
      if (wsReconnectAttempts >= MAX_WS_RECONNECT_ATTEMPTS) {
        appendTerminalLog('err', '[ERR] Automatic reconnect exhausted; check the gateway Wi-Fi.');
        return;
      }
      const delay = Math.min(30000, 1500 * ++wsReconnectAttempts);
      wsReconnectTimer = setTimeout(() => {
        wsReconnectTimer = null;
        connectWebSocket(wsLastUrl, true);
      }, delay);
    }

    function disconnectWebSocket() {
      wsConnectGeneration++;
      wsShouldReconnect = false;
      if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
      const socket = wsClient;
      wsClient = null;
      socket?.close();
      if (!serialPort) setHardwareConnected(false);
      appendTerminalLog('sys', '[SYS] WebSocket disconnected.');
    }

    // ------------------- 指令發送 (Web -> gateway -> MQTT nodes) -------------------
    async function sendHardwareCommand(cmdObj) {
      if (hardwareSessionStarted && (cmdObj.cmd === 'set_power' || cmdObj.cmd === 'all_power')) {
        const targets = cmdObj.cmd === 'set_power' ? [deviceTelemetry.get(cmdObj.id)] : getDeviceRecords();
        if (!targets.length || targets.some(record => !record?.powerControlAvailable || isRecordStale(record))) {
          showToast('Power control unavailable: configure a relay output in the node firmware first.');
          appendTerminalLog('err', '[ERR] Power command blocked: no confirmed relay output or stale node.');
          return false;
        }
      }
      const line = JSON.stringify(cmdObj) + "\n";
      hardwareTxCount++;
      updateBaseStationUI();

      appendTerminalLog('tx', `TX: ${line.trim()}`);

      if (serialWriter) {
        try {
          await serialWriter.write(new TextEncoder().encode(line));
          return true;
        } catch (e) {
          console.warn('Serial write error:', e);
          appendTerminalLog('err', `Serial Write Err: ${e.message}`);
        }
      }

      else if (wsClient && wsClient.readyState === WebSocket.OPEN) {
        try {
          wsClient.send(line);
          return true;
        } catch (e) {
          console.warn('WebSocket send error:', e);
          appendTerminalLog('err', `WebSocket Send Err: ${e.message}`);
        }
      }
      if (!serialWriter && (!wsClient || wsClient.readyState !== WebSocket.OPEN)) {
        appendTerminalLog('sys', '[SYS] Command recorded locally. No live hardware transport is connected.');
      }
      return false;
    }

    // ------------------- 遙測封包解析 (MQTT nodes -> gateway -> Web) -------------------
    function parseHardwarePacket(rawLine) {
      rawLine = rawLine.trim();
      if (!rawLine) return;

      appendTerminalLog('rx', `RX: ${rawLine}`);

      try {
        const data = JSON.parse(rawLine);
        if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;
        if (data.type === 'telemetry' && (!Number.isInteger(data.id) || data.id < 1 || data.id > 255)) {
          appendTerminalLog('err', '[ERR] Ignored telemetry with invalid node ID.');
          return;
        }
        hardwareRxCount++;
        lastHardwarePacketTime = Date.now();
        if (isHardwareConnected && document.getElementById('baseConnBadge')?.classList.contains('stale')) {
          setHardwareConnected(true, document.getElementById('baseEndpointLabel')?.dataset.endpointLabel);
        }

        if (!isHardwareConnected) {
          setHardwareConnected(true, 'Gateway (Active Stream)');
        }

        if (data.type === 'telemetry') {
          let hex = hexagons.find(h => h.id === data.id);
          const hallMask = Number.isInteger(data.hall_mask) && data.hall_mask >= 0 && data.hall_mask <= 63 ? data.hall_mask : null;
          const telemetry = updateTelemetryRecord(data.id, {
            q: data.q,
            r: data.r,
            voltage: data.voltage,
            current: data.current,
            power: data.power,
            temp: data.temp,
            signal: data.rssi,
            enabled: data.enabled !== undefined ? data.enabled : true,
            mac: data.mac,
            status: data.status,
            hallMask,
            halls: hallMask === null ? null : Array.from({ length: 6 }, (_, i) => Boolean(hallMask & (1 << i))),
            configBits: Number.isInteger(data.config_bits) && data.config_bits >= 0 && data.config_bits <= 7 ? data.config_bits : null,
            powerControlAvailable: data.power_control_available === true,
            uptime: data.uptime,
            sequence: data.seq,
            bootId: data.boot_id
          }, TELEMETRY_SOURCE_LIVE);
          // A missing Hall payload must not retain an earlier measurement.
          telemetry.hallMask = hallMask;
          telemetry.halls = hallMask === null ? null : Array.from({ length: 6 }, (_, i) => Boolean(hallMask & (1 << i)));
          telemetry.configBits = Number.isInteger(data.config_bits) ? data.config_bits : null;
          telemetry.bootId = validNeighborUint(data.boot_id, true) ? data.boot_id : null;
          // Missing or malformed identity data clears earlier claims; Hall presence cannot fill them in.
          Object.assign(telemetry, readNeighborPayload(data));
          if (!deviceIds.includes(data.id)) {
            deviceIds.push(data.id);
            deviceIds.sort((a, b) => a - b);
            deviceCount = deviceIds.length;
          }
          if (!hex) {
            const size = Math.min(canvasWidth, canvasHeight) * 0.09 * currentZoom;
            hex = new Hexagon(data.id, numberOr(telemetry.q, 0), numberOr(telemetry.r, 0), size);
            hexagons.push(hex);
          }
          if (hex) {
            hex.power = telemetry.power.toFixed(1);
            hex.temp = telemetry.temp.toFixed(1);
            hex.voltage = telemetry.voltage.toFixed(2);
            hex.current = telemetry.current.toFixed(2);
            hex.enabled = telemetry.enabled;
            hex.signal = parseInt(telemetry.signal);
            hex.q = numberOr(telemetry.q, hex.q);
            hex.r = numberOr(telemetry.r, hex.r);
          }
          activePeerNodes.set(data.id, Date.now());
          appendPowerLog(telemetry);

          // 警報檢測 (過溫 / 電壓異常)
          if (data.temp && data.temp > 60.0) {
            triggerHardwareAlert('danger', `模組 HEX-${String(data.id).padStart(2, '0')} 面板過溫 ${data.temp}°C (超標 > 60°C)`, `HEX-${String(data.id).padStart(2, '0')}`);
          } else if (data.voltage && (data.voltage > 14.5 || data.voltage < 9.0)) {
            triggerHardwareAlert('warning', `模組 HEX-${String(data.id).padStart(2, '0')} 輸出電壓異常: ${data.voltage}V (標準 12.0V)`, `HEX-${String(data.id).padStart(2, '0')}`);
          }

          zoomHex(0);
          updateStats();
          drawAll();
          buildDeviceTable();
          buildPowerLog();
        } else if (data.type === 'node_status') {
          if (Number.isInteger(data.id) && data.id >= 1 && data.id <= 255 && data.status === 'offline') {
            const record = deviceTelemetry.get(data.id);
            if (record?.source === TELEMETRY_SOURCE_LIVE) {
              record.status = 'offline';
              activePeerNodes.delete(data.id);
              buildDeviceTable();
              updateStats();
            }
          }
        } else if (data.type === 'heartbeat') {
          if (data.uptime !== undefined) baseStationUptime = data.uptime;
          if (data.last_rx_ago_ms !== undefined) baseStationLatency = data.last_rx_ago_ms === null ? '--' : data.last_rx_ago_ms + 'ms';
        } else if (data.type === 'ready' || data.type === 'pong') {
          if (data.mac) {
            const macEl = document.getElementById('baseMacDisplay');
            if (macEl) macEl.textContent = 'MAC: ' + data.mac;
            const relayEl = document.getElementById('netRelayNode');
            if (relayEl) relayEl.textContent = data.mac.slice(-8);
          }
          showToast(`✓ Gateway responded [${data.type.toUpperCase()}]`);
        } else if (data.type === 'tx_ack') {
          appendTerminalLog(data.success ? 'sys' : 'err', `[ACK] Node #${data.target}: ${data.stage || 'acknowledged'}; success=${data.success}${data.msg || data.reason ? ': ' + (data.msg || data.reason) : ''}`);
          if (!data.success) showToast(`Command failed for node #${data.target}: ${data.msg || data.reason || data.stage || 'not acknowledged'}`);
        } else if (data.type === 'tx_pending') {
          appendTerminalLog('sys', `[PENDING] Node #${data.target}: ${data.cmd}; waiting for application acknowledgement.`);
        } else if (data.type === 'cmd_error' || data.type === 'error') {
          appendTerminalLog('err', `[ERR] ${data.msg || data.error || data.code || 'Gateway rejected the command'}`);
          showToast(data.msg || data.error || 'Gateway error');
        }
        updateBaseStationUI();
        refreshNeighborTopology();
      } catch (err) {
        appendTerminalLog('sys', `Raw String: ${rawLine}`);
      }
    }

    // ------------------- 即時警報觸發 -------------------
    function triggerHardwareAlert(level, msg, deviceId) {
      const alertList = document.querySelector('.alert-list');
      if (!alertList) return;

      const now = new Date();
      const timeStr = formatSystemTime(now, true);

      const div = document.createElement('div');
      div.className = `alert-item ${level}`;
      div.onclick = function () { ackAlert(this, msg); };
      div.innerHTML = `
    <div class="alert-left">
      <div class="alert-dot"></div>
      <div>
        <div class="alert-device">[${deviceId}] 網關遙測告警</div>
        <div class="alert-msg">${escapeHtml(msg)}</div>
      </div>
    </div>
    <div class="alert-time">今天 ${timeStr}</div>
  `;
      alertList.prepend(div);
      updateNotificationBadge();
      showToast(`⚠️ [${level.toUpperCase()}] ${msg}`);
      sendBrowserNotification(`[${level.toUpperCase()}] ${deviceId}`, msg);
    }

    // ------------------- 測試注入 -------------------
    function injectTestHardwarePacket() {
      if (hardwareSessionStarted) {
        showToast('Test injection is disabled in a hardware session. Reload the page for a separate demo.');
        return;
      }
      const randomNodeId = Math.floor(Math.random() * 8) + 1;
      const volt = (11.85 + Math.random() * 0.5).toFixed(2);
      const cur = (1.1 + Math.random() * 0.4).toFixed(2);
      const pwr = (Math.random() * 7 + 3).toFixed(2);
      const temp = (32 + Math.random() * 6).toFixed(1);
      const rssi = -40 - Math.floor(Math.random() * 25);

      const demoPacket = JSON.stringify({
        type: "telemetry",
        id: randomNodeId,
        q: (randomNodeId % 3) - 1,
        r: Math.floor(randomNodeId / 3) - 1,
        voltage: parseFloat(volt),
        current: parseFloat(cur),
        power: parseFloat(pwr),
        temp: parseFloat(temp),
        rssi: rssi,
        enabled: true,
        mac: `24:6F:28:AA:BB:0${randomNodeId}`,
        uptime: Math.floor(Math.random() * 3600)
      });

      parseHardwarePacket(demoPacket);
      showToast(`🧪 已注入 HEX-0${randomNodeId} 模擬測試封包 (電壓: ${volt}V, 溫度: ${temp}°C)`);
    }

    // ------------------- 數據終端機 (Serial Terminal) -------------------
    function appendTerminalLog(type, msg) {
      const now = new Date();
      const time = formatSystemTime(now, true, true);
      terminalLogs.push({ type, time, msg });
      if (terminalLogs.length > 200) terminalLogs.shift();

      const box = document.getElementById('terminalOutputBox');
      if (box) {
        const row = document.createElement('div');
        row.className = 'term-row';
        row.innerHTML = `<span class="term-time">${time}</span><span class="term-tag ${type}">[${type.toUpperCase()}]</span><span class="term-msg" ${type === 'rx' || type === 'tx' || msg.startsWith('Raw String:') ? 'data-no-i18n' : ''}>${escapeHtml(msg)}</span>`;
        box.appendChild(row);
        box.scrollTop = box.scrollHeight;
      }
    }

    function clearTerminalLogs() {
      terminalLogs = [];
      const box = document.getElementById('terminalOutputBox');
      if (box) box.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:20px">日誌已清空</div>';
      showToast('✓ 終端日誌已清空');
    }

    function openSerialTerminalModal() {
      const rows = terminalLogs.map(l => `
    <div class="term-row">
      <span class="term-time">${l.time}</span>
      <span class="term-tag ${l.type}">[${l.type.toUpperCase()}]</span>
      <span class="term-msg" ${l.type === 'rx' || l.type === 'tx' || l.msg.startsWith('Raw String:') ? 'data-no-i18n' : ''}>${escapeHtml(l.msg)}</span>
    </div>
  `).join('');

      const html = `
    <div style="display:flex; flex-direction:column; gap:10px">
      <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; color:var(--text-secondary)">
        <span>硬體通訊資料監視器 (Web Serial / WebSocket)</span>
        <span style="color:${isHardwareConnected ? 'var(--accent-on)' : 'var(--accent-warning)'}">${isHardwareConnected ? '● 硬體連線中' : '○ 模擬模式中'}</span>
      </div>
      <div class="serial-terminal" id="terminalOutputBox">
        ${rows || '<div style="color:var(--text-muted); text-align:center; padding:20px">暫無通訊紀錄。請連線網關或點擊「注入測試」。</div>'}
      </div>
      <div style="display:flex; gap:8px">
        <input type="text" id="terminalCmdInput" class="settings-input" placeholder='輸入 JSON 指令，例如: {"cmd":"ping"} 或 {"cmd":"set_power","id":1,"enabled":true}' onkeydown="if(event.key==='Enter')sendTerminalInput()">
        <button class="toolbar-btn primary" onclick="sendTerminalInput()">發送</button>
      </div>
    </div>
  `;
      const footer = `
    <button class="toolbar-btn" onclick="injectTestHardwarePacket()">🧪 注入測試數據</button>
    <button class="toolbar-btn" onclick="clearTerminalLogs()">🗑 清除日誌</button>
    <button class="toolbar-btn" onclick="closeModal()">關閉</button>
  `;
      openModal('📟 網關通訊終端機 (Packet Monitor)', html, footer);

      setTimeout(() => {
        const box = document.getElementById('terminalOutputBox');
        if (box) box.scrollTop = box.scrollHeight;
      }, 50);
    }

    async function sendTerminalInput() {
      const input = document.getElementById('terminalCmdInput');
      if (!input) return;
      const val = input.value.trim();
      if (!val) return;
      try {
        const obj = JSON.parse(val);
        if (await sendHardwareCommand(obj)) {
          input.value = '';
          showToast('Command sent; awaiting gateway acknowledgement.');
        }
      } catch (e) {
        showToast('Enter a valid JSON command.');
      }
    }

    // ------------------- ESP32 韌體程式碼檢視與下載 -------------------
    const FIRMWARE_FILES = {
      unoGateway: { path: 'firmware/uno_r4_mqtt_gateway/uno_r4_mqtt_gateway.ino', label: 'UNO R4 MQTT .ino' },
      mqttNode: { path: 'firmware/esp32_mqtt_solar_node/esp32_mqtt_solar_node.ino', label: 'ESP32 MQTT Node .ino' },
      mqttSettings: { path: 'firmware/uno_r4_mqtt_gateway/MqttSettings.h', label: 'MQTT MqttSettings.h' },
      mqttSupport: { path: 'firmware/uno_r4_mqtt_gateway/MqttSupport.h', label: 'MQTT MqttSupport.h' },
      mqttSecrets: { path: 'firmware/uno_r4_mqtt_gateway/Secrets.example.h', label: 'MQTT Secrets.example.h' },
      apConfig: { path: 'firmware/uno_r4_mqtt_gateway/AccessPointConfig.h', label: 'AccessPointConfig.h' },
      apSecrets: { path: 'firmware/uno_r4_mqtt_gateway/AccessPointSecrets.example.h', label: 'AccessPointSecrets.example.h' },
      unoAccessPoint: { path: 'firmware/uno_r4_mqtt_gateway/UnoAccessPoint.h', label: 'UnoAccessPoint.h' },
      mqttNodeConfig: { path: 'firmware/esp32_mqtt_solar_node/NodeConfig.h', label: 'MQTT NodeConfig.h' },
      mqttEdgeIdentity: { path: 'firmware/esp32_mqtt_solar_node/EdgeIdentity.h', label: 'EdgeIdentity.h' },
      mqttEdgeUart: { path: 'firmware/esp32_mqtt_solar_node/Sc16is752.h', label: 'Sc16is752.h' },
      neighborGuide: { path: 'firmware/NEIGHBOR-DETECTION.md', label: 'Neighbor detection wiring' },
      mqttGuide: { path: 'firmware/MQTT.md', label: 'UNO R4 / MQTT setup' },
      gateway: { path: 'firmware/esp32_base_station_gateway/esp32_base_station_gateway.ino', label: 'Legacy gateway .ino' },
      gatewayConfig: { path: 'firmware/esp32_base_station_gateway/GatewayConfig.h', label: 'GatewayConfig.h' },
      gatewayProtocol: { path: 'firmware/esp32_base_station_gateway/SolarProtocol.h', label: 'Gateway SolarProtocol.h' },
      node: { path: 'firmware/esp32_solar_node/esp32_solar_node.ino', label: 'Legacy node .ino' },
      nodeConfig: { path: 'firmware/esp32_solar_node/NodeConfig.h', label: 'NodeConfig.h' },
      nodeProtocol: { path: 'firmware/esp32_solar_node/SolarProtocol.h', label: 'Node SolarProtocol.h' },
      guide: { path: 'firmware/README.md', label: 'README / Wiring' }
    };
    const firmwareSourceCache = new Map();
    let currentFirmwareTab = 'gateway';

    async function loadFirmwareSource(tab) {
      if (firmwareSourceCache.has(tab)) return firmwareSourceCache.get(tab);
      const file = FIRMWARE_FILES[tab];
      if (!file) throw new Error('Unknown firmware file');
      const response = await fetch(file.path, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const content = await response.text();
      if (/^\s*<!doctype html/i.test(content)) throw new Error('Firmware source was not served');
      firmwareSourceCache.set(tab, content);
      return content;
    }

    function openFirmwareModal() {
      const html = `
    <div style="font-size:13px; color:var(--text-secondary)">
      <div class="firmware-tab-nav" style="flex-wrap:wrap">
        ${Object.entries(FIRMWARE_FILES).map(([key, file]) => `<button class="firmware-tab-btn" id="fwTab-${key}" onclick="switchFirmwareTab('${key}')">${file.label}</button>`).join('')}
      </div>
      <p id="firmwareLoadStatus" role="status">Loading repository firmware...</p>
      <div class="code-preview-box" id="firmwareCodeView" data-no-i18n></div>
      <p style="margin-top:10px">MQTT：每個程式資料夾保留 MqttSettings.h、MqttSupport.h、Secrets.example.h、AccessPointConfig.h 及 AccessPointSecrets.example.h；UNO 另需 UnoAccessPoint.h，節點另需 NodeConfig.h。先閱讀 MQTT 設定指南，確認板型及接腳再上傳。</p>
      <p id="firmwareSourceLink" style="margin-top:8px"></p>
    </div>`;
      const footer = `<button class="toolbar-btn" onclick="downloadFirmwareFile()">Download file</button><button class="toolbar-btn primary" onclick="copyFirmwareCode()">Copy source</button><button class="toolbar-btn" onclick="closeModal()">Close</button>`;
      openModal('UNO R4 / ESP32 firmware and wiring', html, footer);
      switchFirmwareTab('unoGateway');
    }

    async function switchFirmwareTab(tab) {
      if (!FIRMWARE_FILES[tab]) return;
      currentFirmwareTab = tab;
      document.querySelectorAll('.firmware-tab-btn').forEach(b => b.classList.remove('active'));
      document.getElementById(`fwTab-${tab}`)?.classList.add('active');
      const codeBox = document.getElementById('firmwareCodeView');
      if (codeBox) codeBox.textContent = '';
      const status = document.getElementById('firmwareLoadStatus');
      if (status) { status.hidden = false; status.textContent = 'Loading repository firmware...'; }
      const link = document.getElementById('firmwareSourceLink');
      if (link) link.innerHTML = `<a href="${FIRMWARE_FILES[tab].path}" download style="color:var(--accent-on)">${FIRMWARE_FILES[tab].path}</a>`;
      try {
        const content = await loadFirmwareSource(tab);
        if (codeBox && currentFirmwareTab === tab) {
          codeBox.textContent = content;
          if (status) status.hidden = true;
        }
      } catch (error) {
        if (status?.isConnected && currentFirmwareTab === tab) status.textContent = `Could not load source (${error.message}). Open the firmware/ folder locally, or serve this console over HTTP/HTTPS. The file link above opens the actual source.`;
      }
    }

    async function copyFirmwareCode() {
      try {
        const content = await loadFirmwareSource(currentFirmwareTab);
        await navigator.clipboard.writeText(content);
        showToast('Firmware source copied.');
      } catch (error) {
        showToast('Cannot copy source: ' + error.message);
      }
    }

    async function downloadFirmwareFile() {
      const tab = currentFirmwareTab;
      try {
        const content = await loadFirmwareSource(tab);
        const filename = FIRMWARE_FILES[tab].path.split('/').pop();
        const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast(`Downloaded: ${filename}`);
      } catch (error) {
        showToast('Cannot download source: ' + error.message + '. Use the source link.');
      }
    }

    function showToast(msg) {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.style.display = 'block';
      clearTimeout(showToast._timer);
      showToast._timer = setTimeout(() => { t.style.display = 'none'; }, 2500);
    }

    const SETTINGS_STORAGE_KEY = 'hex_solar_console_settings';
    const DAILY_SUMMARY_SENT_KEY = 'hex_solar_daily_summary_last_sent';

    function getDefaultSettings() {
      return {
        systemName: '水面智慧浮動太陽能發電系統 - Macau Reservoir Unit 1',
        adminEmail: 'admin@hexagon-solar.mo',
        timezone: 'UTC+08:00 Macau Standard Time',
        protocol: 'UNO R4 AP / MQTT (HexagonSolar/1)',
        baseMac: '24:6F:28:AA:BB:00',
        baudRate: '115200',
        wsUrl: 'ws://127.0.0.1:8081',
        emailNotifications: true,
        webPush: true,
        dailySummary: true,
        dailyVerification: true
      };
    }

    function loadConsoleSettings() {
      try {
        const settings = Object.assign(getDefaultSettings(), JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}'));
        if (['ESP-NOW 2.0 (IEEE 802.11 LR)', 'Wi-Fi/MQTT (UNO R4 gateway)'].includes(settings.protocol)) settings.protocol = getDefaultSettings().protocol;
        return settings;
      } catch (e) {
        return getDefaultSettings();
      }
    }

    function saveConsoleSettings(settings = readConsoleSettingsFromUI()) {
      try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
      } catch (e) { }
      return settings;
    }

    function setInputValue(id, value) {
      const input = document.getElementById(id);
      if (input && value !== undefined) input.value = value;
    }

    function setToggleState(id, active) {
      const toggle = document.getElementById(id);
      if (toggle) toggle.classList.toggle('active', !!active);
    }

    function applyConsoleSettings() {
      const settings = loadConsoleSettings();
      setInputValue('cfgSystemName', settings.systemName);
      setInputValue('cfgAdminEmail', settings.adminEmail);
      setInputValue('cfgTimezone', settings.timezone);
      setInputValue('cfgProtocol', settings.protocol);
      setInputValue('cfgBaseMac', settings.baseMac);
      setInputValue('cfgBaudRate', settings.baudRate);
      setInputValue('cfgWsUrl', settings.wsUrl);
      setToggleState('toggleEmailNotifications', settings.emailNotifications);
      setToggleState('toggleWebPush', settings.webPush);
      setToggleState('toggleDailySummary', settings.dailySummary);
      setToggleState('toggleDailyVerification', settings.dailyVerification);
      updateNotificationBadge();
      window.consoleI18n?.refresh();
    }

    function readConsoleSettingsFromUI() {
      const defaults = getDefaultSettings();
      const read = id => (document.getElementById(id)?.value || '').trim();
      const active = id => !!document.getElementById(id)?.classList.contains('active');
      return {
        systemName: read('cfgSystemName') || defaults.systemName,
        adminEmail: read('cfgAdminEmail') || defaults.adminEmail,
        timezone: read('cfgTimezone') || defaults.timezone,
        protocol: read('cfgProtocol') || defaults.protocol,
        baseMac: read('cfgBaseMac') || defaults.baseMac,
        baudRate: read('cfgBaudRate') || defaults.baudRate,
        wsUrl: read('cfgWsUrl') || defaults.wsUrl,
        emailNotifications: active('toggleEmailNotifications'),
        webPush: active('toggleWebPush'),
        dailySummary: active('toggleDailySummary'),
        dailyVerification: active('toggleDailyVerification')
      };
    }

    // ==================== 通用 Toggle 切換（設定頁所有開關） ====================
    function toggleSwitch(el, label) {
      if (!checkPermission('all', '修改系統硬體與通訊設定 (限管理員)')) return;
      el.classList.toggle('active');
      const on = el.classList.contains('active');
      if (el.id === 'toggleWebPush' && on) requestWebPushPermission();
      saveConsoleSettings();
      updateNotificationBadge();
      showToast((on ? '✓ 開啟 ' : '已關閉 ') + (label || '選項'));
    }

    function handleSaveSettings() {
      if (!checkPermission('all', '儲存系統設定 (限管理員)')) return;
      const settings = saveConsoleSettings();
      if (settings.webPush) requestWebPushPermission();
      showToast('✓ 系統設定已成功儲存');
    }

    function textFromSelector(selector, fallback = '-') {
      const el = document.querySelector(selector);
      return el ? el.textContent.replace(/\s+/g, ' ').trim() : fallback;
    }

    function formatSystemTime(date = new Date(), includeSeconds = false, includeMilliseconds = false) {
      const time = [
        String(date.getHours()).padStart(2, '0'),
        String(date.getMinutes()).padStart(2, '0')
      ];
      if (includeSeconds || includeMilliseconds) time.push(String(date.getSeconds()).padStart(2, '0'));
      let result = time.join(':');
      if (includeMilliseconds) result += `.${String(date.getMilliseconds()).padStart(3, '0')}`;
      return result;
    }

    function getActiveLanguage() {
      return (window.consoleI18n && window.consoleI18n.language) || document.documentElement.lang || 'zh-TW';
    }

    function isChineseLanguage(lang = getActiveLanguage()) {
      return String(lang).toLowerCase().startsWith('zh');
    }

    function buildDailySummaryReportData(lang = getActiveLanguage()) {
      const users = getStoredUsers();
      const user = (currentSession && currentSession.user) || users.admin || AUTH_USERS.admin;
      const now = new Date();
      const chinese = isChineseLanguage(lang);
      const localize = value => window.consoleI18n?.translate(value, lang) || value;
      const records = getDeviceRecords();
      const activeRecords = records.filter(r => r.status === 'online');
      const total = records.length;
      const active = activeRecords.length;
      const offline = records.filter(r => r.status === 'offline').length;
      const idle = Math.max(total - active - offline, 0);
      const totalPower = records.filter(r => r.status !== 'offline').reduce((sum, r) => sum + r.power, 0);
      const peakLoad = Math.max(totalPower, ...powerLogEntries.map(e => e.power));
      const todayGeneration = powerLogEntries.reduce((sum, e) => sum + e.power, 0);
      const avgTemp = activeRecords.length
        ? activeRecords.reduce((sum, r) => sum + r.temp, 0) / activeRecords.length
        : 0;
      const weakSignal = records.filter(r => Number(r.signal) <= -65 && r.status !== 'offline').length;
      const liveMeasurements = hardwareSessionStarted;
      return {
        date: now.toLocaleDateString('zh-TW'),
        time: formatSystemTime(now),
        user: localize(`${user.name} (${user.roleTag || user.role})`),
        lang,
        total,
        active,
        idle,
        offline,
        currentOutput: liveMeasurements ? textFromSelector('#metricCurrentOutput', '--') : `${totalPower.toFixed(1)} kWh`,
        peakLoad: liveMeasurements ? '--' : `${peakLoad.toFixed(1)} kWh`,
        todayGeneration: liveMeasurements ? '--' : `${todayGeneration.toFixed(1)} kWh`,
        weekGeneration: liveMeasurements ? '--' : `${(todayGeneration * 6.2).toFixed(1)} kWh`,
        monthGeneration: liveMeasurements ? '--' : `${(todayGeneration * 25.8).toLocaleString(undefined, { maximumFractionDigits: 1 })} kWh`,
        carbonReduction: liveMeasurements ? '--' : `${(todayGeneration * 0.018).toFixed(2)} t CO2`,
        batteryStored: liveMeasurements ? '--' : '342 kWh / 500 kWh (68.4%)',
        waterSaved: liveMeasurements ? '--' : '12,480 L',
        panelTemp: liveMeasurements ? '--' : localize(avgTemp ? `${avgTemp.toFixed(1)} °C average` : '38.2 °C average'),
        networkMode: localize(textFromSelector('#netHardwareMode', 'Simulation Mode')),
        endpoint: localize(textFromSelector('#baseEndpointLabel', 'Simulation Mode')),
        packets: localize(textFromSelector('#netRxPackets', `${hardwareRxCount} pkts`)),
        txPackets: localize(`${hardwareTxCount} pkts`),
        weakSignal,
        alerts: localize(`INFO 24 / WARNING ${records.filter(r => r.status === 'warning').length} / DANGER ${document.querySelectorAll('.alert-item.danger:not(.acked)').length}`),
        recommendation: weakSignal > 0
          ? (chinese ? '建議檢查 Wi-Fi 訊號較弱的節點，並確認 UNO 熱點覆蓋範圍。' : 'Inspect nodes with weak Wi-Fi signals and confirm UNO access point coverage.')
          : (chinese ? '系統運作正常，請維持例行監控。' : 'System is operating normally. Continue routine monitoring.')
      };
    }

    function buildDailySummaryReportText(data, lang = data.lang || getActiveLanguage()) {
      if (isChineseLanguage(lang)) {
        return [
          '每日摘要報告',
          '水面智慧浮動太陽能發電系統 — 澳門水庫一號機組',
          '',
          `日期：${data.date}`,
          `時間：${data.time}`,
          `產生者：${data.user}`,
          '',
          '系統總覽',
          `- 裝置總數：${data.total}`,
          `- 運行中裝置：${data.active}`,
          `- 待機中裝置：${data.idle}`,
          `- 離線裝置：${data.offline}`,
          `- 弱訊號節點：${data.weakSignal}`,
          '',
          '發電狀態',
          `- 目前輸出：${data.currentOutput}`,
          `- 尖峰負載：${data.peakLoad}`,
          `- 今日發電：${data.todayGeneration}`,
          `- 本週累計：${data.weekGeneration}`,
          `- 本月累計：${data.monthGeneration}`,
          `- 減碳量：${data.carbonReduction}`,
          '',
          '儲能與環境',
          `- 電池儲存：${data.batteryStored}`,
          `- 每日節水量：${data.waterSaved}`,
          `- 面板溫度：${data.panelTemp}`,
          '',
          '網絡狀態',
          `- 數據模式：${data.networkMode}`,
          `- 連線端點：${data.endpoint}`,
          `- 接收封包：${data.packets}`,
          `- 傳送封包：${data.txPackets}`,
          '',
          '警報摘要',
          `- ${data.alerts}`,
          '',
          '建議',
          `- ${data.recommendation}`
        ].join('\n');
      }
      return [
        'Daily Summary Report',
        'Smart Floating Solar Power System - Macau Reservoir Unit 1',
        '',
        `Date: ${data.date}`,
        `Time: ${data.time}`,
        `Generated by: ${data.user}`,
        '',
        'System Overview',
        `- Total devices: ${data.total}`,
        `- Active devices: ${data.active}`,
        `- Idle devices: ${data.idle}`,
        `- Offline devices: ${data.offline}`,
        `- Weak signal nodes: ${data.weakSignal}`,
        '',
        'Generation',
        `- Current output: ${data.currentOutput}`,
        `- Peak load: ${data.peakLoad}`,
        `- Today: ${data.todayGeneration}`,
        `- This week: ${data.weekGeneration}`,
        `- This month: ${data.monthGeneration}`,
        `- Carbon reduction: ${data.carbonReduction}`,
        '',
        'Storage And Environment',
        `- Battery storage: ${data.batteryStored}`,
        `- Daily water savings: ${data.waterSaved}`,
        `- Panel temperature: ${data.panelTemp}`,
        '',
        'Network',
        `- Data mode: ${data.networkMode}`,
        `- Endpoint: ${data.endpoint}`,
        `- RX packets: ${data.packets}`,
        `- TX packets: ${data.txPackets}`,
        '',
        'Alerts',
        `- ${data.alerts}`,
        '',
        'Recommendation',
        `- ${data.recommendation}`
      ].join('\n');
    }

    function openDailySummaryReport() {
      const lang = getActiveLanguage();
      const data = buildDailySummaryReportData(lang);
      const reportText = buildDailySummaryReportText(data, lang);
      const html = `<div style="font-size:13px; color:var(--text-secondary); line-height:1.7">
    <div class="report-summary">
      <div class="stat-card" style="margin:0"><span class="stat-label">今日發電</span><span class="stat-value">${data.todayGeneration}</span></div>
      <div class="stat-card" style="margin:0"><span class="stat-label">運行裝置</span><span class="stat-value">${data.active}/${data.total}</span></div>
      <div class="stat-card" style="margin:0"><span class="stat-label">警報摘要</span><span class="stat-value" style="font-size:14px">${data.alerts}</span></div>
    </div>
    <pre id="dailySummaryReportText" style="white-space:pre-wrap; max-height:360px; overflow:auto; padding:14px; border:1px solid rgba(0,229,200,0.2); border-radius:6px; background:rgba(0,0,0,0.28); color:var(--text-primary); font-family:var(--font-main); font-size:12px">${reportText}</pre>
  </div>`;
      const footer = `
    <button class="toolbar-btn" onclick="closeModal()">關閉</button>
    <button class="toolbar-btn primary" onclick="downloadDailySummaryReport()">下載報告</button>
  `;
      openModal('📄 每日摘要報告', html, footer);
    }

    function downloadDailySummaryReport() {
      const lang = getActiveLanguage();
      const reportText = buildDailySummaryReportText(buildDailySummaryReportData(lang), lang);
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const blob = new Blob([reportText], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `daily_summary_report_${date}.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast('✓ 每日摘要報告已下載');
    }

    function getNotificationEmailAddress() {
      const input = document.getElementById('cfgAdminEmail');
      return (input && input.value.trim()) || 'admin@hexagon-solar.mo';
    }

    function buildEmailNotificationData() {
      const lang = getActiveLanguage();
      const chinese = isChineseLanguage(lang);
      const data = buildDailySummaryReportData(lang);
      const subject = chinese ? `[HEX Solar] 每日摘要報告 - ${data.date}` : `[HEX Solar] Daily Summary - ${data.date}`;
      const body = chinese
        ? [
          '營運團隊您好：',
          '',
          '以下為今日水面浮動太陽能系統摘要。',
          '',
          buildDailySummaryReportText(data, lang),
          '',
          '此通知由管理控制台產生。'
        ].join('\n')
        : [
          'Dear Operations Team,',
          '',
          "Please find today's floating solar system summary below.",
          '',
          buildDailySummaryReportText(data, lang),
          '',
          'This notification was generated from the management console.'
        ].join('\n');
      return { to: getNotificationEmailAddress(), subject, body };
    }

    async function requestWebPushPermission() {
      if (!('Notification' in window)) {
        showToast('此瀏覽器不支援 Web Push 通知');
        setToggleState('toggleWebPush', false);
        saveConsoleSettings();
        return false;
      }
      if (Notification.permission === 'granted') return true;
      if (Notification.permission === 'denied') {
        showToast('瀏覽器已封鎖通知，請在網站設定中重新允許');
        setToggleState('toggleWebPush', false);
        saveConsoleSettings();
        return false;
      }
      const permission = await Notification.requestPermission();
      const granted = permission === 'granted';
      setToggleState('toggleWebPush', granted);
      saveConsoleSettings();
      showToast(granted ? '✓ Web Push 通知已啟用' : 'Web Push 通知未啟用');
      return granted;
    }

    function sendBrowserNotification(title, body) {
      const settings = loadConsoleSettings();
      if (!settings.webPush || !('Notification' in window) || Notification.permission !== 'granted') return;
      try {
        new Notification(title, { body, tag: 'hex-solar-console' });
      } catch (e) { }
    }

    function runDailySummaryNotification(force = false) {
      const settings = loadConsoleSettings();
      if (!settings.dailySummary) return;
      const today = new Date().toISOString().slice(0, 10);
      const previous = localStorage.getItem(DAILY_SUMMARY_SENT_KEY);
      if (!force && previous === today) return;
      localStorage.setItem(DAILY_SUMMARY_SENT_KEY, today);
      const data = buildDailySummaryReportData();
      const chinese = isChineseLanguage();
      const title = chinese ? 'HEX Solar 每日摘要報告' : 'HEX Solar Daily Summary';
      const body = chinese
        ? `今日發電：${data.todayGeneration}；運行裝置：${data.active}/${data.total}；警報：${data.alerts}`
        : `Today: ${data.todayGeneration}; Active: ${data.active}/${data.total}; Alerts: ${data.alerts}`;
      sendBrowserNotification(title, body);
      if (settings.emailNotifications) showToast('每日摘要報告已準備好，可使用 Email 預覽寄送');
    }

    function openEmailNotificationModal() {
      if (!checkPermission('all', '設定 Email 通知 (限管理員)')) return;
      if (!loadConsoleSettings().emailNotifications) {
        showToast('Email 通知尚未啟用');
        return;
      }
      const email = buildEmailNotificationData();
      const html = `<div style="font-size:13px; color:var(--text-secondary); line-height:1.7">
    <div class="settings-group">
      <label class="settings-label">收件人 Email</label>
      <input class="settings-input" id="emailPreviewTo" value="${email.to}">
    </div>
    <div class="settings-group">
      <label class="settings-label">Email 主旨</label>
      <input class="settings-input" id="emailPreviewSubject" value="${email.subject}">
    </div>
    <div class="settings-group" style="margin-bottom:0">
      <label class="settings-label">Email 內容</label>
      <textarea id="emailPreviewBody" class="settings-input" style="height:260px; resize:vertical; line-height:1.5">${email.body}</textarea>
    </div>
  </div>`;
      const footer = `
    <button class="toolbar-btn" onclick="closeModal()">關閉</button>
    <button class="toolbar-btn" onclick="copyEmailNotification()">複製內容</button>
    <button class="toolbar-btn primary" onclick="sendEmailNotification()">開啟 Email</button>
  `;
      openModal('✉ Email 通知預覽', html, footer);
    }

    function readEmailPreview() {
      return {
        to: (document.getElementById('emailPreviewTo')?.value || '').trim(),
        subject: document.getElementById('emailPreviewSubject')?.value || '',
        body: document.getElementById('emailPreviewBody')?.value || ''
      };
    }

    async function copyEmailNotification() {
      const email = readEmailPreview();
      const text = `${consoleI18n.translate('To:')} ${email.to}\n${consoleI18n.translate('Subject:')} ${email.subject}\n\n${email.body}`;
      try {
        await navigator.clipboard.writeText(text);
        showToast('✓ Email 通知內容已複製');
      } catch (e) {
        showToast('複製失敗，請手動全選複製');
      }
    }

    function sendEmailNotification() {
      const email = readEmailPreview();
      if (!email.to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.to)) {
        showToast('請輸入有效的 Email 收件人');
        return;
      }
      const url = `mailto:${encodeURIComponent(email.to)}?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}`;
      window.location.href = url;
      showToast('✓ 已開啟 Email 應用程式');
    }

    // ==================== 面板收合 ====================
    function togglePanel(name) {
      const panel = document.querySelector(`.panel[data-panel="${name}"]`);
      if (panel) {
        panel.classList.toggle('collapsed');
        panel.querySelector('.expand-icon')?.setAttribute('aria-expanded', String(!panel.classList.contains('collapsed')));
      }
    }

    // ==================== Modal 視窗 ====================
    function openModal(title, bodyHtml, footerHtml) {
      if (!document.getElementById('modalRoot').classList.contains('active')) {
        modalReturnFocus = document.activeElement;
        const row = modalReturnFocus.closest('#deviceTableBody tr');
        modalReturnDeviceFocus = row ? {
          id: row.dataset.deviceId,
          idButton: modalReturnFocus.classList.contains('device-id-btn'),
          index: [...row.querySelectorAll('.row-action button')].indexOf(modalReturnFocus)
        } : null;
      }
      document.getElementById('modalTitle').textContent = title || '';
      document.getElementById('modalBody').innerHTML = bodyHtml || '';
      document.getElementById('modalFooter').innerHTML = footerHtml ||
        `<button class="toolbar-btn" onclick="closeModal()">關閉</button>`;
      document.getElementById('modalRoot').classList.add('active');
      document.querySelector('.app-wrapper').inert = true;
      document.body.classList.add('dialog-open');
      requestAnimationFrame(() => {
        if (document.getElementById('modalRoot').classList.contains('active')) {
          (document.querySelector('#modalBody input, #modalBody select, #modalBody button') || document.getElementById('modalBox')).focus();
        }
      });
    }
    function closeModal() {
      document.getElementById('modalRoot').classList.remove('active');
      const loginVisible = !document.getElementById('loginOverlay').classList.contains('hidden');
      document.querySelector('.app-wrapper').inert = loginVisible;
      document.body.classList.toggle('dialog-open', loginVisible);
      if (!loginVisible) {
        let target = modalReturnFocus?.isConnected ? modalReturnFocus : null;
        if (!target && modalReturnDeviceFocus) {
          const row = document.querySelector(`#deviceTableBody tr[data-device-id="${modalReturnDeviceFocus.id}"]`);
          target = modalReturnDeviceFocus.idButton ? row?.querySelector('.device-id-btn') : row?.querySelectorAll('.row-action button')[modalReturnDeviceFocus.index];
        }
        (target || document.querySelector('.nav-item.active'))?.focus({ preventScroll: true });
      }
    }

    // ==================== 頂部列功能 ====================
    function doSearch(q) {
      if (!q || !q.trim()) { showToast('請輸入關鍵字'); return; }
      q = q.trim().toLowerCase();
      const matches = getDeviceRecords().filter(record => {
        const label = `hex-${String(record.id).padStart(2, '0')}`;
        return label.includes(q) || String(record.id) === q;
      });
      const pages = [...document.querySelectorAll('.nav-item')].filter(item =>
        `${item.textContent} ${item.dataset.page}`.toLowerCase().includes(q));
      const results = [
        ...matches.map(record => `<button class="search-result" onclick="viewDevice(${record.id})"><span>HEX-${String(record.id).padStart(2, '0')}</span><span>${escapeHtml(statusLabel(record))} ↗</span></button>`),
        ...pages.map(item => `<button class="search-result" onclick="closeModal(); navigateTo('${item.dataset.page}')"><span>${escapeHtml(item.textContent.trim())}</span><span aria-hidden="true">↗</span></button>`)
      ];
      openModal('搜尋結果', `<p style="margin-bottom:16px">${escapeHtml(q)} · ${results.length}</p><div class="search-results">${results.join('') || '<p>沒有符合的結果</p>'}</div>`);
    }

    function openNotifications() {
      const alerts = [...document.querySelectorAll('#page-alerts .alert-item')];
      const visibleAlerts = alerts.filter(a => !a.classList.contains('acked'));
      const cards = visibleAlerts.map(alert => {
        const clone = alert.cloneNode(true);
        clone.removeAttribute('onclick');
        clone.removeAttribute('role');
        clone.removeAttribute('tabindex');
        return clone.outerHTML;
      });
      const html = `<div style="max-height:50vh; overflow-y:auto; display:flex; flex-direction:column; gap:10px">
    ${cards.length ? cards.join('') : '<div style="color:var(--text-secondary); font-size:13px">目前沒有未確認通知。</div>'}
  </div>`;
      openModal(`🔔 通知中心 (${visibleAlerts.length})`, html, '<button class="toolbar-btn" onclick="closeModal()">關閉</button><button class="toolbar-btn primary" onclick="closeModal(); navigateTo(\'alerts\')">警報日誌</button>');
    }

    function updateNotificationBadge() {
      const badge = document.querySelector('.notification-badge');
      if (!badge) return;
      const count = document.querySelectorAll('#page-alerts .alert-item:not(.acked)').length;
      const label = window.consoleI18n?.translate('Notifications') || 'Notifications';
      badge.innerHTML = `<span data-icon="bell"></span><span>${escapeHtml(label)} (${count})</span>`;
      badge.setAttribute('aria-label', `${label} (${count})`);
      window.refreshWorkspace?.();
    }

    function navToSettings() {
      navigateTo('settings');
      showToast('已跳轉至 系統設定');
    }

    // ==================== 身份驗證 & 使用者管理系統 (Auth & Session System) ====================
    // 安全性加固：全面採用 Salted SHA-256 加密雜湊驗證，原始碼中絕不儲存任何明文密碼，避免 GitHub 開放源碼洩漏
    const AUTH_SALT = "HEX_SOLAR_SALT_MACAU_RESERVOIR_2026";

    // 獨立純 JS SHA-256 演算法 (確保在任何瀏覽器環境、HTTPS、file:/// 協議皆 100% 精準運行)
    function sha256Fallback(ascii) {
      function rightRotate(value, amount) { return (value >>> amount) | (value << (32 - amount)); }
      var mathPow = Math.pow;
      var maxWord = mathPow(2, 32);
      var lengthProperty = 'length';
      var i, j;
      var result = '';
      var words = [];
      var asciiBitLength = ascii[lengthProperty] * 8;
      var hash = [], k = [];
      var primeCounter = 0;
      var isComposite = {};
      for (var candidate = 2; primeCounter < 64; candidate++) {
        if (!isComposite[candidate]) {
          for (i = 0; i < 313; i += candidate) isComposite[i] = candidate;
          hash[primeCounter] = (mathPow(candidate, .5) * maxWord) | 0;
          k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
        }
      }
      ascii += '\x80';
      while (ascii[lengthProperty] % 64 - 56) ascii += '\x00';
      for (i = 0; i < ascii[lengthProperty]; i++) {
        j = ascii.charCodeAt(i);
        if (j >> 8) return;
        words[i >> 2] |= j << ((3 - i) % 4) * 8;
      }
      words[words[lengthProperty]] = ((asciiBitLength / maxWord) | 0);
      words[words[lengthProperty]] = (asciiBitLength) | 0;
      for (j = 0; j < words[lengthProperty];) {
        var w = words.slice(j, j += 16);
        var oldHash = hash;
        hash = hash.slice(0, 8);
        for (i = 0; i < 64; i++) {
          var i2 = i + j;
          var w15 = w[i - 15], w2 = w[i - 2];
          var a = hash[0], e = hash[4];
          var temp1 = hash[7]
            + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
            + ((e & hash[5]) ^ ((~e) & hash[6]))
            + k[i]
            + (w[i] = (i < 16) ? w[i] : (
              w[i - 16]
              + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
              + w[i - 7]
              + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
            ) | 0
            );
          var temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
            + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
          hash = [(temp1 + temp2) | 0].concat(hash);
          hash[4] = (hash[4] + temp1) | 0;
        }
        for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
      }
      for (i = 0; i < 8; i++) {
        for (i2 = 3; i2 >= 0; i2--) {
          var b = (hash[i] >> (8 * i2)) & 255;
          result += ((b < 16) ? 0 : '') + b.toString(16);
        }
      }
      return result;
    }

    async function hashPassword(plainText) {
      if (!plainText) return '';
      const dataStr = plainText + ':' + AUTH_SALT;
      if (window.crypto && window.crypto.subtle) {
        try {
          const enc = new TextEncoder();
          const hashBuffer = await window.crypto.subtle.digest('SHA-256', enc.encode(dataStr));
          const hashArray = Array.from(new Uint8Array(hashBuffer));
          return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        } catch (e) {
          // fallback to JS sha256
        }
      }
      return sha256Fallback(dataStr);
    }

    // 系統預設角色資料庫（僅儲存不可逆之加鹽雜湊密碼，無任何明文密碼）
    const AUTH_USERS = {
      admin: {
        username: 'admin',
        passwordHash: '9e4b2b196eadc981afa0bde6e26a67028ea48c2272479629f498f7f6f5872a45',
        name: 'Admin User',
        role: 'System Administrator',
        roleTag: 'Administrator',
        email: 'admin@hexagon-solar.mo',
        avatar: 'A',
        avatarBg: 'linear-gradient(135deg, #00ffc6, #c77dff)',
        ip: '192.168.1.100 (Macau Base Relay)',
        permissions: ['all']
      },
      operator: {
        username: 'operator',
        passwordHash: '6610daefa18e9d1e3b9d58a7d2f29d933d026b07349f08140d7efb447592b0a5',
        name: 'Field Engineer',
        role: 'Field Maintenance Operator',
        roleTag: 'Operator',
        email: 'operator@hexagon-solar.mo',
        avatar: 'O',
        avatarBg: 'linear-gradient(135deg, #00e5c8, #3b82f6)',
        ip: '192.168.1.124 (Mobile Gateway)',
        permissions: ['control', 'read']
      },
      guest: {
        username: 'guest',
        passwordHash: '8b6e722c5208a4e95355603b87f00eab84f63f79994eb673d9ef4a12ecf7656b',
        name: 'Guest Viewer',
        role: 'Public Viewer (Read-Only)',
        roleTag: 'Guest',
        email: 'guest@hexagon-solar.mo',
        avatar: 'G',
        avatarBg: 'linear-gradient(135deg, #c77dff, #ff6b9d)',
        ip: '192.168.4.15 (Guest Network)',
        permissions: ['read']
      }
    };

    let currentSession = null;

    function getStoredUsers() {
      try {
        const saved = localStorage.getItem('hex_solar_users_custom');
        if (saved) return Object.assign({}, AUTH_USERS, JSON.parse(saved));
      } catch (e) { }
      return AUTH_USERS;
    }

    function saveCustomUsers(users) {
      try {
        localStorage.setItem('hex_solar_users_custom', JSON.stringify(users));
      } catch (e) { }
    }

    function hasPermission(action) {
      const user = currentSession && currentSession.user;
      if (!user || !user.permissions) return false;
      if (user.permissions.includes('all')) return true;
      if (user.permissions.includes(action)) return true;
      return false;
    }

    function checkPermission(action, actionLabel) {
      if (!hasPermission(action)) {
        const user = (currentSession && currentSession.user) || AUTH_USERS.guest;
        showToast(`⛔ 權限不足：[${user.roleTag || user.name}] 無法執行「${actionLabel || '此操作'}」`);
        return false;
      }
      return true;
    }

    function initAuth() {
      try {
        const savedSession = localStorage.getItem('hex_solar_session') || sessionStorage.getItem('hex_solar_session');
        if (savedSession) {
          const parsed = JSON.parse(savedSession);
          const users = getStoredUsers();
          if (users[parsed.username]) {
            currentSession = {
              user: users[parsed.username],
              loginTime: parsed.loginTime || Date.now(),
              remember: !!parsed.remember
            };
            updateUserUI(currentSession.user);
            hideLoginOverlay();
            return;
          }
        }
      } catch (e) {
        console.error('Auth initialization error', e);
      }
      // 預設若無 session 則顯示登入畫面
      showLoginOverlay(false);
    }

    function showLoginOverlay(isLockScreen = false) {
      const overlay = document.getElementById('loginOverlay');
      const title = document.getElementById('loginCardTitle');
      const subtitle = document.getElementById('loginCardSubtitle');
      if (overlay) {
        overlay.classList.remove('hidden');
        document.querySelector('.app-wrapper').inert = true;
        document.body.classList.add('dialog-open');
        document.body.classList.add('auth-locked');
        document.getElementById('loginErrorMsg').classList.remove('active');
        if (isLockScreen && currentSession && currentSession.user) {
          if (title) title.textContent = 'CONSOLE LOCKED';
          if (subtitle) subtitle.textContent = `操作介面已鎖定 • 請輸入 ${currentSession.user.name} 的密碼解鎖`;
          document.getElementById('loginUsername').value = currentSession.user.username;
          document.getElementById('loginPassword').value = '';
          setTimeout(() => {
            const input = document.getElementById('loginPassword');
            if (input) input.focus();
          }, 100);
        } else {
          if (title) title.textContent = 'HEXAGON SOLAR';
          if (subtitle) subtitle.textContent = '水面智慧浮動太陽能發電系統 • 操作控制台';
          setTimeout(() => {
            const input = document.getElementById('loginUsername');
            if (input) input.focus();
          }, 100);
        }
      }
    }

    function hideLoginOverlay() {
      const overlay = document.getElementById('loginOverlay');
      if (overlay) {
        overlay.classList.add('hidden');
        document.body.classList.remove('auth-locked');
        document.querySelector('.app-wrapper').inert = document.getElementById('modalRoot').classList.contains('active');
        document.body.classList.toggle('dialog-open', document.getElementById('modalRoot').classList.contains('active'));
      }
    }

    function lockScreen() {
      closeModal();
      showLoginOverlay(true);
      showToast('🔒 控制台已鎖定');
    }

    function roleSwitchNeedsPassword(fromType, toType) {
      if (!fromType || !toType || fromType === toType) return false;
      if (fromType === 'admin') return false;
      if (fromType === 'operator') return toType === 'admin';
      if (fromType === 'guest') return toType === 'admin' || toType === 'operator';
      return true;
    }

    function completeUserSwitch(u) {
      currentSession = {
        user: { ...u },
        loginTime: Date.now(),
        remember: true
      };
      const sessionData = JSON.stringify({
        username: u.username,
        loginTime: currentSession.loginTime,
        remember: true
      });
      localStorage.setItem('hex_solar_session', sessionData);
      sessionStorage.removeItem('hex_solar_session');

      updateUserUI(currentSession.user);
      showToast(`✓ 已成功切換為 [${u.name} (${u.roleTag || u.role})] 身分`);
    }

    function openRoleSwitchPasswordModal(type) {
      const users = getStoredUsers();
      const target = users[type] || AUTH_USERS[type];
      if (!target) return;
      const html = `<form id="roleSwitchForm" style="font-size:13px; color:var(--text-secondary)" onsubmit="event.preventDefault(); submitRoleSwitchPassword('${type}')">
    <div style="margin-bottom:12px">切換至 <b style="color:var(--accent-on)">${target.username}</b> 需要輸入此帳號密碼。</div>
    <div class="login-input-group" style="margin-bottom:0">
      <label class="login-label" for="roleSwitchPassword">帳號密碼 / Account Password</label>
      <input type="password" id="roleSwitchPassword" class="login-input" placeholder="請輸入 ${target.username} 密碼" style="padding-left:14px" autocomplete="current-password" aria-describedby="roleSwitchError" oninput="clearRoleSwitchPasswordError()">
    </div>
    <p id="roleSwitchError" class="role-switch-error" role="alert" hidden></p>
  </form>`;
      const footer = `
    <button class="toolbar-btn" onclick="closeModal()">取消</button>
    <button type="submit" class="toolbar-btn primary" id="roleSwitchSubmit" form="roleSwitchForm">確認切換</button>
  `;
      openModal('🔐 驗證切換權限', html, footer);
      setTimeout(() => {
        const input = document.getElementById('roleSwitchPassword');
        if (input) input.focus();
      }, 100);
    }

    function clearRoleSwitchPasswordError() {
      document.getElementById('roleSwitchPassword')?.removeAttribute('aria-invalid');
      const error = document.getElementById('roleSwitchError');
      if (error) { error.hidden = true; error.textContent = ''; }
    }

    function showRoleSwitchPasswordError(message) {
      const error = document.getElementById('roleSwitchError');
      const input = document.getElementById('roleSwitchPassword');
      if (!error || !input) return;
      error.textContent = message;
      error.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      input.focus({ preventScroll: true });
      input.select();
    }

    async function submitRoleSwitchPassword(type) {
      const input = document.getElementById('roleSwitchPassword');
      const button = document.getElementById('roleSwitchSubmit');
      if (!input || !button || button.disabled) return;
      const password = input.value;
      const users = getStoredUsers();
      const target = users[type] || AUTH_USERS[type];
      if (!target) return;
      if (!password) {
        showRoleSwitchPasswordError('請輸入帳號密碼');
        return;
      }
      button.disabled = true;
      try {
        const passwordHash = await hashPassword(password);
        // Ignore verification if the user closed the dialog or edited the password.
        if (!input.isConnected || !document.getElementById('modalRoot').classList.contains('active') || input.value !== password) return;
        if (passwordHash !== target.passwordHash && password !== target.password) {
          showRoleSwitchPasswordError('密碼輸入不正確，無法切換帳號');
          return;
        }
        closeModal();
        completeUserSwitch(target);
      } finally {
        if (button.isConnected) button.disabled = false;
      }
    }

    function quickFillAndSwitch(type) {
      const users = getStoredUsers();
      const u = users[type] || AUTH_USERS[type];
      if (!u) return;
      const currentType = (currentSession && currentSession.user && currentSession.user.username) || 'admin';
      if (type === currentType) return;
      if (roleSwitchNeedsPassword(currentType, type)) {
        openRoleSwitchPasswordModal(type);
        return;
      }
      completeUserSwitch(u);
    }

    function togglePasswordVisibility(inputId, btnEl) {
      const input = document.getElementById(inputId);
      if (!input) return;
      if (input.type === 'password') {
        input.type = 'text';
        btnEl.textContent = '🙈';
      } else {
        input.type = 'password';
        btnEl.textContent = '👁';
      }
    }

    async function handleLoginSubmit() {
      const usernameInput = document.getElementById('loginUsername').value.trim();
      const passwordInput = document.getElementById('loginPassword').value;
      const remember = document.getElementById('rememberLogin').checked;
      const btn = document.getElementById('loginSubmitBtn');
      const errorBox = document.getElementById('loginErrorMsg');
      const card = document.getElementById('loginCard');

      if (!usernameInput || !passwordInput) {
        showLoginError('請輸入完整的使用者帳號與密碼');
        return;
      }

      // 登入中按鈕狀態
      btn.disabled = true;
      btn.innerHTML = `<span>⏳</span><span>驗證身分中...</span>`;

      const inputHash = await hashPassword(passwordInput);

      setTimeout(() => {
        const users = getStoredUsers();
        const matchedUser = Object.values(users).find(
          u => u.username.toLowerCase() === usernameInput.toLowerCase() &&
            (u.passwordHash === inputHash || (u.password && u.password === passwordInput))
        );

        if (matchedUser) {
          // 登入成功
          currentSession = {
            user: matchedUser,
            loginTime: Date.now(),
            remember: remember
          };

          const sessionData = JSON.stringify({
            username: matchedUser.username,
            loginTime: currentSession.loginTime,
            remember: remember
          });

          if (remember) {
            localStorage.setItem('hex_solar_session', sessionData);
            sessionStorage.removeItem('hex_solar_session');
          } else {
            sessionStorage.setItem('hex_solar_session', sessionData);
            localStorage.removeItem('hex_solar_session');
          }

          updateUserUI(matchedUser);
          errorBox.classList.remove('active');
          btn.innerHTML = `<span>✓</span><span>ACCESS GRANTED 驗證通過</span>`;
          btn.style.background = 'linear-gradient(135deg, rgba(0, 255, 198, 0.4), rgba(0, 229, 200, 0.6))';

          setTimeout(() => {
            hideLoginOverlay();
            btn.disabled = false;
            btn.innerHTML = `<span>⎆</span><span>VERIFY & LOGIN 驗證登入</span>`;
            btn.style.background = '';
            showToast(`✓ 歡迎回來，${matchedUser.name} (${matchedUser.roleTag})`);
          }, 400);
        } else {
          // 登入失敗
          btn.disabled = false;
          btn.innerHTML = `<span>⎆</span><span>VERIFY & LOGIN 驗證登入</span>`;
          showLoginError('帳號或密碼不正確，請重新檢查後再試');
          card.classList.add('shake');
          setTimeout(() => card.classList.remove('shake'), 400);
        }
      }, 350);
    }

    function showLoginError(msg) {
      const errorBox = document.getElementById('loginErrorMsg');
      const errorText = document.getElementById('loginErrorText');
      if (errorBox && errorText) {
        errorText.textContent = msg;
        errorBox.classList.add('active');
      }
    }

    function updateUserUI(user) {
      if (!user) return;

      // 頂部列更新
      const topAvatar = document.getElementById('topUserAvatar');
      const topName = document.getElementById('topUserName');
      const topRole = document.getElementById('topUserRole');
      if (topAvatar) {
        topAvatar.textContent = user.avatar || user.name.charAt(0);
        if (user.avatarBg) topAvatar.style.background = user.avatarBg;
      }
      if (topName) topName.textContent = user.name;
      if (topRole) topRole.textContent = user.roleTag || user.role;

      // 側邊欄底部更新
      const sideAvatar = document.getElementById('sideUserAvatar');
      const sideName = document.getElementById('sideUserName');
      const sideRole = document.getElementById('sideUserRole');
      if (sideAvatar) {
        sideAvatar.textContent = user.avatar || user.name.charAt(0);
        if (user.avatarBg) sideAvatar.style.background = user.avatarBg;
      }
      if (sideName) sideName.textContent = user.name;
      if (sideRole) sideRole.textContent = user.roleTag || user.role;

      // 訪客唯讀標記
      const guestIndicator = document.getElementById('guestModeIndicator');
      if (guestIndicator) {
        guestIndicator.style.display = (user.username === 'guest' || (user.permissions && user.permissions.length === 1 && user.permissions[0] === 'read')) ? 'inline-block' : 'none';
      }

      // 設定頁 RBAC 卡片狀態同步
      updateRbacCardsUI(user.username);
    }

    function updateRbacCardsUI(currentUsername) {
      const roles = ['admin', 'operator', 'guest'];
      roles.forEach(role => {
        const card = document.getElementById('rbacCard-' + role);
        const btn = document.getElementById('rbacBtn-' + role);
        if (!card || !btn) return;
        const isActive = (role === currentUsername);
        if (isActive) {
          card.classList.add('signed-in');
          btn.className = 'toolbar-btn';
          btn.style.background = 'var(--surface-selected)';
          btn.style.color = 'var(--accent-on)';
          btn.style.borderColor = 'var(--accent-on)';
          btn.innerHTML = '● 目前登入中 (Active)';
        } else {
          card.classList.remove('signed-in');
          btn.className = 'toolbar-btn';
          btn.style.background = '';
          btn.style.color = '';
          btn.style.borderColor = '';
          btn.innerHTML = roleSwitchNeedsPassword(currentUsername, role) ? '🔐 輸入密碼切換' : '🔄 切換至此帳號';
        }
      });
    }

    function performLogout(isSwitch = false) {
      localStorage.removeItem('hex_solar_session');
      sessionStorage.removeItem('hex_solar_session');
      currentSession = null;
      closeModal();
      showLoginOverlay(false);
      document.getElementById('loginPassword').value = '';
      showToast(isSwitch ? '已切換使用者，請登入新帳號' : '✓ 已安全登出系統');
    }

    function openUserMenu() {
      const users = getStoredUsers();
      const user = (currentSession && currentSession.user) || users.admin || AUTH_USERS.admin;
      const loginDuration = currentSession
        ? Math.max(1, Math.floor((Date.now() - currentSession.loginTime) / 60000)) + ' 分鐘'
        : '剛登入';

      const perms = (user.permissions || []).map(p => {
        if (p === 'all') return '<span class="perm-pill active">✓ 全權控制 (All)</span><span class="perm-pill active">✓ 系統設定 (Admin)</span><span class="perm-pill active">✓ 硬體開關 (Control)</span>';
        if (p === 'control') return '<span class="perm-pill active">✓ 硬體開關 (Control)</span><span class="perm-pill active">✓ 裝置新增 (Add Device)</span>';
        if (p === 'read') return '<span class="perm-pill active">✓ 數據檢視 (Read-Only)</span>';
        return `<span class="perm-pill">${p}</span>`;
      }).join(' ');

      const html = `<div style="font-size:13px; color:var(--text-secondary); line-height:1.9">
    <div style="display:flex; align-items:center; gap:16px; margin-bottom:16px; padding-bottom:16px; border-bottom:1px solid rgba(0,229,200,0.2)">
      <div class="user-avatar" style="width:52px; height:52px; font-size:20px; ${user.avatarBg ? 'background:' + user.avatarBg : ''}">
        ${user.avatar || user.name.charAt(0)}
      </div>
      <div>
        <div style="font-size:16px; font-weight:bold; color:var(--accent-on); font-family:var(--font-tech)">${user.name}</div>
        <div style="font-size:12px; color:var(--text-secondary)">${user.email}</div>
        <span class="user-avatar-badge">${user.roleTag || user.role}</span>
      </div>
    </div>

    <div style="background:rgba(0,229,200,0.04); border:1px solid rgba(0,229,200,0.15); border-radius:6px; padding:12px; margin-bottom:16px">
      <div style="display:grid; grid-template-columns:100px 1fr; gap:6px; font-size:12px">
        <span style="color:var(--text-muted)">使用者角色:</span>
        <span style="color:var(--accent-on)">${user.role}</span>
        <span style="color:var(--text-muted)">登入 IP:</span>
        <span style="font-family:var(--font-tech)">${user.ip}</span>
        <span style="color:var(--text-muted)">本次連線:</span>
        <span style="color:var(--accent-purple); font-family:var(--font-tech)">${loginDuration} (Active)</span>
        <span style="color:var(--text-muted)">通訊節點:</span>
        <span style="font-family:var(--font-tech)">UNO R4 AP / MQTT</span>
        <span style="color:var(--text-muted)">授權清單:</span>
        <div style="display:flex; flex-wrap:wrap; gap:2px">${perms}</div>
      </div>
    </div>

    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px">
      <button class="toolbar-btn" style="justify-content:center" onclick="lockScreen()">🔒 鎖定螢幕</button>
      <button class="toolbar-btn" style="justify-content:center" onclick="openChangePasswordModal()">🔑 修改密碼</button>
      <button class="toolbar-btn" style="justify-content:center; grid-column: span 2" onclick="performLogout(true)">🔄 切換使用者帳號</button>
    </div>
  </div>`;

      const footer = `
    <button class="toolbar-btn danger" onclick="performLogout(false)">⏻ 安全登出 Logout</button>
    <button class="toolbar-btn primary" onclick="closeModal()">關閉</button>
  `;
      openModal('👤 使用者資訊與控制', html, footer);
    }

    function openChangePasswordModal() {
      const user = currentSession && currentSession.user;
      if (!user) {
        showToast('請先登入後再修改密碼');
        return;
      }
      const html = `<div style="font-size:13px; color:var(--text-secondary)">
    <div style="margin-bottom:12px">正在修改帳號 <b style="color:var(--accent-on)">${user.username}</b> 之密碼：</div>
    <div class="login-input-group">
      <label class="login-label">原密碼 / Current Password</label>
      <input type="password" id="modalOldPwd" class="login-input" placeholder="請輸入原密碼" style="padding-left:14px">
    </div>
    <div class="login-input-group">
      <label class="login-label">新密碼 / New Password</label>
      <input type="password" id="modalNewPwd" class="login-input" placeholder="請輸入新密碼 (至少 4 位)" style="padding-left:14px">
    </div>
    <div class="login-input-group" style="margin-bottom:0">
      <label class="login-label">確認新密碼 / Confirm New Password</label>
      <input type="password" id="modalConfirmPwd" class="login-input" placeholder="請再次輸入新密碼" style="padding-left:14px">
    </div>
  </div>`;

      const footer = `
    <button class="toolbar-btn" onclick="closeModal()">取消</button>
    <button class="toolbar-btn primary" onclick="submitChangePassword()">確認修改</button>
  `;
      openModal('🔑 修改帳號密碼', html, footer);
    }

    async function submitChangePassword() {
      const oldPwd = document.getElementById('modalOldPwd').value;
      const newPwd = document.getElementById('modalNewPwd').value;
      const confirmPwd = document.getElementById('modalConfirmPwd').value;
      const user = currentSession && currentSession.user;
      if (!user) {
        showToast('請先登入後再修改密碼');
        return;
      }

      if (!oldPwd || !newPwd || !confirmPwd) {
        showToast('請填寫所有密碼欄位');
        return;
      }
      const oldHash = await hashPassword(oldPwd);
      if (oldHash !== user.passwordHash && oldPwd !== user.password) {
        showToast('原密碼輸入不正確');
        return;
      }
      if (newPwd.length < 4) {
        showToast('新密碼長度需大於 4 位');
        return;
      }
      if (newPwd !== confirmPwd) {
        showToast('兩次輸入的新密碼不相符');
        return;
      }

      const newHash = await hashPassword(newPwd);
      const users = getStoredUsers();
      if (users[user.username]) {
        users[user.username].passwordHash = newHash;
        delete users[user.username].password;
        saveCustomUsers(users);
        if (currentSession && currentSession.user) {
          currentSession.user.passwordHash = newHash;
          delete currentSession.user.password;
        }
        openPasswordSavedModal(user.username, newHash);
        showToast('✓ 密碼修改成功，下次請使用新密碼登入');
      }
    }

    function openPasswordSavedModal(username, passwordHash) {
      const html = `<div style="font-size:13px; color:var(--text-secondary); line-height:1.8">
    <div style="margin-bottom:12px">密碼已更新並儲存在此瀏覽器。</div>
    <div style="margin-bottom:12px">若要把新密碼寫入 HTML 預設值，請下載已更新的單檔 HTML。</div>
    <div style="padding:10px; border:1px solid rgba(0,229,200,0.2); background:rgba(0,229,200,0.06); border-radius:6px">
      帳號：<b style="color:var(--accent-on)">${username}</b><br>
      儲存方式：加鹽雜湊密碼，不包含明文密碼
    </div>
  </div>`;
      const footer = `
    <button class="toolbar-btn" onclick="closeModal()">關閉</button>
    <button class="toolbar-btn primary" onclick="downloadHtmlWithPassword('${username}', '${passwordHash}')">下載已更新 HTML</button>
  `;
      openModal('🔑 密碼已更新', html, footer);
    }

    function escapeRegExp(value) {
      return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    async function getCurrentHtmlSource() {
      try {
        const response = await fetch(location.href, { cache: 'no-store' });
        if (response.ok) return await response.text();
      } catch (e) { }
      const doctype = document.doctype ? `<!DOCTYPE ${document.doctype.name}>\n` : '';
      return doctype + document.documentElement.outerHTML;
    }

    async function downloadHtmlWithPassword(username, passwordHash) {
      try {
        let source = await getCurrentHtmlSource();
        const pattern = new RegExp(`(username:\\s*'${escapeRegExp(username)}',[\\s\\S]*?passwordHash:\\s*')[a-f0-9]{64}(')`);
        if (!pattern.test(source)) {
          showToast('無法在 HTML 中找到此帳號密碼欄位');
          return;
        }
        source = source.replace(pattern, `$1${passwordHash}$2`);
        const blob = new Blob([source], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'management-console.html';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast('✓ 已產生包含新密碼的 HTML 檔案');
      } catch (e) {
        showToast('產生 HTML 檔案失敗: ' + e.message);
      }
    }

    // ==================== 裝置管理 ====================
    let deviceCount = 8;
    let deviceIds = Array.from({ length: deviceCount }, (_, i) => i + 1);
    function buildDeviceTable() {
      const tbody = document.getElementById('deviceTableBody');
      if (!tbody) return;
      const focusedAction = tbody.contains(document.activeElement) ? {
        id: document.activeElement.closest('tr')?.dataset.deviceId,
        idButton: document.activeElement.classList.contains('device-id-btn'),
        index: [...document.activeElement.parentElement.children].indexOf(document.activeElement)
      } : null;
      const rows = [];
      getDeviceRecords().forEach(record => {
        const i = record.id;
        rows.push(`<tr data-device-id="${i}" style="cursor:pointer" oncontextmenu="event.preventDefault(); viewDevice(${i}); return false;" ondblclick="viewDevice(${i})">
      <td><button class="device-id-btn" onclick="viewDevice(${i})">HEX-${String(i).padStart(2, '0')}<span data-icon="arrow-up-right"></span></button></td>
      <td style="color:var(--text-secondary); font-size:12px">(${record.q}, ${record.r})</td>
      <td><span class="status-pill ${statusClass(record)}">${statusLabel(record)}</span></td>
      <td style="font-family:var(--font-tech)">${formatMeasurement(record, 'voltage', 2)} V</td>
      <td style="font-family:var(--font-tech)">${formatMeasurement(record, 'temp')} °C</td>
      <td style="color:var(--accent-on)">${formatMeasurement(record, 'signal', 0)} dBm</td>
      <td style="font-family:var(--font-tech); color:var(--accent-purple)">${formatMeasurement(record, 'power', 2)}</td>
      <td style="color:var(--text-muted); font-size:11px">${formatSecondsAgo(record.lastReport)} · ${record.source === TELEMETRY_SOURCE_LIVE ? 'LIVE' : 'SIM'}</td>
      <td>
        <div class="row-action">
          <button onclick="event.stopPropagation(); viewDevice(${i})" title="檢視" aria-label="檢視 HEX-${String(i).padStart(2, '0')}"><span data-icon="eye"></span></button>
          <button onclick="event.stopPropagation(); toggleDevice(${i})" title="啟動/停止" aria-label="啟動/停止 HEX-${String(i).padStart(2, '0')}"><span data-icon="power"></span></button>
          <button class="danger" onclick="event.stopPropagation(); removeDevice(${i}, this)" title="移除" aria-label="移除 HEX-${String(i).padStart(2, '0')}"><span data-icon="x"></span></button>
        </div>
      </td>
    </tr>`);
      });
      tbody.innerHTML = rows.join('');
      if (focusedAction) {
        const row = tbody.querySelector(`tr[data-device-id="${focusedAction.id}"]`);
        const action = focusedAction.idButton ? row?.querySelector('.device-id-btn') : row?.querySelector('.row-action')?.children[focusedAction.index];
        action?.focus({ preventScroll: true });
      }
      window.refreshWorkspace?.();
    }

    function viewDevice(id) {
      const record = ensureDeviceTelemetry(id);
      const hex = hexagons.find(h => h.id === id) || { id, power: record.power.toFixed(1), temp: record.temp.toFixed(1), signal: record.signal, enabled: record.status !== 'offline' };
      const html = `<div style="font-size:13px; color:var(--text-secondary); line-height:2">
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px">
      <div class="stat-card" style="margin:0"><span class="stat-label">裝置 ID</span><span class="stat-value">HEX-${String(id).padStart(2, '0')}</span></div>
      <div class="stat-card" style="margin:0"><span class="stat-label">狀態</span><span class="stat-value" style="color:${hex.enabled ? 'var(--accent-on)' : 'var(--accent-off)'}">${statusLabel(record)}</span></div>
      <div class="stat-card" style="margin:0"><span class="stat-label">發電功率</span><span class="stat-value">${formatMeasurement(record, 'power')} ${record.source === TELEMETRY_SOURCE_LIVE ? 'W' : 'kWh'}</span></div>
      <div class="stat-card" style="margin:0"><span class="stat-label">面板溫度</span><span class="stat-value">${formatMeasurement(record, 'temp')} °C</span></div>
      <div class="stat-card" style="margin:0"><span class="stat-label">訊號</span><span class="stat-value">${formatMeasurement(record, 'signal', 0)} dBm</span></div>
      <div class="stat-card" style="margin:0"><span class="stat-label">韌體版本</span><span class="stat-value" style="font-size:13px">${record.source === TELEMETRY_SOURCE_LIVE ? 'HS1' : 'SIM'}</span></div>
    </div>
    <div style="margin-top:16px; padding:12px; background:rgba(0,229,200,0.05); border-radius:4px; border:1px solid rgba(0,229,200,0.2)">
      <b style="color:var(--accent-on)">MAC 位址：</b>${escapeHtml(record.mac)}<br>
      <b style="color:var(--accent-on)">資料來源：</b>${record.source === TELEMETRY_SOURCE_LIVE ? 'Live telemetry' : 'Simulation sample'}<br>
      <div id="deviceNeighborDetails" data-node-id="${id}">${renderNeighborDetails(id)}</div>
      <b style="color:var(--accent-on)">D6–D8 configuration：</b>${record.configBits === null || record.configBits === undefined ? 'Manual / unavailable' : `D6=${record.configBits & 1}, D7=${(record.configBits >> 1) & 1}, D8=${(record.configBits >> 2) & 1} (1 = grounded); ID=${record.id}`}<br>
      <b style="color:var(--accent-on)">Power control：</b>${record.powerControlAvailable ? 'Configured' : 'Unavailable'}<br>
    </div>
  </div>`;
      const footer = `<button class="toolbar-btn danger" onclick="closeModal()">關閉</button><button class="toolbar-btn primary" onclick="closeModal(); navigateTo('overview')">定位</button>`;
      openModal(`⬢ HEX-${String(id).padStart(2, '0')} 裝置詳情`, html, footer);
    }

    function toggleDevice(id) {
      if (!checkPermission('control', '切換裝置開關')) return;
      if (hardwareSessionStarted) {
        const record = deviceTelemetry.get(id);
        sendHardwareCommand({ cmd: 'set_power', id, enabled: !record?.enabled });
        return;
      }
      const hex = hexagons.find(h => h.id === id);
      if (hex) {
        hex.enabled = !hex.enabled;
        updateTelemetryFromHex(hex);
        updateStats();
        drawAll();
        sendHardwareCommand({ cmd: "set_power", id: id, enabled: hex.enabled });
        showToast(`HEX-${String(id).padStart(2, '0')} 已${hex.enabled ? '啟動 ON' : '停止 OFF'} (Simulation)`);
      } else {
        showToast(`HEX-${String(id).padStart(2, '0')} 狀態已切換`);
      }
      buildDeviceTable();
    }

    function removeDevice(id, btnEl) {
      if (!checkPermission('all', '刪除裝置 (限管理員)')) return;
      if (!confirm(consoleI18n.translate(`確定移除 HEX-${String(id).padStart(2, '0')}？`))) return;
      const tr = btnEl.closest('tr');
      if (tr) {
        tr.style.transition = 'all 0.3s';
        tr.style.opacity = '0';
        tr.style.transform = 'translateX(30px)';
        setTimeout(() => {
          tr.remove();
          if (hexagons.find(h => h.id === id)) {
            hexagons = hexagons.filter(h => h.id !== id);
            buildEdges();
            updateStats();
            drawAll();
          }
          deviceTelemetry.delete(id);
          for (let i = powerLogEntries.length - 1; i >= 0; i--) {
            if (powerLogEntries[i].deviceId === id) powerLogEntries.splice(i, 1);
          }
          deviceIds = deviceIds.filter(deviceId => deviceId !== id);
          deviceCount = deviceIds.length;
          buildPowerLog();
        }, 300);
      }
      showToast(`HEX-${String(id).padStart(2, '0')} 已從管理列表移除`);
    }

    function addDevice() {
      if (!checkPermission('control', '新增裝置')) return;
      const html = `<div style="font-size:13px; color:var(--text-secondary)">
    <div class="settings-group">
      <label class="settings-label">新裝置座標 (q, r)</label>
      <input class="settings-input" id="newDevPos" value="3, -1" placeholder="q, r">
    </div>
    <div class="settings-group">
      <label class="settings-label">ESP32 MAC 最後 2 碼</label>
      <input class="settings-input" id="newDevMac" value="${String(deviceCount + 1).padStart(2, '0')}">
    </div>
    <div class="settings-group">
      <label class="settings-label">初始狀態</label><br>
      <div style="display:flex; gap:10px; align-items:center; margin-top:4px">
        <span>停用</span>
        <div class="toggle-switch active" id="newDevToggle" onclick="toggleSwitch(this)"></div>
        <span>啟用</span>
      </div>
    </div>
  </div>`;
      const footer = `<button class="toolbar-btn" onclick="closeModal()">取消</button><button class="toolbar-btn primary" onclick="confirmAddDevice()">確認新增</button>`;
      openModal('+ 新增六角模組裝置', html, footer);
    }

    function confirmAddDevice() {
      if (!checkPermission('control', '新增裝置')) return;
      const id = deviceIds.length ? Math.max(...deviceIds) + 1 : 1;
      deviceIds.push(id);
      deviceCount = deviceIds.length;
      const size = Math.min(canvasWidth, canvasHeight) * 0.09 * currentZoom;
      const [q, r] = document.getElementById('newDevPos').value.split(',').map(s => parseInt(s.trim()) || 0);
      const enabled = document.getElementById('newDevToggle').classList.contains('active');
      if (canvasWidth > 0) {
        const hex = new Hexagon(id, q, r, size);
        hex.enabled = enabled;
        hexagons.push(hex);
        updateTelemetryFromHex(hex);
        buildEdges();
        updateStats();
        drawAll();
      }
      buildDeviceTable();
      closeModal();
      showToast(`✓ 新裝置 HEX-${String(id).padStart(2, '0')} 已新增成功`);
    }

    function exportDevices() {
      const date = new Date().toISOString().slice(0, 10);
      let csv = consoleI18n.translate('DeviceID,Coordinate,Status,Voltage,Temperature,Signal,Power,LastReport') + '\n';
      getDeviceRecords().forEach(record => {
        csv += `HEX-${String(record.id).padStart(2, '0')},"(${record.q},${record.r})",${consoleI18n.translate(statusLabel(record))},${formatMeasurement(record, 'voltage', 2)},${formatMeasurement(record, 'temp')},${formatMeasurement(record, 'signal', 0)},${formatMeasurement(record, 'power', 2)},${formatSecondsAgo(record.lastReport)} (${record.source})\n`;
      });
      const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `hexagon_devices_${date}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('✓ 裝置列表已匯出 CSV (hexagon_devices_' + date + '.csv)');
    }

    function refreshDevices() {
      buildDeviceTable();
      showToast('✓ 裝置列表已重新整理');
    }

    function navigateTo(page) {
      const target = document.getElementById('page-' + page);
      if (!target) return;
      document.querySelectorAll('.nav-item').forEach(n => {
        n.classList.remove('active');
        n.removeAttribute('aria-current');
      });
      const nav = document.querySelector(`.nav-item[data-page="${page}"]`);
      if (nav) {
        nav.classList.add('active');
        nav.setAttribute('aria-current', 'page');
      }
      document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
      const tgt = document.getElementById('page-' + page);
      if (tgt) tgt.classList.add('active');
      setNavigationOpen(false);
      if (page === 'overview') resizeCanvas();
      const heading = target.querySelector('h1');
      if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
      window.scrollTo({ top: 0, behavior: 'instant' });
    }

    // ==================== 警報日誌 ====================
    function ackAlert(el, name) {
      el.classList.toggle('acked');
      updateNotificationBadge();
      showToast(el.classList.contains('acked') ? `✓ 已確認：${name}` : `已取消確認：${name}`);
    }
    function ackAllAlerts() {
      document.querySelectorAll('.alert-item').forEach(a => a.classList.add('acked'));
      updateNotificationBadge();
      showToast('✓ 所有警報已確認');
    }
    function filterAlerts(level) {
      document.querySelectorAll('.alert-item').forEach(a => {
        if (level === 'info' && !a.classList.contains('warning') && !a.classList.contains('danger')) a.style.display = '';
        else if (level === 'warning') a.style.display = a.classList.contains('warning') ? '' : 'none';
        else if (level === 'danger') a.style.display = a.classList.contains('danger') ? '' : 'none';
        else a.style.display = '';
      });
    }

    // ==================== 發電日誌建構 ====================
    function buildPowerLog() {
      const tbody = document.getElementById('powerLogBody');
      if (!tbody) return;
      seedPowerLog();
      const rows = powerLogEntries.slice(0, 12).map(entry => {
        const dev = entry.deviceId;
        const p = entry.power.toFixed(2);
        const v = entry.voltage.toFixed(2);
        const a = entry.current.toFixed(2);
        const eff = entry.efficiency.toFixed(1);
        const stamp = `${entry.timestamp.toISOString().slice(0, 10)} ${formatSystemTime(entry.timestamp, true)}`;
        return `<tr style="cursor:pointer" onclick="viewDevice(${dev})">
      <td style="font-family:var(--font-tech); color:var(--text-secondary)">${stamp}</td>
      <td style="font-family:var(--font-tech); color:var(--accent-on); cursor:pointer">HEX-${String(dev).padStart(2, '0')} ↗</td>
      <td style="font-family:var(--font-tech); color:var(--accent-purple)">${p}</td>
      <td style="font-family:var(--font-tech)">${v}</td>
      <td style="font-family:var(--font-tech)">${a}</td>
      <td><div class="progress-bar" style="width:80px; display:inline-block; vertical-align:middle; margin:0 8px"><div class="progress-fill" style="width:${eff}%"></div></div>${eff}%</td>
      <td><span class="status-pill ${entry.status === '正常' ? 'online' : 'warning'}">${entry.status}</span></td>
    </tr>`;
      });
      tbody.innerHTML = rows.join('');
      updatePowerSummaryUI();
    }

    // ==================== 儲存監控互動 ====================
    document.addEventListener('click', (e) => {
      const card = e.target.closest('.storage-card-click, .stat-card');
      if (card && e.target.closest('#page-storage')) {
        const label = card.querySelector('.stat-label');
        if (label) showToast(`📊 ${label.textContent || '儲存資訊'}：已顯示即時資料`);
      }
    });

    // ==================== 修復 Base station toggle 缺少 this 傳遞 ====================
    document.addEventListener('DOMContentLoaded', () => {
      const baseToggle = document.querySelector('.base-station .toggle-switch');
      if (baseToggle && !baseToggle.onclick) {
        baseToggle.onclick = () => toggleBase(baseToggle);
      }
    });

    // ==================== 模擬即時更新 ====================
    function startSimulation() {
      if (simulationInterval) clearInterval(simulationInterval);
      simulationInterval = setInterval(() => {
        if (hardwareSessionStarted || isHardwareConnected) return;
        hexagons.forEach(h => {
          if (h.enabled) {
            h.power = (Math.random() * 8 + 2).toFixed(1);
            h.temp = (30 + Math.random() * 12).toFixed(1);
            const record = updateTelemetryFromHex(h);
            if (Math.random() > 0.55) appendPowerLog(record);
          }
        });
        if (hexagons.length > 0 && viewMode !== 'id') drawAll();
        buildDeviceTable();
        buildPowerLog();
      }, 3500);
    }

    // ==================== 初始化 ====================
    window.addEventListener('solar-language-change', () => {
      updateNotificationBadge();
      window.refreshWorkspace?.();
      const report = document.getElementById('dailySummaryReportText');
      if (report && document.getElementById('modalRoot').classList.contains('active')) {
        const data = buildDailySummaryReportData();
        report.textContent = buildDailySummaryReportText(data);
        const alerts = document.querySelector('#modalBody .report-summary .stat-card:last-child .stat-value');
        if (alerts) alerts.textContent = data.alerts;
      }
    });
    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('focus', refreshNeighborTopology);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refreshNeighborTopology();
    });
    const canvasResizeObserver = new ResizeObserver(resizeCanvas);
    canvasResizeObserver.observe(canvas.parentElement);
    window.addEventListener('load', () => {
      initAuth();
      applyConsoleSettings();
      resizeCanvas();
      setTimeout(generateDefault, 100);
      buildDeviceTable();
      buildPowerLog();
      startSimulation();
      startConnectionHealthMonitor();
      updateBaseStationUI();
      updateNotificationBadge();
      setTimeout(() => runDailySummaryNotification(false), 1200);
      // 修復：儲存監控頁面 stat-card 加上點擊效果
      setTimeout(() => {
        document.querySelectorAll('#page-storage .stat-card').forEach(c => c.classList.add('storage-card-click'));
      }, 50);
    });
