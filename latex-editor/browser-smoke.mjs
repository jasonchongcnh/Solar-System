import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createEditorServer } from './server.mjs';

const editorDir = path.dirname(fileURLToPath(import.meta.url));
const screenshotDir = path.resolve(editorDir, '../.artifacts/latex-editor/screenshots');
const args = process.argv.slice(2);
const urlIndex = args.indexOf('--url');
const externalUrl = urlIndex >= 0 ? args[urlIndex + 1] : null;
const readOnly = args.includes('--read-only');
const debug = args.includes('--debug');
assert.ok(!externalUrl || readOnly, 'A supplied server must use --read-only to protect its document');

function samplePdf(label, pageCount = 3) {
  const fontObject = 3 + pageCount * 2;
  const kids = Array.from({length: pageCount}, (_, index) => `${3 + index * 2} 0 R`).join(' ');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`
  ];
  for (let page = 1; page <= pageCount; page++) {
    const escaped = `${label} - page ${page}`.replace(/[\\()]/g, character => `\\${character}`);
    const stream = `BT /F1 22 Tf 50 740 Td (${escaped}) Tj ET\n`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontObject} 0 R >> >> /Contents ${4 + (page - 1) * 2} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`
    );
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

async function until(get, predicate, message, timeout = 10000) {
  const end = Date.now() + timeout;
  let value;
  do {
    value = await get();
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 40));
  } while (Date.now() < end);
  assert.fail(`${message}: ${JSON.stringify(value)}`);
}

let fixtureDir;
let editor;
let origin = externalUrl;
const compileCalls = [];
const initialSource = '\\documentclass{article}\n\\begin{document}\n\\section{Introduction}\nOriginal browser preview\n\\subsection{Research Background}\nA second paragraph.\n\\end{document}\n';

if (!externalUrl) {
  fixtureDir = await mkdtemp(path.join(tmpdir(), 'latex-editor-browser-'));
  const projectDir = path.join(fixtureDir, 'project');
  const workDir = path.join(fixtureDir, 'work');
  await mkdir(path.join(projectDir, 'build'), { recursive: true });
  await mkdir(workDir);
  await writeFile(path.join(projectDir, 'main-en.tex'), initialSource);
  await writeFile(path.join(projectDir, 'main.tex'), initialSource.replace('Original browser preview', 'Original-language source (read-only)'));
  await writeFile(path.join(projectDir, 'Fig0.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0ioAAAAASUVORK5CYII=', 'base64'));
  await writeFile(path.join(projectDir, 'build/main-en.pdf'), samplePdf('Original browser preview'));
  editor = await createEditorServer({
    projectDir, workDir, assetDir: projectDir,
    compile: async ({ sourcePath, outDir, onLog }) => {
      const { readFile } = await import('node:fs/promises');
      const source = await readFile(sourcePath, 'utf8');
      compileCalls.push(source);
      onLog('Building browser test document...\n');
      await new Promise(resolve => setTimeout(resolve, 100));
      if (source.includes('\\brokencommand')) {
        const error = new Error('Compilation failed: undefined control sequence');
        error.log = '! Undefined control sequence.\nl.3 \\brokencommand\n';
        throw error;
      }
      const pdfPath = path.join(outDir, 'main-en.pdf');
      await writeFile(pdfPath, samplePdf(`Browser compilation ${compileCalls.length}`));
      return { pdfPath, log: 'Output written on main-en.pdf (3 pages).\n' };
    }
  });
  await new Promise(resolve => editor.server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${editor.server.address().port}`;
}

async function launch() {
  try {
    // The full browser includes its PDF viewer; the default headless shell does not.
    return await chromium.launch({ channel: 'chromium', headless: true });
  } catch (error) {
    if (process.platform !== 'win32') throw error;
    return chromium.launch({ channel: 'chrome', headless: true });
  }
}

async function assertNoOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth
  }));
  assert.ok(dimensions.scroll <= dimensions.width + 1, `${label} layout overflows horizontally: ${JSON.stringify(dimensions)}`);
}

async function previewPosition(page) {
  return page.frameLocator('#pdf-preview').locator('#page-container').evaluate(container => {
    const current = Number(document.getElementById('page-number').value);
    const wrapper = document.querySelector(`.pdf-page[data-page="${current}"]`);
    const containerBox = container.getBoundingClientRect();
    const pageBox = wrapper.getBoundingClientRect();
    return {
      page: current,
      zoom: document.getElementById('zoom').value,
      offset: (containerBox.top - pageBox.top) / pageBox.height,
      scrollTop: container.scrollTop,
      pageHeight: pageBox.height,
      viewportHeight: container.clientHeight,
      maxScroll: container.scrollHeight - container.clientHeight
    };
  });
}

async function jumpPreview(page, number) {
  const preview = page.frameLocator('#pdf-preview');
  await preview.locator('#page-number').fill(String(number));
  await preview.locator('#page-number').press('Enter');
  await preview.locator(`canvas[data-page="${number}"][data-rendered="true"]`).waitFor({timeout: 20000});
  await until(() => preview.locator('#page-number').inputValue(), value => Number(value) === number, `Page control did not jump to page ${number}`);
  const position = await previewPosition(page);
  assert.ok(Math.abs(position.offset) < 0.06, `Page ${number} did not scroll to the top of the preview: ${JSON.stringify(position)}`);
}

async function checkContinuousPreview(page) {
  const preview = page.frameLocator('#pdf-preview');
  const container = preview.locator('#page-container');
  const pageCount = Number((await preview.locator('#page-count').textContent()).replace(/\D/g, ''));
  assert.ok(pageCount >= 3, 'Continuous scrolling fixture must contain at least three pages');
  assert.equal(await preview.locator('#pdf-pages .pdf-page').count(), pageCount, 'Preview did not create a vertical stack of all document pages');
  const stacked = await preview.locator('#pdf-pages .pdf-page').evaluateAll(elements => elements.slice(0, 3).map(element => {
    const rect = element.getBoundingClientRect();
    return {page: Number(element.dataset.page), top: rect.top, bottom: rect.bottom};
  }));
  assert.deepEqual(stacked.map(item => item.page), [1, 2, 3], 'Stacked preview pages are out of order');
  assert.ok(stacked[1].top >= stacked[0].bottom && stacked[2].top >= stacked[1].bottom, 'Preview pages overlap instead of stacking vertically');

  await jumpPreview(page, 1);
  await container.hover();
  await page.mouse.wheel(0, (await previewPosition(page)).pageHeight + 24);
  await until(() => preview.locator('#page-number').inputValue(), value => Number(value) === 2, 'Mouse wheel did not advance the visible page indicator to page 2');
  await preview.locator('canvas[data-page="2"][data-rendered="true"]').waitFor({timeout: 20000});
  await page.mouse.wheel(0, (await previewPosition(page)).pageHeight + 24);
  await until(() => preview.locator('#page-number').inputValue(), value => Number(value) === 3, 'Scrolling did not reach page 3 without clicking next');
  await preview.locator('canvas[data-page="3"][data-rendered="true"]').waitFor({timeout: 20000});
  await preview.locator('#previous-page').click();
  await until(() => preview.locator('#page-number').inputValue(), value => Number(value) === 2, 'Previous page control did not scroll back to page 2');
  await preview.locator('#next-page').click();
  await until(() => preview.locator('#page-number').inputValue(), value => Number(value) === 3, 'Next page control did not scroll to page 3');

  await jumpPreview(page, 2);
  await container.evaluate(element => {
    const wrapper = document.querySelector('.pdf-page[data-page="2"]');
    const distance = wrapper.getBoundingClientRect().top - element.getBoundingClientRect().top;
    element.scrollTop += distance + wrapper.getBoundingClientRect().height * 0.12;
  });
  await page.waitForTimeout(250);
  const beforeZoom = await previewPosition(page);
  assert.equal(beforeZoom.page, 2, 'Position fixture did not remain inside page 2');
  await preview.locator('#zoom').selectOption('1.25');
  await until(() => previewPosition(page), value => value.page === 2 && value.zoom === '1.25' && Math.abs(value.offset - beforeZoom.offset) < 0.06, 'Zoom lost the current page or relative scroll position');
  await preview.locator('canvas[data-page="2"][data-rendered="true"]').waitFor({timeout: 20000});
  const beforeReload = await previewPosition(page);
  await page.reload({waitUntil: 'domcontentloaded'});
  await preview.locator('canvas[data-page="2"][data-rendered="true"]').waitFor({timeout: 20000});
  await until(() => previewPosition(page), value => value.page === beforeReload.page && value.zoom === beforeReload.zoom && Math.abs(value.offset - beforeReload.offset) < 0.06, 'Reload lost the PDF page, zoom, or relative scroll position');
  await preview.locator('#zoom').selectOption('fit');
  await jumpPreview(page, 1);
}

async function checkTouchPreview(page) {
  const preview = page.frameLocator('#pdf-preview');
  const container = preview.locator('#page-container');
  await jumpPreview(page, 1);
  const before = await previewPosition(page);
  const box = await container.boundingBox();
  assert.ok(box && box.height > 0, 'Mobile PDF viewport is not visible');
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Emulation.setTouchEmulationEnabled', {enabled: true, maxTouchPoints: 1});
    for (let swipe = 0; swipe < 2; swipe++) {
      const x = box.x + box.width / 2;
      const startY = box.y + box.height * 0.85;
      const endY = box.y + box.height * 0.15;
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y: startY}]});
      for (let step = 1; step <= 16; step++) {
        const y = startY + (endY - startY) * step / 16;
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x, y}]});
        await page.waitForTimeout(16);
      }
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
      await page.waitForTimeout(120);
    }
    await until(() => previewPosition(page), value => value.scrollTop > before.scrollTop + 30 && value.page >= 2, 'Touch swipe did not scroll to the following PDF page');
    const current = (await previewPosition(page)).page;
    await preview.locator(`canvas[data-page="${current}"][data-rendered="true"]`).waitFor({timeout: 20000});
  } finally { await cdp.detach(); }
}

async function menuAction(page, menu, action) {
  const details = page.locator(`details[data-menu="${menu}"]`);
  await details.locator('summary').click();
  await details.locator(`[data-action="${action}"]`).click();
}

async function checkWorkspaceFeatures(page, sourceEditor) {
  const projectFiles = await (await fetch(`${origin}/api/files`)).json();
  assert.ok(Array.isArray(projectFiles.files), 'Project file endpoint did not return files');
  await until(() => page.locator('#file-tree .file-tree-item').count(), count => count === projectFiles.files.length, 'Project file tree did not render all project files');
  const englishFile = page.locator('#file-tree .file-tree-item[data-file-name="main-en.tex"]');
  assert.equal(await englishFile.count(), 1, 'Editable English source is missing from the file tree');
  assert.equal(await englishFile.evaluate(element => element.classList.contains('active')), true, 'Current source is not marked active');

  const source = await sourceEditor.inputValue();
  await until(() => page.locator('#source-highlight-content').textContent(), value => value?.trimEnd() === source.trimEnd(), 'Syntax highlighting did not follow the loaded source');
  assert.ok(await page.locator('#source-highlight-content .syntax-command').count() > 0, 'LaTeX commands are not highlighted');
  const firstSection = page.locator('#document-outline .outline-item').first();
  await firstSection.waitFor();
  const line = Number(await firstSection.getAttribute('data-line'));
  assert.ok(line > 0, 'Outline section has no source line');
  await firstSection.click();
  const selectedOffset = await sourceEditor.evaluate(element => element.selectionStart);
  const expectedOffset = source.split('\n').slice(0, line - 1).reduce((offset, item) => offset + item.length + 1, 0);
  assert.equal(selectedOffset, expectedOffset, 'Clicking an outline section did not jump to its source line');
  assert.equal(await sourceEditor.inputValue(), source, 'Outline navigation changed the source');

  await page.locator('#sidebar-toggle').click();
  assert.equal(await page.locator('.studio').evaluate(element => element.classList.contains('sidebar-hidden')), true, 'Sidebar toggle did not hide the desktop sidebar');
  await page.locator('#sidebar-toggle').click();
  assert.equal(await page.locator('#project-sidebar').isVisible(), true, 'Sidebar toggle did not restore the sidebar');
  await page.locator('#outline-toggle').click();
  assert.equal(await page.locator('.studio').evaluate(element => element.classList.contains('outline-hidden')), true, 'Outline toggle did not hide the outline');
  await page.locator('#outline-toggle').click();
  assert.equal(await firstSection.isVisible(), true, 'Outline toggle did not restore the outline');

  const wrapBefore = await page.locator('#wrap-button').getAttribute('aria-pressed');
  await menuAction(page, 'view', 'wrap');
  assert.notEqual(await page.locator('#wrap-button').getAttribute('aria-pressed'), wrapBefore, 'View menu did not toggle source wrapping');
  await menuAction(page, 'view', 'wrap');
  await menuAction(page, 'edit', 'find');
  assert.equal(await page.locator('#find-bar').isVisible(), true, 'Edit menu did not open Find');
  await page.locator('#find-close').click();

  await page.locator('#layout-button').click();
  assert.equal(await page.locator('#workspace').evaluate(element => element.classList.contains('layout-source')), true, 'Layout button did not select source view');
  assert.equal(await page.locator('#preview-panel').isVisible(), false, 'Source layout did not hide the preview');
  await page.locator('#layout-button').click();
  assert.equal(await page.locator('#workspace').evaluate(element => element.classList.contains('layout-preview')), true, 'Layout button did not select preview view');
  assert.equal(await page.locator('#source-panel').isVisible(), false, 'Preview layout did not hide the source');
  await page.locator('#layout-button').click();
  assert.equal(await page.locator('#source-panel').isVisible(), true, 'Split layout did not restore the source');
  assert.equal(await page.locator('#preview-panel').isVisible(), true, 'Split layout did not restore the preview');

  const originalFile = projectFiles.files.find(file => file.name === 'main.tex');
  if (originalFile) {
    await page.locator('#file-tree .file-tree-item[data-file-name="main.tex"]').click();
    await page.locator('#asset-dialog').waitFor({state: 'visible'});
    assert.equal(await page.locator('#asset-name').textContent(), 'main.tex', 'Opening original source did not select its preview');
    await until(() => page.locator('#asset-content').textContent(), text => text?.includes('\\documentclass'), 'Read-only original source did not load');
    await page.locator('#asset-close').click();
    assert.equal(await sourceEditor.inputValue(), source, 'Viewing another source replaced the editable English document');
  }
  const imageFile = projectFiles.files.find(file => file.type === 'image');
  if (imageFile) {
    await page.locator('#file-tree .file-tree-item').filter({hasText: imageFile.name}).first().click();
    await page.locator('#asset-dialog').waitFor({state: 'visible'});
    await until(() => page.locator('#asset-content img').evaluateAll(images => images.some(image => image.complete && image.naturalWidth > 0)), ready => ready, 'Project image preview did not decode');
    await page.locator('#asset-close').click();
  }
  assert.equal(await sourceEditor.inputValue(), source, 'Workspace controls changed document content');
  await sourceEditor.evaluate(element => {
    element.setSelectionRange(0, 0);
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll'));
  });
  await assertNoOverflow(page, 'Desktop');
}

async function checkEditHistory(page, sourceEditor, originalSource) {
  const text = 'Saved manually';
  const start = originalSource.indexOf(text);
  assert.ok(start >= 0, 'History fixture is missing its selectable text');
  await sourceEditor.evaluate((element, selection) => {
    element.focus();
    element.setSelectionRange(selection.start, selection.end);
  }, { start, end: start + text.length });
  await page.locator('.source-toolbar [data-editor-action="bold"]').click();
  const formatted = originalSource.replace(text, `\\textbf{${text}}`);
  assert.equal(await sourceEditor.inputValue(), formatted, 'Bold toolbar did not wrap the selected text');
  await page.locator('.source-toolbar [data-editor-action="undo"]').click();
  assert.equal(await sourceEditor.inputValue(), originalSource, 'Toolbar undo did not restore the source before formatting');
  await page.locator('.source-toolbar [data-editor-action="redo"]').click();
  assert.equal(await sourceEditor.inputValue(), formatted, 'Toolbar redo did not restore the formatted source');
  assert.equal(await page.locator('.source-toolbar [data-editor-action="redo"]').isDisabled(), true, 'Redo remained enabled at the latest history entry');

  await sourceEditor.focus();
  await sourceEditor.press('Control+z');
  assert.equal(await sourceEditor.inputValue(), originalSource, 'Keyboard undo did not restore the source before formatting');
  await sourceEditor.evaluate(element => element.setSelectionRange(element.value.length, element.value.length));
  await sourceEditor.press('z');
  assert.equal(await sourceEditor.inputValue(), originalSource + 'z', 'Typing did not insert text at the caret');
  await sourceEditor.press('Control+z');
  assert.equal(await sourceEditor.inputValue(), originalSource, 'Keyboard undo did not restore typed text');
  await sourceEditor.press('Control+Shift+z');
  assert.equal(await sourceEditor.inputValue(), originalSource + 'z', 'Keyboard redo did not restore typed text');
  await sourceEditor.press('Control+z');
  assert.equal(await sourceEditor.inputValue(), originalSource, 'Final undo did not restore the document');
  await until(() => page.locator('#source-highlight-content').textContent(), value => value?.trimEnd() === originalSource.trimEnd(), 'Highlighting did not follow undo');
  await until(async () => (await fetch(`${origin}/api/project`)).json(), project => project.source === originalSource, 'Restored source did not autosave');
}

await mkdir(screenshotDir, { recursive: true });
let browser;
try {
  browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  if (debug) {
    console.log('Browser:', browser.version());
    page.on('console', message => console.log(`Browser console ${message.type()}: ${message.text()}`));
    page.on('download', download => console.log('Download:', download.url()));
    page.on('requestfailed', request => console.log('Failed request:', request.url(), request.failure()));
  }
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  const sourceEditor = page.locator('#source-editor');
  await until(() => sourceEditor.inputValue(), value => value.includes('\\documentclass'), 'Source did not load');
  await until(() => page.locator('#pdf-preview').getAttribute('src'), value => Boolean(value?.includes('/pdf-viewer.html')), 'PDF viewer did not load');
  const initialPreview = await page.locator('#pdf-preview').getAttribute('src');
  const previewUrl = new URL(initialPreview, origin);
  previewUrl.hash = '';
  assert.equal((await fetch(previewUrl)).status, 200);
  await page.frameLocator('#pdf-preview').locator('#pdf-canvas[data-rendered="true"]').waitFor({timeout:20000});
  await checkWorkspaceFeatures(page, sourceEditor);
  await checkContinuousPreview(page);
  await until(() => sourceEditor.inputValue(), value => value.includes('\\documentclass'), 'Source did not reload after PDF position checks');

  if (!readOnly) {
    await jumpPreview(page, 2);
    const beforeCompile = await previewPosition(page);
    const typedSource = initialSource.replace('Original', 'Autocompiled');
    await sourceEditor.fill(typedSource);
    await until(() => page.locator('#source-highlight-content').textContent(), value => value?.trimEnd() === typedSource.trimEnd(), 'Syntax highlighting did not follow typing');
    await until(async () => (await fetch(`${origin}/api/project`)).json(), project => project.source === typedSource, 'Typing did not autosave');
    await until(() => compileCalls, calls => calls.includes(typedSource), 'Typing did not compile automatically');
    await until(() => page.locator('#pdf-preview').getAttribute('src'), value => value !== initialPreview, 'Successful build did not refresh preview');
    await page.frameLocator('#pdf-preview').locator('canvas[data-page="2"][data-rendered="true"]').waitFor({timeout:20000});
    await until(() => previewPosition(page), value => value.page === beforeCompile.page && Math.abs(value.offset - beforeCompile.offset) < 0.06, 'Successful compilation lost the PDF reading position');
    await jumpPreview(page, 1);

    await page.locator('#auto-compile').uncheck();
    const savedSource = typedSource.replace('Autocompiled', 'Saved manually');
    await sourceEditor.fill(savedSource);
    await menuAction(page, 'file', 'save');
    await until(async () => (await fetch(`${origin}/api/project`)).json(), project => project.source === savedSource, 'Save button did not persist source');
    await sourceEditor.press('Control+Enter');
    await until(() => compileCalls, calls => calls.includes(savedSource), 'Ctrl+Enter did not compile');
    const successfulRevision = (await (await fetch(`${origin}/api/project`)).json()).revision;
    const successState = await until(async () => (await fetch(`${origin}/api/state`)).json(), state => state.compiledRevision === successfulRevision && state.status !== 'compiling', 'Manual build did not finish');
    await until(() => page.locator('#pdf-preview').getAttribute('src'), value => Boolean(value) && new URL(value, origin).searchParams.get('version') === String(successState.pdfVersion), 'Manual preview did not update');
    await checkEditHistory(page, sourceEditor, savedSource);
  }

  await page.waitForTimeout(700);
  if (debug) {
    console.log('PDF plugins:', await page.evaluate(() => [...navigator.plugins].map(plugin => plugin.name)));
    for (const frame of page.frames()) {
      console.log('Frame:', frame.url());
      console.log(await frame.evaluate(() => document.documentElement.outerHTML.slice(0, 1500)).catch(error => error.message));
    }
  }
  await page.screenshot({ path: path.join(screenshotDir, readOnly ? 'editor-real-desktop.png' : 'editor-desktop.png'), fullPage: true, animations: 'disabled' });
  assert.deepEqual(errors, [], `Browser errors: ${errors.join('; ')}`);

  if (!readOnly) {
    const lastGoodPreview = await page.locator('#pdf-preview').getAttribute('src');
    const brokenSource = initialSource.replace('Original browser preview', '\\brokencommand');
    await sourceEditor.fill(brokenSource);
    await page.locator('#compile-button').click();
    await until(async () => (await fetch(`${origin}/api/state`)).json(), state => Boolean(state.error) && state.status !== 'compiling', 'Broken source did not produce a compiler error');
    await until(() => page.locator('#compile-log').textContent(), value => value.includes('Undefined control sequence'), 'Compiler diagnostics did not appear');
    assert.equal(await page.locator('#pdf-preview').getAttribute('src'), lastGoodPreview, 'Failed build replaced the last good preview');
    await page.screenshot({ path: path.join(screenshotDir, 'editor-error.png'), fullPage: true, animations: 'disabled' });
  }

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  mobile.on('pageerror', error => errors.push(error.message));
  await mobile.goto(origin, { waitUntil: 'domcontentloaded' });
  await until(() => mobile.locator('#source-editor').inputValue(), value => value.includes('\\documentclass'), 'Mobile source did not load');
  await assertNoOverflow(mobile, 'Mobile');
  await mobile.locator('#sidebar-toggle').click();
  assert.equal(await mobile.locator('.studio').evaluate(element => element.classList.contains('sidebar-open')), true, 'Mobile sidebar button did not open the file tree');
  assert.equal(await mobile.locator('#project-sidebar').isVisible(), true, 'Mobile sidebar is not visible after opening');
  await assertNoOverflow(mobile, 'Mobile with sidebar');
  await mobile.locator('#sidebar-toggle').click();
  await mobile.screenshot({ path: path.join(screenshotDir, readOnly ? 'editor-real-mobile.png' : 'editor-mobile.png'), fullPage: true, animations: 'disabled' });
  await mobile.locator('#preview-tab').click();
  assert.equal(await mobile.locator('#pdf-preview').isVisible(), true, 'Mobile preview tab does not show PDF');
  await mobile.frameLocator('#pdf-preview').locator('#pdf-canvas[data-rendered="true"]').waitFor({timeout:20000});
  await checkTouchPreview(mobile);
  await mobile.screenshot({ path: path.join(screenshotDir, readOnly ? 'editor-real-mobile-preview.png' : 'editor-mobile-preview.png'), fullPage: true, animations: 'disabled' });
  const tablet = await browser.newPage({viewport: {width: 768, height: 1024}, hasTouch: true});
  tablet.on('pageerror', error => errors.push(error.message));
  await tablet.goto(origin, {waitUntil: 'domcontentloaded'});
  await until(() => tablet.locator('#source-editor').inputValue(), value => value.includes('\\documentclass'), 'Tablet source did not load');
  await assertNoOverflow(tablet, 'Tablet');
  await tablet.locator('#sidebar-toggle').click();
  assert.equal(await tablet.locator('#project-sidebar').isVisible(), true, 'Tablet sidebar did not open');
  await assertNoOverflow(tablet, 'Tablet with sidebar');
  await tablet.locator('#sidebar-toggle').click();
  await tablet.screenshot({path: path.join(screenshotDir, readOnly ? 'editor-real-tablet.png' : 'editor-tablet.png'), fullPage: true, animations: 'disabled'});
  await tablet.close();
  assert.deepEqual(errors, [], `Browser errors: ${errors.join('; ')}`);
  console.log(readOnly ? `Read-only desktop, tablet, and mobile checks passed for ${origin}, including continuous PDF wheel/touch scrolling, page jumps, zoom, and restored reading position.` : 'Browser checks passed: file tree, outline navigation, highlighted typing, formatting, typing and toolbar undo/redo, menus, layouts, asset previews, autosave, auto compile, Save, Ctrl+Enter, failed build retention, continuous PDF wheel/touch scrolling, page jumps, zoom, restored reading position, and responsive PDF preview.');
  console.log(`Screenshots: ${screenshotDir}`);
} finally {
  await browser?.close();
  await editor?.close();
  if (fixtureDir) {
    assert.equal(path.dirname(fixtureDir), tmpdir());
    await rm(fixtureDir, { recursive: true, force: true });
  }
}
