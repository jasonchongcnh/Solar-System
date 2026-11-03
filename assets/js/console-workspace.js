/* Presentation and accessible controls over the shared telemetry model. */
(() => {
  'use strict';
  const t = value => window.consoleI18n?.translate(value) || value;
  const set = (id, value) => {
    const node = document.getElementById(id);
    if (node && node.textContent !== String(value)) node.textContent = value;
  };

  const site = document.createElement('div');
  site.className = 'sidebar-site';
  site.innerHTML = '<span class="site-kicker">CONNECTED ENERGY</span><strong>水面太陽能電站</strong><small>MACAU / ARRAY 01</small><a href="solar-system.html" target="_blank" rel="noopener"><span>陣列實驗室</span><span data-icon="arrow-up-right"></span></a>';
  document.querySelector('.sidebar-footer').before(site);
  const environmentControl = document.querySelector('.left-panels > .control-row');
  document.querySelector('.base-station').before(environmentControl);

  // These charts use the same records as the device table, including unavailable readings.
  document.querySelector('.right-panels').innerHTML = `
    <div class="panel">
      <div class="panel-title">模組讀數 <span class="page-eyebrow" style="margin:0">01—08</span></div>
      <div id="moduleReadings" class="telemetry-chart"></div>
      <div class="chart-unit" id="chartUnit"></div>
    </div>
    <div class="panel">
      <div class="panel-title">Running Status 運行狀態</div>
      <div class="gauge-container">
        <div class="gauge-wrapper">
          <svg class="gauge-svg" viewBox="0 0 120 120" aria-hidden="true">
            <circle cx="60" cy="60" r="48" fill="none" stroke="#e5ebe7" stroke-width="9"/>
            <circle id="workspaceGauge" cx="60" cy="60" r="48" fill="none" stroke="#538668" stroke-width="9" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/>
          </svg>
          <div class="gauge-center-text"><div class="gauge-value" id="workspaceActivePercent">--</div><div class="gauge-label">運行中</div></div>
        </div>
        <div class="status-list">
          <div class="status-item"><span class="status-label">運行中</span><span class="status-value" id="workspaceActive">--</span></div>
          <div class="status-item"><span class="status-label">待機中</span><span class="status-value" id="workspaceIdle">--</span></div>
          <div class="status-item"><span class="status-label">離線</span><span class="status-value" id="workspaceOffline">--</span></div>
        </div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-title">遙測摘要</div>
      <div class="metric-row"><span class="metric-label">面板均溫</span><span class="metric-val" id="workspaceTemperature">--</span></div>
      <div class="metric-row"><span class="metric-label">平均訊號</span><span class="metric-val" id="workspaceSignal">--</span></div>
      <div class="metric-row"><span class="metric-label">最後更新 Last Update</span><span class="metric-val" id="workspaceUpdated">--</span></div>
      <button type="button" class="array-device-link" style="margin-top:16px" onclick="openNotifications()"><span data-icon="bell"></span><span>待處理通知</span><span id="workspaceAlerts">0</span></button>
    </div>`;

  for (const id of ['page-storage', 'page-power']) {
    const note = document.createElement('span');
    note.className = 'source-badge';
    note.dataset.sampleBadge = '';
    note.textContent = '模擬數據';
    document.querySelector(`#${id} .page-header`).append(note);
  }

  const navIcons = ['layout-dashboard', 'hexagon', 'battery-charging', 'chart-no-axes-combined', 'triangle-alert', 'settings-2'];
  document.querySelectorAll('.nav-icon').forEach((node, index) => {
    node.textContent = '';
    node.dataset.icon = navIcons[index];
  });
  document.querySelector('#navToggle span').textContent = '';
  document.querySelector('#navToggle span').dataset.icon = 'menu';
  const symbols = new Map([
    ['⬢', 'hexagon'], ['⎆', 'route'], ['⟲', 'rotate-ccw'], ['⚑', 'tag'], ['①', 'hash'],
    ['⚡', 'zap'], ['🌡', 'thermometer'], ['📶', 'radio'], ['⏻', 'power'], ['⏼', 'power-off'],
    ['🔌', 'usb'], ['📟', 'terminal'], ['📥', 'download'], ['🧪', 'flask-conical'],
    ['🔒', 'lock-keyhole'], ['🔔', 'bell'], ['⚙', 'settings-2'], ['👁', 'eye'],
    ['👤', 'user-round'], ['🏠', 'house'], ['⤓', 'download'], ['⟳', 'refresh-cw'],
    ['✉', 'mail'], ['📄', 'file-text'], ['🔄', 'repeat-2'], ['✕', 'x'], ['🔐', 'lock-keyhole'], ['+', 'plus']
  ]);

  function enhanceControls(root = document) {
    const candidates = root.querySelectorAll?.('button, button span, .top-action, .input-icon, .control-label > span:first-child') || [];
    for (const el of candidates) {
      for (const node of [...el.childNodes]) {
        if (node.nodeType !== Node.TEXT_NODE) continue;
        const text = node.data.trimStart();
        const match = [...symbols].find(([symbol]) => text.startsWith(symbol));
        if (!match) continue;
        const icon = document.createElement('span');
        icon.dataset.icon = match[1];
        node.before(icon);
        node.data = text.slice(match[0].length).replace(/^\uFE0F/, '').trimStart();
        break;
      }
    }
    document.querySelectorAll('.top-action, .user-profile-trigger, .sidebar-user-info, .expand-icon, .alert-item[onclick], #baseConnBadge').forEach(el => {
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      if (el.classList.contains('expand-icon')) {
        el.setAttribute('aria-label', el.closest('.panel').querySelector('.panel-title').textContent.replace('▼', '').trim());
        el.setAttribute('aria-expanded', String(!el.closest('.panel').classList.contains('collapsed')));
      }
    });
    document.querySelectorAll('.toggle-switch').forEach(el => {
      el.setAttribute('role', 'switch');
      el.tabIndex = 0;
      el.setAttribute('aria-checked', String(el.classList.contains('active')));
      el.setAttribute('aria-label', (el.closest('.settings-row, .control-row')?.querySelector('span')?.textContent || '電源').trim());
    });
    document.querySelectorAll('.settings-group').forEach(group => {
      const label = group.querySelector('label');
      const input = group.querySelector('input, select');
      if (label && input?.id) label.htmlFor = input.id;
    });
    document.querySelectorAll('button[title]:not([aria-label])').forEach(el => el.setAttribute('aria-label', el.title));
    if (document.querySelector('[data-icon]:not(svg)')) {
      window.lucide?.createIcons({ nameAttr: 'data-icon', attrs: { 'aria-hidden': 'true', focusable: 'false' } });
    }
  }

  let chartIds = '';
  function refreshWorkspace() {
    const records = getDeviceRecords();
    const active = records.filter(record => record.status === 'online' && !isRecordStale(record)).length;
    const offline = records.filter(record => record.status === 'offline' || isRecordStale(record)).length;
    const percent = records.length ? Math.round(active / records.length * 100) : 0;
    set('workspaceActivePercent', `${percent}%`);
    document.getElementById('workspaceGauge').setAttribute('stroke-dashoffset', 100 - percent);
    set('workspaceActive', active);
    set('workspaceIdle', Math.max(0, records.length - active - offline));
    set('workspaceOffline', offline);
    set('arrayCount', `${String(hexagons.length).padStart(2, '0')} MODULES`);
    set('workspaceSource', t(hardwareSessionStarted ? (isHardwareConnected ? '即時遙測' : '連線中斷') : '模擬數據'));
    document.getElementById('workspaceSource').classList.toggle('live', hardwareSessionStarted && isHardwareConnected);
    const measured = records.filter(record => !isRecordStale(record));
    const average = (key, unit) => {
      const available = measured.filter(record => record.status !== 'offline' && hasMeasurement(record, key));
      return available.length ? `${(available.reduce((total, record) => total + record[key], 0) / available.length).toFixed(1)} ${unit}` : '--';
    };
    set('workspaceTemperature', average('temp', '°C'));
    set('workspaceSignal', average('signal', 'dBm'));
    const latest = Math.max(0, ...records.map(record => record.lastReport || 0));
    set('workspaceUpdated', latest ? new Date(latest).toLocaleTimeString(document.documentElement.lang, { hour12: false }) : '--');
    set('workspaceAlerts', document.querySelectorAll('#page-alerts .alert-item:not(.acked)').length);
    set('chartUnit', t(hardwareSessionStarted ? '即時功率 / W' : '模擬發電量 / kWh'));
    document.querySelector('#page-power [data-sample-badge]').textContent = t(hardwareSessionStarted ? '歷史示範數據' : '模擬數據');
    document.querySelector('#page-storage [data-sample-badge]').textContent = t('儲能示範數據');
    const visible = records.slice(0, 8);
    const signature = visible.map(record => record.id).join(',');
    const container = document.getElementById('moduleReadings');
    if (signature !== chartIds || !container.children.length) {
      chartIds = signature;
      container.innerHTML = visible.length ? visible.map(record => `
        <button type="button" class="telemetry-chart-row" data-reading="${record.id}" onclick="viewDevice(${record.id})" aria-label="HEX-${String(record.id).padStart(2, '0')}">
          <span>H-${String(record.id).padStart(2, '0')}</span><span class="telemetry-chart-track"><span class="telemetry-chart-fill" style="display:block;width:0"></span></span><span class="reading-value">--</span>
        </button>`).join('') : '<p class="sample-note">尚無遙測資料</p>';
    }
    const max = Math.max(1, ...visible.filter(record => hasMeasurement(record, 'power')).map(record => record.power));
    for (const record of visible) {
      const row = container.querySelector(`[data-reading="${record.id}"]`);
      const available = !isRecordStale(record) && hasMeasurement(record, 'power');
      const value = available ? record.power.toFixed(1) : '--';
      if (row.querySelector('.reading-value').textContent !== value) row.querySelector('.reading-value').textContent = value;
      row.querySelector('.telemetry-chart-fill').style.width = `${available ? Math.max(0, record.power / max * 100) : 0}%`;
      row.title = `HEX-${String(record.id).padStart(2, '0')} / ${value} ${hardwareSessionStarted ? 'W' : 'kWh'}`;
    }
  }
  window.refreshWorkspace = refreshWorkspace;

  const focusable = scope => [...scope.querySelectorAll('button, a[href], input, select, textarea, [tabindex="0"], [role="button"], [role="switch"]')]
    .filter(el => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length && !el.closest('[inert]'));
  document.addEventListener('keydown', event => {
    const modal = document.getElementById('modalRoot');
    const login = document.getElementById('loginOverlay');
    const scope = modal.classList.contains('active') ? modal : !login.classList.contains('hidden') ? login : null;
    if (event.key === 'Escape' && modal.classList.contains('active')) {
      event.preventDefault();
      closeModal();
      return;
    }
    if (event.key === 'Tab' && scope) {
      const elements = focusable(scope);
      const first = elements[0];
      const last = elements.at(-1);
      if (event.shiftKey && (document.activeElement === first || !elements.includes(document.activeElement))) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !elements.includes(document.activeElement))) {
        event.preventDefault(); first?.focus();
      }
    }
    const target = event.target.closest('[role="button"], [role="switch"]');
    if (target && !target.matches('button, input, select') && ['Enter', ' '].includes(event.key)) {
      event.preventDefault();
      target.click();
    }
  });
  document.addEventListener('click', event => {
    const toggle = event.target.closest('.toggle-switch');
    if (toggle) queueMicrotask(() => toggle.setAttribute('aria-checked', String(toggle.classList.contains('active'))));
  });

  const canvas = document.getElementById('hexCanvas');
  canvas.tabIndex = 0;
  canvas.addEventListener('keydown', event => {
    if (!hexagons.length || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    let index = Math.max(0, hexagons.findIndex(hex => hex.id === focusedHexId));
    if (['Enter', ' '].includes(event.key)) { viewDevice(hexagons[index].id); return; }
    index = (index + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) + hexagons.length) % hexagons.length;
    focusedHexId = hexagons[index].id;
    canvas.setAttribute('aria-label', `${t('浮動模組陣列')} / HEX-${String(focusedHexId).padStart(2, '0')}`);
    drawAll();
  });
  canvas.addEventListener('focus', () => { focusedHexId ??= hexagons[0]?.id; drawAll(); });
  canvas.addEventListener('mousemove', event => {
    const bounds = canvas.getBoundingClientRect();
    const x = (event.clientX - bounds.left) * canvasWidth / bounds.width;
    const y = (event.clientY - bounds.top) * canvasHeight / bounds.height;
    canvas.style.cursor = hexagons.some(hex => hex.containsPoint(x, y)) ? 'pointer' : 'default';
  });
  document.querySelectorAll('.control-buttons .control-btn').forEach(button => button.setAttribute('aria-pressed', String(button.classList.contains('active'))));
  document.getElementById('toggleLabel').setAttribute('aria-pressed', 'true');

  let scheduled = false;
  new MutationObserver(changes => {
    if (scheduled || !changes.some(change => [...change.addedNodes].some(node => node.nodeType === Node.ELEMENT_NODE && node.namespaceURI !== 'http://www.w3.org/2000/svg'))) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; enhanceControls(); });
  }).observe(document.body, { subtree: true, childList: true });
  enhanceControls();
  refreshWorkspace();
  window.addEventListener('load', () => { enhanceControls(); refreshWorkspace(); });
  document.addEventListener('change', event => {
    if (event.target.matches('[data-language-select]')) { enhanceControls(); refreshWorkspace(); }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshWorkspace(); });
  window.addEventListener('solar-theme-change', () => { drawAll(); });
})();
