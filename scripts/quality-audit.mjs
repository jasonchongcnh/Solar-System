import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium } from 'playwright';

const output = path.resolve('.artifacts/quality');
await mkdir(output, { recursive: true });
let browser;
const launchOptions = {
  headless: true,
  ...(process.env.SOLAR_TEST_LOW_MEMORY === '1' ? {
    args: ['--disable-gpu', '--renderer-process-limit=1', '--js-flags=--max-old-space-size=96']
  } : {})
};
try { browser = await chromium.launch(launchOptions); }
catch { browser = await chromium.launch({ ...launchOptions, channel: 'chrome' }); }
// Serve only during the audit so accessibility tooling can read same-origin CSS.
const root = process.cwd();
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(root, `.${pathname}`);
    if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    const content = await readFile(file);
    response.writeHead(200, { 'Content-Type': `${mime[path.extname(file)] || 'text/plain'}; charset=utf-8` });
    response.end(content);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/management-console.html`;
const results = [];
const errors = [];
const accessibility = [];
const localization = [];
let roleSwitches = 0;
const screenshotsOnly = process.argv.includes('--screenshots-only');
const localeOnly = process.argv.includes('--locale-only');
const inspectLocales = process.argv.includes('--inspect-locales');
const sizes = screenshotsOnly || localeOnly ? [390, 1440] : [360, 390, 768, 1024, 1440, 1920];

async function screenshot(page, name) {
  if (await page.locator('html').getAttribute('data-theme') === 'dark') name += '-dark';
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: !/^(login|role-switch-error|firmware-localized)/.test(name), animations: 'disabled' });
}

async function auditAccessibility(page, label) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  accessibility.push({ label, violations: result.violations.map(item => ({
    id: item.id, impact: item.impact,
    nodes: item.nodes.map(node => ({ target: node.target, message: node.failureSummary }))
  })) });
  await writeFile(path.join(output, 'accessibility.json'), JSON.stringify(accessibility, null, 2));
}

async function auditChinese(page, label) {
  await page.waitForTimeout(30);
  const untranslated = await page.evaluate(() => {
    const texts = new Set();
    const ignored = 'script, style, code, [data-no-i18n], .language-switch, a[download]';
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.parentElement || node.parentElement.closest(ignored) || !node.parentElement.getClientRects().length) continue;
      if (node.parentElement.closest('[inert]')) continue;
      texts.add(node.data.trim());
    }
    document.querySelectorAll('[title], [placeholder], [aria-label]').forEach(element => {
      if (!element.getClientRects().length || element.closest('script, style, code, [data-no-i18n], [inert]')) return;
      for (const name of ['title', 'placeholder', 'aria-label']) if (element.hasAttribute(name)) texts.add(element.getAttribute(name));
    });
    // Product/protocol names, account IDs, units and literal examples are not UI prose.
    const technical = /\b(?:Hexagon Solar|HEXAGON SOLAR|HexagonSolar\/1|HexagonSolar-BaseGateway|HexagonSolar-UNO-R4|XIAO|Mosquitto|UNO|MQTT|wss?|UnoAccessPoint\.h|AccessPointConfig\.h|AccessPointSecrets\.example\.h|MqttSettings\.h|MqttSupport\.h|Secrets\.example\.h|EdgeIdentity\.h|Sc16is752\.h|ESP-NOW|ESP32|Web Serial|WebSocket|USB Serial|USB|Wi-Fi|HTTP|HTTPS|localhost|Chrome|Edge|Firefox|Safari|JSON|CSV|MAC|IP|RSSI|GPIO|MPPT|OVP|OTP|LM2596|Buck|CO2|kWh|dBm|baud|admin|operator|guest|README|SolarProtocol\.h|GatewayConfig\.h|NodeConfig\.h|firmware|ino|HEX-\d+|Base-\d+|HS1|ACK|RX|TX|success|true|false)\b/gi;
    return [...texts].filter(text => {
      const prose = text.replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]+\b/g, '').replace(/(?:https?|wss?):\/\/\S+/g, '').replace(/\{[^\n]*\}/g, '').replace(technical, '');
      return /[A-Za-z]{3,}(?:[-'][A-Za-z]+)*/.test(prose);
    });
  });
  localization.push({ label, untranslated });
  await writeFile(path.join(output, 'localization.json'), JSON.stringify(localization, null, 2));
  if (!inspectLocales) assert.deepEqual(untranslated, [], `Untranslated Chinese UI at ${label}: ${untranslated.join('; ')}`);
}

async function auditLocalizedConsole(page, label) {
  await page.evaluate(() => {
    completeUserSwitch(getStoredUsers().admin);
    consoleI18n.setLanguage('en');
    refreshWorkspace();
    navigateTo('settings');
  });
  await page.locator('.top-bar [data-theme-toggle]').click();
  await page.evaluate(() => consoleI18n.setLanguage('zh-TW'));
  await page.locator('#cfgTheme').selectOption('system');
  for (const section of ['overview', 'devices', 'storage', 'power', 'alerts', 'settings']) {
    await page.evaluate(section => navigateTo(section), section);
    await auditChinese(page, `${label}/${section}/en-to-zh`);
  }
  await page.evaluate(() => {
    appendTerminalLog('sys', '[SYS] Command recorded locally. No live hardware transport is connected.');
    appendTerminalLog('rx', 'RX: {"status":"ONLINE","cmd":"ping"}');
  });
  const dialogs = [
    ['device', () => viewDevice(1)], ['account', () => openUserMenu()],
    ['password', () => openChangePasswordModal()], ['gateway', () => openWsConnectModal()],
    ['terminal', () => openSerialTerminalModal()], ['notifications', () => openNotifications()]
  ];
  for (const [name, open] of dialogs) {
    await page.evaluate(open);
    await page.evaluate(() => { consoleI18n.setLanguage('en'); consoleI18n.setLanguage('zh-TW'); });
    await auditChinese(page, `${label}/${name}-dialog`);
    if (name === 'account') {
      const email = await page.evaluate(() => currentSession.user.email);
      assert((await page.locator('#modalBody').textContent()).includes(email), 'Localization modified an email address');
    }
    if (name === 'terminal') assert.match(await page.locator('.term-msg[data-no-i18n]').filter({ hasText: '"status":"ONLINE","cmd":"ping"' }).textContent(), /"status":"ONLINE","cmd":"ping"/, 'Localization modified packet bytes');
    await page.keyboard.press('Escape');
  }
  await page.evaluate(() => openFirmwareModal());
  for (const tab of await page.evaluate(() => Object.keys(FIRMWARE_FILES))) {
    await page.evaluate(tab => switchFirmwareTab(tab), tab);
    await page.waitForFunction(() => document.getElementById('firmwareLoadStatus').hidden);
    const expected = await readFile(path.join(root, await page.evaluate(tab => FIRMWARE_FILES[tab].path, tab)), 'utf8');
    assert.equal(await page.locator('#firmwareCodeView').textContent(), expected, 'Localization modified repository firmware');
    await auditChinese(page, `${label}/firmware-${tab}`);
  }
  await screenshot(page, `firmware-localized-${label.replaceAll('/', '-')}`);
  await page.keyboard.press('Escape');
  const firmwareUrl = '**/firmware/uno_r4_mqtt_gateway/uno_r4_mqtt_gateway.ino';
  await page.route(firmwareUrl, route => route.fulfill({ status: 503, body: 'Unavailable' }));
  await page.evaluate(() => { firmwareSourceCache.clear(); openFirmwareModal(); });
  await page.waitForFunction(() => /無法載入原始碼/.test(document.getElementById('firmwareLoadStatus').textContent));
  await auditChinese(page, `${label}/firmware-error`);
  await page.keyboard.press('Escape');
  await page.unroute(firmwareUrl);
  await page.evaluate(() => {
    openDailySummaryReport();
    consoleI18n.setLanguage('en');
    consoleI18n.setLanguage('zh-TW');
  });
  await auditChinese(page, `${label}/summary-dialog`);
  const report = await page.evaluate(() => buildDailySummaryReportText(buildDailySummaryReportData('zh-TW')));
  assert(!/average|Admin User|Macau Reservoir|pkts/.test(report), 'Downloaded Chinese report contains English labels');
  await page.keyboard.press('Escape');
  await page.evaluate(() => openEmailNotificationModal());
  await auditChinese(page, `${label}/email-dialog`);
  await page.locator('#emailPreviewSubject').fill('User-edited subject');
  await page.evaluate(() => { consoleI18n.setLanguage('en'); consoleI18n.setLanguage('zh-TW'); });
  assert.equal(await page.locator('#emailPreviewSubject').inputValue(), 'User-edited subject', 'Language switch modified user input');
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    completeUserSwitch(getStoredUsers().guest);
    quickFillAndSwitch('admin');
    submitRoleSwitchPassword('admin');
  });
  await auditChinese(page, `${label}/role-error`);
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    completeUserSwitch(getStoredUsers().admin);
    navigateTo('overview');
    setHardwareConnected(true, 'ESP32 Connected');
    lastHardwarePacketTime = Date.now() - 40000;
    markConnectionStale('Telemetry timeout');
    markConnectionStale('Telemetry timeout');
    consoleI18n.setLanguage('en');
    consoleI18n.setLanguage('zh-TW');
  });
  await auditChinese(page, `${label}/hardware-stale`);
  assert(await page.evaluate(() => isHardwareConnected && hardwareSessionStarted), 'Language switch reset the hardware session');
  assert.equal((await page.locator('#baseEndpointLabel').textContent()).match(/逾時/g)?.length, 1, 'Stale suffix accumulated after localization');
  const confirmationEvent = page.waitForEvent('dialog');
  const pendingConfirmation = page.evaluate(() => toggleBaseMode());
  const confirmation = await confirmationEvent;
  assert.match(confirmation.message(), /是否中斷硬體連線/);
  await confirmation.dismiss();
  await pendingConfirmation;
  await page.evaluate(() => setHardwareConnected(false));
  await auditChinese(page, `${label}/hardware-disconnected`);
}

try {
  for (const { width, theme } of sizes.flatMap(width => ['light', 'dark'].map(theme => ({ width, theme })))) {
    for (const language of localeOnly ? ['zh-TW'] : ['zh-TW', 'en']) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce', hasTouch: width < 600, colorScheme: theme });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(`${width}/${language}/${theme}: ${error.message}`));
      page.on('requestfailed', request => errors.push(`${width}/${language}/${theme}: ${request.url()} ${request.failure()?.errorText}`));
      await page.goto(`${url}?lang=${language}`);
      await page.waitForTimeout(200);
      if (!screenshotsOnly && language === 'zh-TW' && [390, 1440].includes(width)) await auditChinese(page, `${width}/${theme}/login`);
      assert.equal(await page.locator('html').getAttribute('data-theme'), theme, 'System theme did not apply');
      if (!screenshotsOnly && width === 1440 && language === 'zh-TW') await auditAccessibility(page, `${theme}/login`);
      if (width === 390 || width === 1440) await screenshot(page, `login-${width}-${language}`);
      // User-authorized isolated demo session, matching the existing smoke tests.
      await page.evaluate(() => sessionStorage.setItem('hex_solar_session', JSON.stringify({ username: 'admin', loginTime: Date.now(), remember: false })));
      await page.reload();
      await page.waitForFunction(() => document.querySelector('#statTotal').textContent === '8' && document.querySelectorAll('#moduleReadings button').length === 8);
      await page.waitForTimeout(150);
      try {
        await page.waitForFunction(() => !document.querySelector('[data-icon]:not(svg)'), null, { timeout: 2000 });
      } catch {
        const missing = await page.locator('[data-icon]:not(svg)').evaluateAll(nodes => nodes.map(node => node.outerHTML));
        throw new Error(`Missing icons at ${width}/${language}: ${JSON.stringify(missing)}; page errors: ${errors.join('; ')}`);
      }
      assert.equal(await page.locator('#loginOverlay.hidden').count(), 1);
      assert(await page.evaluate(() => [...document.querySelectorAll('[data-localized-default]')].every(input => input.value === consoleI18n.translate(input.defaultValue))), 'Default settings loaded in the wrong language');
      const pixels = await page.locator('#hexCanvas').evaluate(canvas => {
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let dark = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i + 3] && data[i] < 140 && data[i + 1] < 150) dark++;
        return dark;
      });
      assert(pixels > 1000, `Module rendering missing at ${width}/${language}`);
      const coveredModules = await page.evaluate(() => {
        const canvas = document.getElementById('hexCanvas').getBoundingClientRect();
        const toolbar = document.querySelector('.zoom-controls').getBoundingClientRect();
        return hexagons.filter(hex => {
          const x = hex.vertices.map(vertex => canvas.left + vertex.x * canvas.width / canvasWidth);
          const y = hex.vertices.map(vertex => canvas.top + vertex.y * canvas.height / canvasHeight);
          return Math.max(...x) > toolbar.left && Math.min(...x) < toolbar.right && Math.max(...y) > toolbar.top && Math.min(...y) < toolbar.bottom;
        }).map(hex => hex.id);
      });
      assert.deepEqual(coveredModules, [], `Zoom tools cover modules at ${width}/${language}`);
      assert.equal(await page.locator('#workspaceActive').textContent(), await page.locator('#statActive').textContent());
      if (width === 390 || width === 1440) await screenshot(page, `overview-${width}-${language}`);
      for (const section of ['overview', 'devices', 'storage', 'power', 'alerts', 'settings']) {
        await page.evaluate(section => navigateTo(section), section);
        const overflow = await page.evaluate(() => ({
          document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          elements: [...document.querySelectorAll('.page-section.active *, .sidebar *, .top-bar *')].filter(el => {
            if (el.closest('.table-scroll, pre, code, textarea, .serial-terminal')) return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && (rect.right > innerWidth + 1 || rect.left < -1);
          }).slice(0, 8).map(el => el.id || el.className || el.tagName)
        }));
        assert(overflow.document <= 1 && !overflow.elements.length, `${width}/${language}/${section}: ${JSON.stringify(overflow)}`);
        results.push({ width, language, theme, section, overflow: false });
        if (!screenshotsOnly && width === 1440 && language === 'zh-TW') await auditAccessibility(page, `${theme}/${section}`);
        if (['devices', 'settings'].includes(section) && [390, 1440].includes(width)) await screenshot(page, `${section}-${width}-${language}`);
      }
      if (!screenshotsOnly) {
        await page.evaluate(() => navigateTo('devices'));
        await page.locator('#deviceTableBody tr[data-device-id="1"] .device-id-btn').focus();
        await page.evaluate(() => buildDeviceTable());
        assert(await page.locator('#deviceTableBody tr[data-device-id="1"] .device-id-btn').evaluate(el => el === document.activeElement), 'Device refresh moved keyboard focus');
        await page.locator('#deviceTableBody tr[data-device-id="1"] .device-id-btn').click();
        await page.evaluate(() => buildDeviceTable());
        await page.keyboard.press('Escape');
        assert(await page.locator('#deviceTableBody tr[data-device-id="1"] .device-id-btn').evaluate(el => el === document.activeElement), 'Modal close did not restore focus after live refresh');
        await page.evaluate(() => navigateTo('overview'));
        await page.evaluate(() => window.scrollTo(0, 200));
        const scrollBefore = await page.evaluate(() => scrollY);
        await page.evaluate(() => openModal('Scroll check', '<p>Test</p>'));
        await page.keyboard.press('Escape');
        assert(Math.abs(await page.evaluate(() => scrollY) - scrollBefore) <= 1, 'Modal changed the page scroll position');
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.locator('#globalSearch').fill('HEX-08');
        await page.locator('#globalSearch').press('Enter');
        await page.locator('.search-result').waitFor();
        assert.equal(await page.locator('.search-result').count(), 1);
        await page.locator('.search-result').click();
        assert.match(await page.locator('#modalTitle').textContent(), /HEX-08/);
        if (width === 1440 && language === 'zh-TW') await auditAccessibility(page, `${theme}/device-dialog`);
        await page.keyboard.press('Tab');
        assert(await page.evaluate(() => document.querySelector('#modalRoot').contains(document.activeElement)), 'Modal focus escaped');
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#modalRoot.active').count(), 0);
        assert(await page.locator('#globalSearch').evaluate(el => document.activeElement === el), 'Focus not restored after modal close');
        await page.locator('#globalSearch').fill('<img src=x onerror=alert(1)>');
        await page.locator('#globalSearch').press('Enter');
        assert.equal(await page.locator('#modalBody img').count(), 0, 'Search injected HTML');
        assert.equal(await page.locator('.search-result').count(), 0, 'Search returned fabricated results');
        await page.keyboard.press('Escape');
        await page.locator('#hexCanvas').focus();
        const before = await page.locator('#statActive').textContent();
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('#modalRoot.active').count(), 1, 'Keyboard device inspection failed');
        assert.equal(await page.locator('#statActive').textContent(), before, 'Inspecting device changed power');
        await page.keyboard.press('Escape');
        if (width <= 1024) {
          await page.locator('#navToggle').click();
          await page.locator('[data-page="settings"]').click();
          assert.equal(await page.locator('.sidebar.nav-open').count(), 0, 'Navigation did not close');
        } else await page.locator('[data-page="settings"]').click();
        const toggle = page.locator('#toggleDailySummary');
        const checked = await toggle.getAttribute('aria-checked');
        await toggle.focus();
        await page.keyboard.press('Space');
        assert.notEqual(await toggle.getAttribute('aria-checked'), checked, 'Keyboard switch failed');
        await page.evaluate(() => navigateTo('overview'));
        await page.evaluate(() => parseHardwarePacket(JSON.stringify({type:'telemetry',id:1,hall_mask:1,power_control_available:false})));
        const power = await page.locator('[data-reading="1"] .reading-value').textContent();
        assert.equal(power, '--', 'Hall-only packet fabricated electrical data');
        if ([390, 1440].includes(width)) {
          // Test-only credentials and sessions never leave this isolated browser.
          await page.evaluate(async () => {
            const passwordHash = await hashPassword('isolated-regression-password');
            const users = getStoredUsers();
            localStorage.setItem('hex_solar_users_custom', JSON.stringify({
              admin: { ...users.admin, passwordHash }, operator: { ...users.operator, passwordHash }
            }));
          });
          for (const [from, to] of [['guest', 'operator'], ['guest', 'admin'], ['operator', 'admin']]) {
            await page.evaluate(from => {
              localStorage.removeItem('hex_solar_session');
              sessionStorage.setItem('hex_solar_session', JSON.stringify({ username: from, loginTime: Date.now(), remember: false }));
            }, from);
            await page.reload();
            await page.evaluate(() => navigateTo('settings'));
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${theme}/${from}: account header overflow`);
            const trigger = page.locator(`#rbacBtn-${to}`);
            await trigger.click();
            const password = page.locator('#roleSwitchPassword');
            const error = page.locator('#roleSwitchError');
            await page.locator('#roleSwitchSubmit').click();
            await error.waitFor({ state: 'visible' });
            assert.equal(await password.getAttribute('aria-invalid'), 'true');
            await password.fill('incorrect-test-password');
            assert(await error.isHidden(), 'Editing did not clear the old error');
            await password.press('Enter');
            await page.waitForFunction(() => /密碼輸入不正確|Incorrect password/.test(document.getElementById('roleSwitchError').textContent));
            assert(await error.isVisible(), 'Incorrect password error is hidden');
            assert(await password.evaluate(input => input === document.activeElement), 'Invalid field did not receive focus');
            assert.equal(await page.evaluate(() => currentSession.user.username), from, 'Invalid password elevated the account');
            assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('hex_solar_session')).username), from);
            if (width === 1440 && language === 'zh-TW') await auditAccessibility(page, `${theme}/${from}-to-${to}-error`);
            if (from === 'guest' && to === 'admin') {
              await screenshot(page, `role-switch-error-${width}-${language}`);
              if (width === 390 && language === 'en') {
                await page.waitForTimeout(2800);
                assert(await error.isVisible(), 'Password error disappeared with the toast timeout');
              }
            }
            await password.fill('isolated-regression-password');
            await password.press('Enter');
            await page.waitForFunction(to => !document.getElementById('modalRoot').classList.contains('active') && currentSession.user.username === to, to);
            assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('hex_solar_session')).username), to);
            roleSwitches++;
          }
          // Cancelled verification must not change the role or steal focus.
          await page.evaluate(() => completeUserSwitch(getStoredUsers().guest));
          await page.locator('#rbacBtn-admin').click();
          await page.keyboard.press('Escape');
          assert.equal(await page.evaluate(() => currentSession.user.username), 'guest');
          assert(await page.locator('#rbacBtn-admin').evaluate(button => button === document.activeElement));
          await page.locator('#rbacBtn-admin').click();
          const cancelledUser = await page.evaluate(async () => {
            const originalHash = hashPassword;
            let resolveHash;
            hashPassword = () => new Promise(resolve => { resolveHash = resolve; });
            try {
              document.getElementById('roleSwitchPassword').value = 'isolated-regression-password';
              const pending = submitRoleSwitchPassword('admin');
              closeModal();
              resolveHash(await originalHash('isolated-regression-password'));
              await pending;
              return currentSession.user.username;
            } finally { hashPassword = originalHash; }
          });
          assert.equal(cancelledUser, 'guest', 'Cancelled password verification elevated the account');
        }
        if ([390, 1440].includes(width) && language === 'zh-TW') await auditLocalizedConsole(page, `${width}/${theme}`);
      }
      await context.close();
    }
  }
  for (const { width, theme } of [390, 1440].flatMap(width => ['light', 'dark'].map(theme => ({ width, theme })))) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: theme });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(`lab/${width}: ${error.message}`));
    await page.goto(new URL('solar-system.html', url).href);
    await page.waitForFunction(() => !document.querySelector('[data-icon]:not(svg)'));
    await screenshot(page, `array-lab-${width}`);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Array Lab overflow at ${width}`);
    if (!screenshotsOnly && width === 1440) await auditAccessibility(page, `${theme}/array-lab`);
    if (!screenshotsOnly) {
      assert.match(await page.locator('#pathCount').textContent(), /7$/, 'Array Lab displayed the wrong initial active count');
      await page.locator('#canvas').focus();
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Space');
      assert.match(await page.locator('#pathCount').textContent(), /6$/, 'Array Lab keyboard toggle failed');
      await page.keyboard.press('Enter');
      assert.match(await page.locator('#pathCount').textContent(), /7$/, 'Array Lab keyboard state restore failed');
      await page.locator('[data-language-select]').selectOption('en');
      await page.locator('[data-theme-toggle]').click();
      await page.locator('[data-language-select]').selectOption('zh-TW');
      await auditChinese(page, `${width}/${theme}/array-lab`);
      await page.locator('#generateBtn').click();
      await page.locator('#solveBtn').click();
      await auditChinese(page, `${width}/${theme}/array-lab-generated`);
      await page.locator('#clearBtn').click();
      const alertEvent = page.waitForEvent('dialog');
      const solveClick = page.locator('#solveBtn').click();
      const alert = await alertEvent;
      assert.match(alert.message(), /請先產生蜂窩陣列/);
      await alert.dismiss();
      await solveClick;
    }
    await context.close();
  }
  if (!screenshotsOnly) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(`theme-preferences: ${error.message}`));
    await page.goto(`${url}?lang=en`);
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    await page.locator('#loginOverlay [data-theme-toggle]').click();
    assert.equal(await page.evaluate(() => localStorage.getItem('hex_solar_theme')), 'light');
    await page.reload();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light', 'Theme choice did not survive reload');
    await page.emulateMedia({ colorScheme: 'dark' });
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light', 'System theme overrode explicit choice');
    await page.evaluate(() => sessionStorage.setItem('hex_solar_session', JSON.stringify({ username: 'guest', loginTime: Date.now(), remember: false })));
    await page.reload();
    await page.evaluate(() => navigateTo('settings'));
    await page.locator('#cfgTheme').selectOption('dark');
    await page.emulateMedia({ colorScheme: 'light' });
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    await page.locator('#cfgTheme').selectOption('system');
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    const lab = await context.newPage();
    lab.on('pageerror', error => errors.push(`theme-preferences/lab: ${error.message}`));
    await lab.goto(new URL('solar-system.html', url).href);
    assert.equal(await lab.locator('html').getAttribute('data-theme'), 'dark');
    await lab.locator('[data-theme-toggle]').click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light' && document.getElementById('cfgTheme').value === 'light');
    await lab.reload();
    assert.equal(await lab.locator('html').getAttribute('data-theme'), 'light', 'Array Lab did not share the saved theme');
    await page.locator('.top-bar [data-theme-toggle]').click();
    await lab.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    assert.equal(await page.locator('.top-bar [data-theme-toggle] svg').getAttribute('data-icon'), 'sun');
    await page.evaluate(() => localStorage.removeItem('hex_solar_theme'));
    await lab.waitForFunction(() => document.documentElement.dataset.themePreference === 'system');
    await page.evaluate(() => localStorage.setItem('hex_solar_theme', 'invalid'));
    await page.reload();
    assert.equal(await page.locator('html').getAttribute('data-theme-preference'), 'system', 'Invalid preference did not fall back to system');
    await page.evaluate(() => {
      const defaults = getDefaultSettings();
      localStorage.setItem('hex_solar_console_settings', JSON.stringify({
        ...defaults,
        systemName: consoleI18n.translate(defaults.systemName, 'en'),
        timezone: consoleI18n.translate(defaults.timezone, 'en')
      }));
    });
    await page.goto(`${url}?lang=zh-TW`);
    await page.evaluate(() => navigateTo('settings'));
    assert.match(await page.locator('#cfgSystemName').inputValue(), /澳門水庫/);
    assert.match(await page.locator('#cfgTimezone').inputValue(), /澳門標準時間/);
    await page.locator('#cfgSystemName').fill('User-entered English station name');
    await page.locator('#cfgTimezone').fill('UTC+09:00 Custom time zone');
    await page.evaluate(() => { consoleI18n.setLanguage('en'); consoleI18n.setLanguage('zh-TW'); saveConsoleSettings(); });
    await page.reload();
    assert.equal(await page.locator('#cfgSystemName').inputValue(), 'User-entered English station name', 'Localization changed a custom station name');
    assert.equal(await page.locator('#cfgTimezone').inputValue(), 'UTC+09:00 Custom time zone', 'Localization changed a custom time zone');
    await context.close();
  }
  assert.deepEqual(errors, [], `Browser errors: ${errors.join('; ')}`);
  const violations = accessibility.flatMap(item => item.violations.map(violation => `${item.label}: ${violation.id} (${violation.nodes.length} nodes)`));
  assert.deepEqual(violations, [], `Accessibility failures: ${violations.join('; ')}`);
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ views: results.length, roleSwitches, accessibilityScans: accessibility.length, localizationChecks: localization.length, errors, results }, null, 2));
  if (inspectLocales) console.log(JSON.stringify(localization.filter(item => item.untranslated.length), null, 2));
  console.log(screenshotsOnly ? `Screenshot audit passed: ${results.length} responsive views.` : `Quality audit passed: ${results.length} responsive views; ${roleSwitches} verified role upgrades; ${accessibility.length} accessibility scans; ${localization.length} localization checks; theme persistence, search, dialog focus, keyboard controls, canvas pixels, and Hall telemetry verified.`);
  console.log(`Screenshots: ${output}`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
