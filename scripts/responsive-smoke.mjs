import { pathToFileURL } from 'node:url';
import path from 'node:path';

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch (error) {
    if (process.platform !== 'win32') throw error;
    return import('file:///C:/Users/Jason/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
  }
}

const { chromium } = await loadPlaywright();
const root = process.cwd();
const dashboardUrl = pathToFileURL(path.join(root, 'management-console.html')).href;
const honeycombUrl = pathToFileURL(path.join(root, 'solar-system.html')).href;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    if (process.platform !== 'win32') throw error;
    return chromium.launch({ channel: 'chrome', headless: true });
  }
}

async function openDashboard(page) {
  await page.goto(dashboardUrl);
  await page.evaluate(() => {
    sessionStorage.setItem('hex_solar_session', JSON.stringify({
      username: 'admin',
      loginTime: Date.now(),
      remember: false
    }));
  });
  await page.reload();
  await page.waitForTimeout(600);
}

async function checkDashboard(browser, viewport) {
  const page = await browser.newPage({
    viewport,
    deviceScaleFactor: viewport.width < 600 ? 2 : 1,
    isMobile: viewport.width < 600,
    hasTouch: viewport.width < 600
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await openDashboard(page);

  const boot = await page.evaluate(() => ({
    total: document.querySelector('#statTotal')?.textContent,
    active: document.querySelector('#statActive')?.textContent,
    rows: document.querySelectorAll('#deviceTableBody tr').length,
    output: document.querySelector('#metricCurrentOutput')?.textContent,
    report: buildDailySummaryReportData().currentOutput,
    canvasPixels: (() => {
      const canvas = document.querySelector('#hexCanvas');
      const ctx = canvas.getContext('2d');
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 3; i < data.length; i += 4) if (data[i]) return true;
      return false;
    })()
  }));

  assert(errors.length === 0, `Dashboard page errors: ${errors.join('; ')}`);
  assert(boot.total === '8', `Expected 8 devices, got ${boot.total}`);
  assert(Number(boot.active) >= 1, `Expected active devices, got ${boot.active}`);
  assert(boot.rows === 8, `Expected 8 device rows, got ${boot.rows}`);
  assert(boot.output === boot.report, `Dashboard output ${boot.output} did not match report ${boot.report}`);
  assert(boot.canvasPixels, 'Dashboard canvas is blank');

  await page.evaluate(() => navigateTo('devices'));
  await page.waitForTimeout(100);
  assert(await page.locator('#page-devices.active').count() === 1, 'Devices page did not activate');

  if (viewport.width < 600) {
    await page.locator('#navToggle').click();
    await page.locator('[data-page="settings"]').click();
    await page.waitForTimeout(100);
    const navOpen = await page.locator('.sidebar.nav-open').count();
    assert(navOpen === 0, 'Mobile nav did not close after navigation');
  }

  const overflow = await page.evaluate(() => {
    const allowed = el => el.closest('.table-scroll, pre, textarea, code');
    return [...document.querySelectorAll('body *')].filter(el => {
      if (allowed(el)) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.right > document.documentElement.clientWidth + 1;
    }).slice(0, 5).map(el => el.className || el.tagName);
  });
  assert(overflow.length === 0, `Unexpected horizontal overflow: ${overflow.join(', ')}`);
  await page.close();
}

async function checkHoneycomb(browser) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(honeycombUrl);
  await page.waitForTimeout(400);
  const result = await page.evaluate(() => {
    const canvas = document.querySelector('#canvas');
    const ctx = canvas.getContext('2d');
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let nonBlank = false;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i]) {
        nonBlank = true;
        break;
      }
    }
    return {
      nonBlank,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  });
  assert(errors.length === 0, `Honeycomb page errors: ${errors.join('; ')}`);
  assert(result.nonBlank, 'Honeycomb canvas is blank');
  assert(result.overflow <= 1, `Honeycomb page has horizontal overflow ${result.overflow}`);
  await page.close();
}

const browser = await launchBrowser();
try {
  await checkDashboard(browser, { width: 390, height: 844 });
  await checkDashboard(browser, { width: 1280, height: 800 });
  await checkHoneycomb(browser);
  console.log('Responsive smoke checks passed.');
} finally {
  await browser.close();
}
