// ==================== 變數初始化 ====================
    const canvas = document.getElementById('hexCanvas');
    const ctx = canvas.getContext('2d');
    let hexagons = [];
    let edges = [];
    let hexPaths = [];
    let showLabels = true;
    let viewMode = 'id';
    let currentZoom = 1;
    let offsetX = 0, offsetY = 0;

    // ==================== 實體 ESP-NOW / Web Serial / WebSocket 變數 ====================
    let isHardwareConnected = false;
    let serialPort = null;
    let serialReader = null;
    let serialWriter = null;
    let serialKeepReading = false;
    let wsClient = null;
    let hardwareRxCount = 0;
    let hardwareTxCount = 0;
    let lastHardwarePacketTime = 0;
    let baseStationUptime = 0;
    let baseStationLatency = '12ms';
    let activePeerNodes = new Map(); // id -> lastSeenTimestamp
    let terminalLogs = [];           // { type: 'rx'|'tx'|'sys'|'err', time: string, msg: string }
    let simulationInterval = null;

    // ==================== 畫布初始化 ====================
    function resizeCanvas() {
      const wrapper = canvas.parentElement;
      canvas.width = wrapper.clientWidth;
      canvas.height = 600;
      if (hexagons.length > 0) drawAll();
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
        const cx = canvas.width / 2 + hexWidth * (q + r * 0.5);
        const cy = canvas.height / 2 + hexHeight * r;
        this.centerX = cx;
        this.centerY = cy;
        this.enabled = id === 1 || id === 5;
        this.power = (Math.random() * 8 + 2).toFixed(1);
        this.temp = (30 + Math.random() * 12).toFixed(1);
        this.signal = -40 - Math.floor(Math.random() * 30);
        this.voltage = 12.05;
        this.current = 0.55;
        this.vertices = this.calcVertices();
      }
      calcVertices() {
        const v = [];
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI / 3) * i - Math.PI / 6;
          v.push({
            x: this.centerX + this.size * Math.cos(angle),
            y: this.centerY + this.size * Math.sin(angle)
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
        if (this.enabled) {
          fill = 'rgba(0, 229, 200, 0.12)';
          stroke = '#00e5c8';
          glow = 'rgba(0, 229, 200, 0.7)';
        } else {
          fill = 'rgba(255, 107, 157, 0.08)';
          stroke = '#ff6b9d';
          glow = 'rgba(255, 107, 157, 0.5)';
        }
        if (viewMode === 'power' && this.enabled) {
          const p = parseFloat(this.power) / 10;
          fill = `rgba(0, 229, 200, ${0.05 + p * 0.25})`;
        } else if (viewMode === 'temp') {
          const t = (parseFloat(this.temp) - 30) / 15;
          fill = `rgba(${200 * t}, ${229 * (1 - t)}, 200, 0.2)`;
          stroke = `rgb(${255 * t}, ${229 * (1 - t / 2)}, ${200 * (1 - t)})`;
        } else if (viewMode === 'signal') {
          const s = (this.signal + 80) / 40;
          fill = `rgba(199, 125, 255, ${0.05 + s * 0.2})`;
        }
        ctx.shadowColor = glow;
        ctx.shadowBlur = 15;
        ctx.beginPath();
        ctx.moveTo(this.vertices[0].x, this.vertices[0].y);
        for (let i = 1; i < 6; i++) ctx.lineTo(this.vertices[i].x, this.vertices[i].y);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.shadowBlur = 8;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.shadowBlur = 0;

        if (showLabels) {
          ctx.fillStyle = this.enabled ? '#00ffc6' : '#ff6b9d';
          ctx.font = 'bold 14px Orbitron, monospace';
          ctx.textAlign = 'center';
          ctx.shadowColor = glow;
          ctx.shadowBlur = 10;
          ctx.fillText(`ID:${this.id}`, this.centerX, this.centerY - 12);
          ctx.font = '12px "Noto Sans TC", Orbitron, monospace';
          const statusText = this.enabled ? 'ON' : 'OFF';
          ctx.fillStyle = this.enabled ? '#00ffc6' : '#ff6b9d';
          ctx.fillText(window.consoleI18n?.translate(statusText) || statusText, this.centerX, this.centerY + 12);
          ctx.shadowBlur = 0;
          ctx.font = '10px Noto Sans TC';
          ctx.fillStyle = '#7dd6c9';
          if (viewMode === 'power' && this.enabled) {
            ctx.fillText(`${this.power} kWh`, this.centerX, this.centerY + 28);
          } else if (viewMode === 'temp') {
            ctx.fillText(`${this.temp}°C`, this.centerX, this.centerY + 28);
          } else if (viewMode === 'signal') {
            ctx.fillText(`${this.signal}dBm`, this.centerX, this.centerY + 28);
          }
        }
        ctx.restore();
      }
    }

    // ==================== 畫布繪製控制 ====================
    function clearCanvas() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      hexagons = [];
      edges = [];
      hexPaths = [];
      updateStats();
    }

    function generateDefault() {
      clearCanvas();
      const size = Math.min(canvas.width, canvas.height) * 0.09;
      const positions = [
        [0, 0], [1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1], [2, -1]
      ];
      positions.forEach((p, i) => {
        const hex = new Hexagon(i + 1, p[0], p[1], size);
        hexagons.push(hex);
      });
      buildEdges();
      updateStats();
      drawAll();
    }

    function buildEdges() {
      edges = [];
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
        ctx.strokeStyle = 'rgba(0, 229, 200, 0.35)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(e.from.centerX, e.from.centerY);
        ctx.lineTo(e.to.centerX, e.to.centerY);
        ctx.stroke();
        ctx.restore();
      });
    }

    function findPath() {
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
        showToast(`✓ 歐亞迴路找到！長度 ${result.length} 節點 (巡檢路徑已發送至 ESP-NOW)`);
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
      ctx.clearRect(0, 0, canvas.width, canvas.height);
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
      drawAll();
    }

    function setViewMode(mode) {
      viewMode = mode;
      document.querySelectorAll('.control-buttons .control-btn').forEach((b, idx) => {
        const modes = ['id', 'power', 'temp', 'signal'];
        b.classList.toggle('active', modes[idx] === mode);
      });
      drawAll();
    }

    function allOn() {
      if (!checkPermission('control', '全部啟動模組')) return;
      hexagons.forEach(h => h.enabled = true);
      updateStats();
      drawAll();
      sendHardwareCommand({ cmd: "all_power", enabled: true });
      showToast('✓ 所有裝置已啟動 (ESP-NOW 指令已廣播)');
    }

    function allOff() {
      if (!checkPermission('control', '全部停止模組')) return;
      hexagons.forEach(h => h.enabled = false);
      updateStats();
      drawAll();
      sendHardwareCommand({ cmd: "all_power", enabled: false });
      showToast('所有裝置已停止 (ESP-NOW 指令已廣播)');
    }

    function zoomHex(delta) {
      if (hexagons.length === 0) return;
      currentZoom = Math.max(0.5, Math.min(2, currentZoom + delta));
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const size = Math.min(canvas.width, canvas.height) * 0.09 * currentZoom;
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
      if (hexagons.length > 0) generateDefault();
    }

    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      for (const h of hexagons) {
        if (h.containsPoint(x, y)) {
          if (!checkPermission('control', '切換模組電源')) return;
          h.enabled = !h.enabled;
          updateStats();
          drawAll();
          sendHardwareCommand({ cmd: "set_power", id: h.id, enabled: h.enabled });
          showToast(`模組 ID-${h.id} 已${h.enabled ? '啟動 ON' : '停止 OFF'} (ESP-NOW 指令已下發)`);
          break;
        }
      }
    });

    // ==================== 頁面切換 ====================
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        item.classList.add('active');
        const page = item.dataset.page;
        document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
        document.getElementById('page-' + page).classList.add('active');
      });
    });

    // ==================== 小工具 & 全域函式 ====================
    function updateStats() {
      const total = hexagons.length;
      const active = hexagons.filter(h => h.enabled).length;
      document.getElementById('statTotal').textContent = total || '8';
      document.getElementById('statActive').textContent = active;
      document.getElementById('statIdle').textContent = Math.max(0, (total || 8) - active);
      document.getElementById('statOffline').textContent = '0';
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

    // ==================== ESP-NOW & 硬體直連通訊模組 ====================

    function updateBaseStationUI() {
      const now = Date.now();
      let liveCount = 0;
      activePeerNodes.forEach((time, id) => {
        if (now - time < 15000) liveCount++;
      });
      if (!isHardwareConnected) {
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
      isHardwareConnected = connected;
      const badge = document.getElementById('baseConnBadge');
      const btnText = document.getElementById('btnSerialText');
      const endp = document.getElementById('baseEndpointLabel');
      const netDot = document.getElementById('netStatusDot');
      const netStatus = document.getElementById('netStatusText');
      const netMode = document.getElementById('netHardwareMode');
      const netModeDot = document.getElementById('netModeDot');

      if (connected) {
        if (badge) {
          badge.textContent = '🟢 HARDWARE LIVE 直連硬體';
          badge.className = 'status-pill online';
          badge.style.cursor = 'pointer';
        }
        if (btnText) btnText.textContent = '斷開 ESP32 (USB)';
        if (endp) endp.textContent = endpointLabel || 'ESP32 Connected';
        if (netDot) netDot.className = 'status-dot';
        if (netStatus) netStatus.textContent = 'ESP-NOW Active (Live)';
        if (netModeDot) netModeDot.className = 'status-dot';
        if (netMode) {
          netMode.textContent = 'Real Hardware Mode (ESP32)';
          netMode.style.color = 'var(--accent-on)';
        }
      } else {
        if (badge) {
          badge.textContent = '🟡 SIMULATION 模擬';
          badge.className = 'status-pill warning';
          badge.style.cursor = 'pointer';
        }
        if (btnText) btnText.textContent = '連線 ESP32 (USB Serial)';
        if (endp) endp.textContent = '未連接 (模擬模式運行中)';
        if (netStatus) netStatus.textContent = 'Standby (Simulation)';
        if (netModeDot) netModeDot.className = 'status-dot warn';
        if (netMode) {
          netMode.textContent = 'Simulation Mode';
          netMode.style.color = 'var(--accent-warning)';
        }
      }
      updateBaseStationUI();
    }

    function toggleBaseMode() {
      if (isHardwareConnected) {
        if (confirm(consoleI18n.translate('是否中斷實體硬體連線並返回模擬模式？'))) {
          if (serialPort) disconnectSerial();
          if (wsClient) disconnectWebSocket();
          setHardwareConnected(false);
          showToast('已切換回模擬模式');
        }
      } else {
        handleConnectSerial();
      }
    }

    function toggleBase(el) {
      if (!checkPermission('control', 'ESP-NOW 基站連線')) return;
      toggleBaseMode();
    }

    // ------------------- Web Serial API (USB 串列通訊) -------------------
    async function handleConnectSerial() {
      if (!checkPermission('control', 'ESP-NOW 串列埠連線')) return;

      if (serialPort) {
        await disconnectSerial();
        return;
      }

      if (!('serial' in navigator)) {
        openModal('⚠️ 不支援 Web Serial API', `
      <div style="font-size:13px; color:var(--text-secondary); line-height:1.8">
        您的瀏覽器尚未支援或未啟用 <b>Web Serial API</b>。<br><br>
        • 建議使用電腦端 <b style="color:var(--accent-on)">Google Chrome</b> 或 <b style="color:var(--accent-on)">Microsoft Edge</b> 瀏覽器。<br>
        • 若使用手機或 Firefox/Safari，請改用 <b>「📶 Wi-Fi 網關 (WebSocket)」</b> 連線方式。<br>
        • 或點選下方「注入測試」以體驗 ESP-NOW 數據封包解析管線！
      </div>
    `, `<button class="toolbar-btn primary" onclick="injectTestHardwarePacket(); closeModal()">🧪 模擬硬體封包注入</button><button class="toolbar-btn" onclick="closeModal()">關閉</button>`);
        return;
      }

      try {
        const baudRate = parseInt(document.getElementById('cfgBaudRate')?.value || '115200');
        showToast('請在瀏覽器彈出視窗選擇 ESP32 串列埠...');
        serialPort = await navigator.serial.requestPort();
        await serialPort.open({ baudRate: baudRate });

        const textEncoder = new TextEncoderStream();
        textEncoder.readable.pipeTo(serialPort.writable);
        serialWriter = textEncoder.writable.getWriter();

        setHardwareConnected(true, `USB Serial (${baudRate} baud)`);
        showToast(`✓ 成功連線 ESP32 基站 (${baudRate} baud)！`);
        appendTerminalLog('sys', `[SYS] Web Serial port opened successfully at ${baudRate} baud.`);

        // 宣布連線並查詢基站 MAC
        sendHardwareCommand({ cmd: "ping" });

        serialKeepReading = true;
        readSerialLoop();
      } catch (err) {
        console.error('Serial connect error:', err);
        if (err.name !== 'NotFoundError') {
          showToast('串列埠連線失敗: ' + err.message);
          appendTerminalLog('err', `[ERR] Serial error: ${err.message}`);
        }
        serialPort = null;
        serialWriter = null;
      }
    }

    async function readSerialLoop() {
      let partialBuffer = '';
      while (serialPort && serialPort.readable && serialKeepReading) {
        const textDecoder = new TextDecoderStream();
        serialPort.readable.pipeTo(textDecoder.writable);
        serialReader = textDecoder.readable.getReader();
        try {
          while (true) {
            const { value, done } = await serialReader.read();
            if (done) break;
            if (value) {
              partialBuffer += value;
              const lines = partialBuffer.split(/\r?\n/);
              partialBuffer = lines.pop(); // 保留未完整的尾巴
              for (const line of lines) {
                if (line.trim().length > 0) {
                  parseHardwarePacket(line);
                }
              }
            }
          }
        } catch (error) {
          console.warn('Serial reader error:', error);
          appendTerminalLog('err', `[ERR] Read stream error: ${error.message}`);
          break;
        } finally {
          serialReader.releaseLock();
        }
      }
    }

    async function disconnectSerial() {
      serialKeepReading = false;
      if (serialReader) {
        try { await serialReader.cancel(); } catch (e) { }
      }
      if (serialWriter) {
        try { await serialWriter.close(); } catch (e) { }
      }
      if (serialPort) {
        try { await serialPort.close(); } catch (e) { }
      }
      serialPort = null;
      serialReader = null;
      serialWriter = null;
      setHardwareConnected(false);
      showToast('ESP32 串列埠已安全中斷');
      appendTerminalLog('sys', '[SYS] USB Serial port disconnected.');
    }

    // ------------------- WebSocket (Wi-Fi 網關) -------------------
    function openWsConnectModal() {
      const currentWs = document.getElementById('cfgWsUrl')?.value || 'ws://192.168.4.1:81';
      const html = `
    <div style="font-size:13px; color:var(--text-secondary); line-height:1.8">
      <p style="margin-bottom:12px">透過 Wi-Fi 無線連接 ESP32 網關中繼基站 (ESP32 AP 預設 IP: 192.168.4.1)</p>
      <div class="settings-group">
        <label class="settings-label">WebSocket URL</label>
        <input class="settings-input" id="modalWsUrlInput" value="${currentWs}">
      </div>
      <div style="font-size:11px; color:var(--text-muted); background:rgba(0,229,200,0.05); padding:10px; border-radius:4px; border:1px solid rgba(0,229,200,0.2)">
        💡 <b>連線提示：</b><br>
        1. 請先確保電腦/手機 Wi-Fi 已連接至 ESP32 基地台熱點：<b style="color:var(--accent-on)">HexagonSolar-BaseGateway</b> (密碼: <span style="font-family:var(--font-tech)">hexagonsolar888</span>)<br>
        2. 若 ESP32 與電腦在同一個局域網路，請填入 ESP32 的區域 IP 位址 (例如 <code>ws://192.168.1.150:81</code>)。
      </div>
    </div>
  `;
      const footer = `
    <button class="toolbar-btn" onclick="closeModal()">取消</button>
    <button class="toolbar-btn primary" onclick="confirmConnectWebSocket()">連線 Wi-Fi 網關</button>
  `;
      openModal('📶 連線 ESP32 Wi-Fi 網關', html, footer);
    }

    function confirmConnectWebSocket() {
      const url = document.getElementById('modalWsUrlInput')?.value.trim();
      closeModal();
      if (!url) return;
      connectWebSocket(url);
    }

    function connectWebSocket(url) {
      if (wsClient) {
        wsClient.close();
        wsClient = null;
      }
      showToast('連線中: ' + url);
      appendTerminalLog('sys', `[SYS] Connecting WebSocket to ${url}...`);

      try {
        wsClient = new WebSocket(url);
        wsClient.onopen = () => {
          setHardwareConnected(true, `Wi-Fi (${url})`);
          showToast('✓ 成功連線 ESP32 Wi-Fi 網關！');
          appendTerminalLog('sys', `[SYS] WebSocket connected successfully.`);
          sendHardwareCommand({ cmd: "ping" });
        };
        wsClient.onmessage = (evt) => {
          if (evt.data) {
            parseHardwarePacket(evt.data);
          }
        };
        wsClient.onerror = (err) => {
          appendTerminalLog('err', `[ERR] WebSocket error: ${url}`);
          showToast('WebSocket 連線異常');
        };
        wsClient.onclose = () => {
          appendTerminalLog('sys', `[SYS] WebSocket connection closed.`);
          if (isHardwareConnected && !serialPort) {
            setHardwareConnected(false);
          }
        };
      } catch (e) {
        showToast('連線錯誤: ' + e.message);
      }
    }

    function disconnectWebSocket() {
      if (wsClient) {
        wsClient.close();
        wsClient = null;
      }
      setHardwareConnected(false);
      appendTerminalLog('sys', '[SYS] WebSocket disconnected.');
    }

    // ------------------- 指令發送 (Web -> ESP32 -> ESP-NOW) -------------------
    async function sendHardwareCommand(cmdObj) {
      const line = JSON.stringify(cmdObj) + "\n";
      hardwareTxCount++;
      updateBaseStationUI();

      appendTerminalLog('tx', `TX: ${line.trim()}`);

      if (serialWriter) {
        try {
          await serialWriter.write(line);
        } catch (e) {
          console.warn('Serial write error:', e);
          appendTerminalLog('err', `Serial Write Err: ${e.message}`);
        }
      }

      if (wsClient && wsClient.readyState === WebSocket.OPEN) {
        try {
          wsClient.send(line);
        } catch (e) {
          console.warn('WebSocket send error:', e);
          appendTerminalLog('err', `WebSocket Send Err: ${e.message}`);
        }
      }
    }

    // ------------------- 遙測封包解析 (ESP-NOW -> ESP32 -> Web) -------------------
    function parseHardwarePacket(rawLine) {
      rawLine = rawLine.trim();
      if (!rawLine) return;

      appendTerminalLog('rx', `RX: ${rawLine}`);

      try {
        const data = JSON.parse(rawLine);
        hardwareRxCount++;
        lastHardwarePacketTime = Date.now();

        if (!isHardwareConnected) {
          setHardwareConnected(true, 'ESP-NOW Gateway (Active Stream)');
        }

        if (data.type === 'telemetry') {
          let hex = hexagons.find(h => h.id === data.id);
          if (hex) {
            if (data.power !== undefined) hex.power = parseFloat(data.power).toFixed(1);
            if (data.temp !== undefined) hex.temp = parseFloat(data.temp).toFixed(1);
            if (data.voltage !== undefined) hex.voltage = parseFloat(data.voltage).toFixed(2);
            if (data.current !== undefined) hex.current = parseFloat(data.current).toFixed(2);
            if (data.enabled !== undefined) hex.enabled = !!data.enabled;
            if (data.rssi !== undefined) hex.signal = parseInt(data.rssi);
          }
          activePeerNodes.set(data.id, Date.now());

          // 警報檢測 (過溫 / 電壓異常)
          if (data.temp && data.temp > 60.0) {
            triggerHardwareAlert('danger', `模組 HEX-${String(data.id).padStart(2, '0')} 面板過溫 ${data.temp}°C (超標 > 60°C)`, `HEX-${String(data.id).padStart(2, '0')}`);
          } else if (data.voltage && (data.voltage > 14.5 || data.voltage < 9.0)) {
            triggerHardwareAlert('warning', `模組 HEX-${String(data.id).padStart(2, '0')} 輸出電壓異常: ${data.voltage}V (標準 12.0V)`, `HEX-${String(data.id).padStart(2, '0')}`);
          }

          updateStats();
          drawAll();
          buildDeviceTable();
        } else if (data.type === 'heartbeat') {
          if (data.uptime !== undefined) baseStationUptime = data.uptime;
          if (data.last_rx_ago_ms !== undefined) baseStationLatency = data.last_rx_ago_ms + 'ms';
        } else if (data.type === 'ready' || data.type === 'pong') {
          if (data.mac) {
            const macEl = document.getElementById('baseMacDisplay');
            if (macEl) macEl.textContent = 'MAC: ' + data.mac;
            const relayEl = document.getElementById('netRelayNode');
            if (relayEl) relayEl.textContent = data.mac.slice(-8);
          }
          showToast(`✓ ESP-NOW 基站已應答 [${data.type.toUpperCase()}]`);
        } else if (data.type === 'tx_ack') {
          appendTerminalLog('sys', `[ACK] Command sent to target node #${data.target} (Success: ${data.success})`);
        }
        updateBaseStationUI();
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
        <div class="alert-device">[${deviceId}] ESP-NOW 遙測告警</div>
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
      showToast(`🧪 已注入 HEX-0${randomNodeId} 真實 ESP-NOW 封包 (電壓: ${volt}V, 溫度: ${temp}°C)`);
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
        <span>ESP-NOW 實體通訊數據流監視器 (Web Serial / WebSocket Stream)</span>
        <span style="color:${isHardwareConnected ? 'var(--accent-on)' : 'var(--accent-warning)'}">${isHardwareConnected ? '● 硬體連線中' : '○ 模擬模式中'}</span>
      </div>
      <div class="serial-terminal" id="terminalOutputBox">
        ${rows || '<div style="color:var(--text-muted); text-align:center; padding:20px">暫無通訊紀錄。請連線實體 ESP32 或點擊「注入測試」。</div>'}
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
      openModal('📟 ESP-NOW 通訊終端機 (Packet Monitor)', html, footer);

      setTimeout(() => {
        const box = document.getElementById('terminalOutputBox');
        if (box) box.scrollTop = box.scrollHeight;
      }, 50);
    }

    function sendTerminalInput() {
      const input = document.getElementById('terminalCmdInput');
      if (!input) return;
      const val = input.value.trim();
      if (!val) return;
      try {
        const obj = JSON.parse(val);
        sendHardwareCommand(obj);
        input.value = '';
        showToast('✓ 指令已發送');
      } catch (e) {
        sendHardwareCommand({ cmd: "raw", data: val });
        input.value = '';
      }
    }

    // ------------------- ESP32 韌體程式碼檢視與下載 -------------------
    const ESP32_FIRMWARE_SOURCE = {
      gateway: `// [ESP32 接收中繼基站韌體 - Base Station Gateway]
// 檔案: firmware/esp32_base_station_gateway/esp32_base_station_gateway.ino
#include <WiFi.h>
#include <esp_now.h>

typedef struct __attribute__((packed)) {
  uint8_t nodeId;
  int8_t  q, r;
  float   voltage, current, power, temperature;
  bool    enabled;
  uint32_t uptimeSec;
} SolarTelemetryPacket;

typedef struct __attribute__((packed)) {
  uint8_t targetId;
  uint8_t command;
  uint8_t param;
} SolarControlPacket;

uint8_t broadcastAddress[] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

void OnDataRecv(const esp_now_recv_info *info, const uint8_t *data, int len) {
  if (len < sizeof(SolarTelemetryPacket)) return;
  SolarTelemetryPacket p;
  memcpy(&p, data, sizeof(p));
  
  // 輸出 JSON 給 Web Serial API
  Serial.printf("{\\"type\\":\\"telemetry\\",\\"id\\":%d,\\"q\\":%d,\\"r\\":%d,\\"voltage\\":%.2f,\\"current\\":%.2f,\\"power\\":%.2f,\\"temp\\":%.1f,\\"enabled\\":%s}\\n",
    p.nodeId, p.q, p.r, p.voltage, p.current, p.power, p.temperature, p.enabled ? "true":"false");
}

void setup() {
  Serial.begin(115200);
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP("HexagonSolar-BaseGateway", "hexagonsolar888");
  esp_now_init();
  esp_now_register_recv_cb(OnDataRecv);
  esp_now_peer_info_t peerInfo = {};
  memcpy(peerInfo.peer_addr, broadcastAddress, 6);
  esp_now_add_peer(&peerInfo);
  Serial.println("{\\"type\\":\\"ready\\",\\"msg\\":\\"Gateway Listening\\"}");
}

void loop() {
  if (Serial.available()) {
    String str = Serial.readStringUntil('\\n');
    // 解析下行指令並轉發 ESP-NOW
  }
}`,
      node: `// [ESP32 水面浮動太陽能節點韌體 - Solar Node]
// 檔案: firmware/esp32_solar_node/esp32_solar_node.ino
#include <WiFi.h>
#include <esp_now.h>

#define MODULE_ID       1
#define PIN_VOLTAGE_ADC 34
#define PIN_RELAY       26

typedef struct __attribute__((packed)) {
  uint8_t nodeId;
  int8_t  q, r;
  float   voltage, current, power, temperature;
  bool    enabled;
  uint32_t uptimeSec;
} SolarTelemetryPacket;

uint8_t baseMac[] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
bool isEnabled = true;

void sendTelemetry() {
  SolarTelemetryPacket p;
  p.nodeId = MODULE_ID;
  p.voltage = 12.0 + ((float)(millis()%100)/500.0);
  p.current = isEnabled ? 1.4 : 0.0;
  p.power = isEnabled ? 6.5 : 0.0;
  p.temperature = 34.2;
  p.enabled = isEnabled;
  esp_now_send(baseMac, (uint8_t*)&p, sizeof(p));
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_RELAY, OUTPUT);
  WiFi.mode(WIFI_STA);
  esp_now_init();
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, baseMac, 6);
  esp_now_add_peer(&peer);
}

void loop() {
  sendTelemetry();
  delay(2500);
}`,
      guide: `# ESP32 & ESP-NOW 硬體接線與燒錄指南
1. 使用 Arduino IDE 安裝 ESP32 開發板支援 (版本 2.0.x / 3.0.x)。
2. 將「基站 ESP32」連接電腦 USB，開啟 esp32_base_station_gateway.ino 並燒錄。
3. 將「水面六角模組 ESP32」連接電腦 USB，依模組編號修改 MODULE_ID 後燒錄。
4. 接線說明:
   - 太陽能 18V 面板 -> LM2596 Buck 降壓穩壓至 12V 輸出
   - 12V 電壓取樣: 100kΩ / 10kΩ 分壓電阻 -> GPIO 34
   - 12V 輸出開關: GPIO 26 -> N-MOSFET Gate
5. 開啟本控制台，點擊「🔌 連線 ESP32 (USB Serial)」，即可直連即時監控！`
    };

    let currentFirmwareTab = 'gateway';

    function openFirmwareModal() {
      currentFirmwareTab = 'gateway';
      const html = `
    <div style="font-size:13px; color:var(--text-secondary)">
      <div class="firmware-tab-nav">
        <button class="firmware-tab-btn active" id="fwTab-gateway" onclick="switchFirmwareTab('gateway')">🏠 基站韌體 (Gateway .ino)</button>
        <button class="firmware-tab-btn" id="fwTab-node" onclick="switchFirmwareTab('node')">⬢ 水面模組 (Solar Node .ino)</button>
        <button class="firmware-tab-btn" id="fwTab-guide" onclick="switchFirmwareTab('guide')">📖 接線與燒錄說明 (Guide)</button>
      </div>
      <div class="code-preview-box" id="firmwareCodeView">${escapeHtml(ESP32_FIRMWARE_SOURCE.gateway)}</div>
      <div style="margin-top:10px; font-size:11px; color:var(--text-muted); display:flex; justify-content:space-between; align-items:center">
        <span>原始碼已同步存於專案 <code>firmware/</code> 資料夾中</span>
        <span style="color:var(--accent-on)">支援晶片: ESP32 / ESP32-S3 / ESP32-C3</span>
      </div>
    </div>
  `;
      const footer = `
    <button class="toolbar-btn" onclick="downloadFirmwareFile()">💾 下載程式碼檔案</button>
    <button class="toolbar-btn primary" onclick="copyFirmwareCode()">📋 複製程式碼</button>
    <button class="toolbar-btn" onclick="closeModal()">關閉</button>
  `;
      openModal('📥 ESP32 / ESP-NOW 韌體程式碼與接線指南', html, footer);
    }

    function switchFirmwareTab(tab) {
      currentFirmwareTab = tab;
      document.querySelectorAll('.firmware-tab-btn').forEach(b => b.classList.remove('active'));
      const activeBtn = document.getElementById(`fwTab-${tab}`);
      if (activeBtn) activeBtn.classList.add('active');
      const codeBox = document.getElementById('firmwareCodeView');
      if (codeBox) {
        codeBox.textContent = ESP32_FIRMWARE_SOURCE[tab] || '';
      }
    }

    function copyFirmwareCode() {
      const code = consoleI18n.firmware(ESP32_FIRMWARE_SOURCE[currentFirmwareTab] || '', currentFirmwareTab);
      navigator.clipboard.writeText(code).then(() => {
        showToast('✓ 韌體程式碼已複製至剪貼簿！');
      }).catch(() => {
        showToast('複製失敗，請手動全選複製');
      });
    }

    function downloadFirmwareFile() {
      const content = consoleI18n.firmware(ESP32_FIRMWARE_SOURCE[currentFirmwareTab] || '', currentFirmwareTab);
      const filename = currentFirmwareTab === 'gateway' ? 'esp32_base_station_gateway.ino'
        : currentFirmwareTab === 'node' ? 'esp32_solar_node.ino'
          : 'README.md';
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      showToast(`✓ 已下載檔案: ${filename}`);
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
        protocol: 'ESP-NOW 2.0 (IEEE 802.11 LR)',
        baseMac: '24:6F:28:AA:BB:00',
        baudRate: '115200',
        wsUrl: 'ws://192.168.4.1:81',
        emailNotifications: true,
        webPush: true,
        dailySummary: true,
        dailyVerification: true
      };
    }

    function loadConsoleSettings() {
      try {
        return Object.assign(getDefaultSettings(), JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}'));
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
      const active = hexagons.filter(h => h.enabled).length;
      const total = hexagons.length || parseInt(textFromSelector('#statTotal', '0'), 10) || 0;
      const idle = Math.max(total - active, 0);
      const offline = parseInt(textFromSelector('#statOffline', '0'), 10) || 0;
      const enabledHex = hexagons.filter(h => h.enabled);
      const totalPower = enabledHex.reduce((sum, h) => sum + (parseFloat(h.power) || 0), 0);
      const avgTemp = enabledHex.length
        ? enabledHex.reduce((sum, h) => sum + (parseFloat(h.temp) || 0), 0) / enabledHex.length
        : 0;
      const weakSignal = hexagons.filter(h => Number(h.signal) <= -65).length;
      return {
        date: now.toLocaleDateString('zh-TW'),
        time: formatSystemTime(now),
        user: `${user.name} (${user.roleTag || user.role})`,
        lang,
        total,
        active,
        idle,
        offline,
        currentOutput: textFromSelector('.left-panels [data-panel="output"] .stat-card:nth-child(1) .stat-value', `${totalPower.toFixed(1)} kWh`),
        peakLoad: textFromSelector('.left-panels [data-panel="output"] .stat-card:nth-child(2) .stat-value', '78 kWh'),
        todayGeneration: textFromSelector('#page-power .panel:nth-child(1) div[style*="font-family:var(--font-tech)"]', '84.6') + ' kWh',
        weekGeneration: textFromSelector('#page-power .panel:nth-child(2) div[style*="font-family:var(--font-tech)"]', '523.8') + ' kWh',
        monthGeneration: textFromSelector('#page-power .panel:nth-child(3) div[style*="font-family:var(--font-tech)"]', '2,184.5') + ' kWh',
        carbonReduction: textFromSelector('#page-power .panel:nth-child(4) div[style*="font-family:var(--font-tech)"]', '1.53') + ' t CO2',
        batteryStored: '342 kWh / 500 kWh (68.4%)',
        waterSaved: '12,480 L',
        panelTemp: avgTemp ? `${avgTemp.toFixed(1)} °C average` : '38.2 °C average',
        networkMode: textFromSelector('#netHardwareMode', 'Simulation Mode'),
        endpoint: textFromSelector('#baseEndpointLabel', 'Simulation Mode'),
        packets: textFromSelector('#netRxPackets', `${hardwareRxCount} pkts`),
        txPackets: `${hardwareTxCount} pkts`,
        weakSignal,
        alerts: 'INFO 24 / WARNING 3 / DANGER 1',
        recommendation: weakSignal > 0
          ? (chinese ? '建議檢查 ESP-NOW 訊號較弱的節點，並確認中繼覆蓋範圍。' : 'Inspect weak ESP-NOW signal nodes and confirm relay coverage.')
          : (chinese ? '系統運作正常，請維持例行監控。' : 'System is operating normally. Continue routine monitoring.')
      };
    }

    function buildDailySummaryReportText(data, lang = data.lang || getActiveLanguage()) {
      if (isChineseLanguage(lang)) {
        return [
          '每日摘要報告',
          '水面智慧浮動太陽能發電系統 - Macau Reservoir Unit 1',
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
          `- RX 封包：${data.packets}`,
          `- TX 封包：${data.txPackets}`,
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
    <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:10px; margin-bottom:14px">
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
      const text = `To: ${email.to}\nSubject: ${email.subject}\n\n${email.body}`;
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
      }
    }

    // ==================== Modal 視窗 ====================
    function openModal(title, bodyHtml, footerHtml) {
      document.getElementById('modalTitle').textContent = title || '';
      document.getElementById('modalBody').innerHTML = bodyHtml || '';
      document.getElementById('modalFooter').innerHTML = footerHtml ||
        `<button class="toolbar-btn" onclick="closeModal()">關閉</button>`;
      document.getElementById('modalRoot').classList.add('active');
    }
    function closeModal() {
      document.getElementById('modalRoot').classList.remove('active');
    }

    // ==================== 頂部列功能 ====================
    function doSearch(q) {
      if (!q || !q.trim()) { showToast('請輸入關鍵字'); return; }
      q = q.trim().toLowerCase();
      let hits = 0;
      const matches = [];
      if (('hex-' + q).includes('hex') || 'hexagon'.includes(q) || '發電'.includes(q)) hits += 3;
      ['HEX-01', 'HEX-02', 'HEX-05', 'HEX-07'].forEach(d => {
        if (d.toLowerCase().includes(q)) matches.push(d);
      });
      const html = `<div style="font-size:13px; color:var(--text-secondary); line-height:1.8">
    🔍 查詢關鍵字：<b style="color:var(--accent-on)">${q}</b><br>
    比對命中：<b style="color:var(--accent-on)">${matches.length + hits}</b> 筆結果<br><br>
    ${matches.length ? '匹配裝置：<span style="color:var(--accent-purple); font-family:var(--font-tech)">' + matches.join(', ') + '</span>' : '未匹配裝置 ID，已於功能選單搜尋相關結果'}
  </div>`;
      openModal('🔍 搜尋結果', html);
    }

    function openNotifications() {
      const alerts = [...document.querySelectorAll('#page-alerts .alert-item')];
      const visibleAlerts = alerts.filter(a => !a.classList.contains('acked'));
      const html = `<div style="max-height:50vh; overflow-y:auto; display:flex; flex-direction:column; gap:10px">
    ${visibleAlerts.length ? visibleAlerts.map(alert => alert.outerHTML.replace('onclick=', 'data-original-click=')).join('') : '<div style="color:var(--text-secondary); font-size:13px">目前沒有未確認通知。</div>'}
  </div>`;
      openModal(`🔔 通知中心 (${visibleAlerts.length})`, html);
    }

    function updateNotificationBadge() {
      const badge = document.querySelector('.notification-badge');
      if (!badge) return;
      const count = document.querySelectorAll('#page-alerts .alert-item:not(.acked)').length;
      const label = window.consoleI18n?.translate('Notifications') || 'Notifications';
      badge.textContent = `🔔 ${label} (${count})`;
    }

    function navToSettings() {
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      document.querySelector('.nav-item[data-page="settings"]').classList.add('active');
      document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
      document.getElementById('page-settings').classList.add('active');
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
      const users = getStoredUsers();
      const user = (currentSession && currentSession.user) || users.admin || AUTH_USERS.admin;
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
      const html = `<div style="font-size:13px; color:var(--text-secondary)">
    <div style="margin-bottom:12px">切換至 <b style="color:var(--accent-on)">${target.username}</b> 需要輸入此帳號密碼。</div>
    <div class="login-input-group" style="margin-bottom:0">
      <label class="login-label">帳號密碼 / Account Password</label>
      <input type="password" id="roleSwitchPassword" class="login-input" placeholder="請輸入 ${target.username} 密碼" style="padding-left:14px" onkeydown="if(event.key==='Enter') submitRoleSwitchPassword('${type}')">
    </div>
  </div>`;
      const footer = `
    <button class="toolbar-btn" onclick="closeModal()">取消</button>
    <button class="toolbar-btn primary" onclick="submitRoleSwitchPassword('${type}')">確認切換</button>
  `;
      openModal('🔐 驗證切換權限', html, footer);
      setTimeout(() => {
        const input = document.getElementById('roleSwitchPassword');
        if (input) input.focus();
      }, 100);
    }

    async function submitRoleSwitchPassword(type) {
      const input = document.getElementById('roleSwitchPassword');
      const password = input ? input.value : '';
      const users = getStoredUsers();
      const target = users[type] || AUTH_USERS[type];
      if (!target) return;
      if (!password) {
        showToast('請輸入帳號密碼');
        return;
      }
      const passwordHash = await hashPassword(password);
      if (passwordHash !== target.passwordHash && password !== target.password) {
        showToast('密碼輸入不正確，無法切換帳號');
        return;
      }
      closeModal();
      completeUserSwitch(target);
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
          card.style.borderColor = 'var(--border-cyan)';
          card.style.boxShadow = '0 0 15px rgba(0, 229, 200, 0.25)';
          card.style.background = 'rgba(0, 229, 200, 0.1)';
          btn.className = 'toolbar-btn';
          btn.style.background = 'rgba(0, 255, 198, 0.2)';
          btn.style.color = 'var(--accent-on)';
          btn.style.borderColor = 'var(--accent-on)';
          btn.innerHTML = '● 目前登入中 (Active)';
        } else {
          card.style.borderColor = 'rgba(0, 229, 200, 0.2)';
          card.style.boxShadow = 'none';
          card.style.background = 'rgba(0, 229, 200, 0.04)';
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
        <span style="font-family:var(--font-tech)">ESP32-MESH Node #01</span>
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
      const user = (currentSession && currentSession.user) || AUTH_USERS.admin;
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
      const user = (currentSession && currentSession.user) || AUTH_USERS.admin;

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
    function buildDeviceTable() {
      const tbody = document.getElementById('deviceTableBody');
      if (!tbody) return;
      const rows = [];
      const statuses = ['online', 'online', 'online', 'warning', 'online', 'online', 'online', 'offline'];
      const labels = ['ONLINE', 'ONLINE', 'ONLINE', 'WARNING', 'ONLINE', 'ONLINE', 'ONLINE', 'OFFLINE'];
      for (let i = 1; i <= deviceCount; i++) {
        rows.push(`<tr style="cursor:pointer" oncontextmenu="event.preventDefault(); viewDevice(${i}); return false;" ondblclick="viewDevice(${i})">
      <td style="font-family:var(--font-tech); color:var(--accent-on)">HEX-${String(i).padStart(2, '0')}</td>
      <td style="color:var(--text-secondary); font-size:12px">(${i % 3 - 1}, ${Math.floor(i / 3) - 1})</td>
      <td><span class="status-pill ${statuses[(i - 1) % statuses.length]}">${labels[(i - 1) % labels.length]}</span></td>
      <td style="font-family:var(--font-tech)">12.0${(Math.random() * 0.3).toFixed(2)} V</td>
      <td style="font-family:var(--font-tech)">${(30 + Math.random() * 15).toFixed(1)} °C</td>
      <td style="color:var(--accent-on)">●●●●○</td>
      <td style="font-family:var(--font-tech); color:var(--accent-purple)">${(Math.random() * 15 + 2).toFixed(2)}</td>
      <td style="color:var(--text-muted); font-size:11px">${String(Math.floor(Math.random() * 59)).padStart(2, '0')} 秒前</td>
      <td>
        <div class="row-action">
          <button onclick="event.stopPropagation(); viewDevice(${i})" title="檢視">👁</button>
          <button onclick="event.stopPropagation(); toggleDevice(${i})" title="啟動/停止">⏻</button>
          <button class="danger" onclick="event.stopPropagation(); removeDevice(${i}, this)" title="移除">✕</button>
        </div>
      </td>
    </tr>`);
      }
      tbody.innerHTML = rows.join('');
    }

    function viewDevice(id) {
      const hex = hexagons.find(h => h.id === id) || { id, power: '6.5', temp: '34.2', signal: -52, enabled: true };
      const html = `<div style="font-size:13px; color:var(--text-secondary); line-height:2">
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px">
      <div class="stat-card" style="margin:0"><span class="stat-label">裝置 ID</span><span class="stat-value">HEX-${String(id).padStart(2, '0')}</span></div>
      <div class="stat-card" style="margin:0"><span class="stat-label">狀態</span><span class="stat-value" style="color:${hex.enabled ? 'var(--accent-on)' : 'var(--accent-off)'}">${hex.enabled ? 'ONLINE' : 'OFFLINE'}</span></div>
      <div class="stat-card" style="margin:0"><span class="stat-label">發電功率</span><span class="stat-value">${hex.power} kWh</span></div>
      <div class="stat-card" style="margin:0"><span class="stat-label">面板溫度</span><span class="stat-value">${hex.temp} °C</span></div>
      <div class="stat-card" style="margin:0"><span class="stat-label">訊號</span><span class="stat-value">${hex.signal} dBm</span></div>
      <div class="stat-card" style="margin:0"><span class="stat-label">韌體版本</span><span class="stat-value" style="font-size:13px">v2.4.1</span></div>
    </div>
    <div style="margin-top:16px; padding:12px; background:rgba(0,229,200,0.05); border-radius:4px; border:1px solid rgba(0,229,200,0.2)">
      <b style="color:var(--accent-on)">MAC 位址：</b>24:6F:28:AA:BB:${String(id).padStart(2, '0')}<br>
      <b style="color:var(--accent-on)">ESP32 晶片：</b>ESP-WROOM-32 (8MB Flash)<br>
      <b style="color:var(--accent-on)">Buck 電路：</b>LM2596 降壓穩壓 12V / 5A<br>
      <b style="color:var(--accent-on)">太陽能板：</b>單晶 18V / 20W (六角蜂巢造型)
    </div>
  </div>`;
      const footer = `<button class="toolbar-btn danger" onclick="closeModal()">關閉</button><button class="toolbar-btn" onclick="closeModal(); showToast('✓ HEX-${String(id).padStart(2, '0')} 設定已套用')">套用設定</button><button class="toolbar-btn primary" onclick="closeModal(); navigateTo('overview')">定位</button>`;
      openModal(`⬢ HEX-${String(id).padStart(2, '0')} 裝置詳情`, html, footer);
    }

    function toggleDevice(id) {
      if (!checkPermission('control', '切換裝置開關')) return;
      const hex = hexagons.find(h => h.id === id);
      if (hex) {
        hex.enabled = !hex.enabled;
        updateStats();
        drawAll();
        sendHardwareCommand({ cmd: "set_power", id: id, enabled: hex.enabled });
        showToast(`HEX-${String(id).padStart(2, '0')} 已${hex.enabled ? '啟動 ON' : '停止 OFF'} (ESP-NOW 指令已發送)`);
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
          deviceCount = Math.max(0, deviceCount - 1);
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
      deviceCount = deviceCount + 1;
      const id = deviceCount;
      const size = Math.min(canvas.width, canvas.height) * 0.09 * currentZoom;
      const [q, r] = document.getElementById('newDevPos').value.split(',').map(s => parseInt(s.trim()) || 0);
      const enabled = document.getElementById('newDevToggle').classList.contains('active');
      if (canvas.width > 0) {
        const cx = canvas.width / 2 + size * Math.sqrt(3) * (q + r * 0.5);
        const cy = canvas.height / 2 + size * 1.5 * r;
        const hex = new Hexagon(id, q, r, size);
        hex.enabled = enabled;
        hexagons.push(hex);
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
      const statuses = ['ONLINE', 'ONLINE', 'ONLINE', 'WARNING', 'ONLINE', 'ONLINE', 'ONLINE', 'OFFLINE'];
      for (let i = 1; i <= deviceCount; i++) {
        csv += `HEX-${String(i).padStart(2, '0')},"(${i % 3 - 1},${Math.floor(i / 3) - 1})",${consoleI18n.translate(statuses[(i - 1) % 8])},12.0${(Math.random() * 0.3).toFixed(2)},${(30 + Math.random() * 15).toFixed(1)},${-40 - Math.floor(Math.random() * 30)},${(Math.random() * 15 + 2).toFixed(2)},${String(Math.floor(Math.random() * 59)).padStart(2, '0')} ${consoleI18n.translate('秒前')}\n`;
      }
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
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      const nav = document.querySelector(`.nav-item[data-page="${page}"]`);
      if (nav) nav.classList.add('active');
      document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
      const tgt = document.getElementById('page-' + page);
      if (tgt) tgt.classList.add('active');
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
      const times = ['14:30', '14:00', '13:30', '13:00', '12:30', '12:00', '11:30'];
      const rows = times.map((t, idx) => {
        const dev = (idx % 8) + 1;
        const p = (Math.random() * 10 + 3).toFixed(2);
        const v = (12 + Math.random() * 0.5).toFixed(2);
        const a = (parseFloat(p) / parseFloat(v)).toFixed(2);
        const eff = (88 + Math.random() * 10).toFixed(1);
        return `<tr style="cursor:pointer" onclick="viewDevice(${dev})">
      <td style="font-family:var(--font-tech); color:var(--text-secondary)">2026-08-15 ${t}:00</td>
      <td style="font-family:var(--font-tech); color:var(--accent-on); cursor:pointer">HEX-${String(dev).padStart(2, '0')} ↗</td>
      <td style="font-family:var(--font-tech); color:var(--accent-purple)">${p}</td>
      <td style="font-family:var(--font-tech)">${v}</td>
      <td style="font-family:var(--font-tech)">${a}</td>
      <td><div class="progress-bar" style="width:80px; display:inline-block; vertical-align:middle; margin:0 8px"><div class="progress-fill" style="width:${eff}%"></div></div>${eff}%</td>
      <td><span class="status-pill online">正常</span></td>
    </tr>`;
      });
      tbody.innerHTML = rows.join('');
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
        if (isHardwareConnected) return; // 硬體直連時不覆蓋真實 ESP32 遙測數據
        hexagons.forEach(h => {
          if (h.enabled) {
            h.power = (Math.random() * 8 + 2).toFixed(1);
            h.temp = (30 + Math.random() * 12).toFixed(1);
          }
        });
        if (hexagons.length > 0 && viewMode !== 'id') drawAll();
      }, 3500);
    }

    // ==================== 初始化 ====================
    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('load', () => {
      initAuth();
      applyConsoleSettings();
      resizeCanvas();
      setTimeout(generateDefault, 100);
      buildDeviceTable();
      buildPowerLog();
      startSimulation();
      updateBaseStationUI();
      updateNotificationBadge();
      setTimeout(() => runDailySummaryNotification(false), 1200);
      // 修復：儲存監控頁面 stat-card 加上點擊效果
      setTimeout(() => {
        document.querySelectorAll('#page-storage .stat-card').forEach(c => c.classList.add('storage-card-click'));
      }, 50);
    });