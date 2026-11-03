import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createProjectManager } from './projects.mjs';

const editorDir = path.dirname(fileURLToPath(import.meta.url));
const screenshotDir = path.resolve(editorDir, '../.artifacts/latex-editor/screenshots');
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0ioAAAAASUVORK5CYII=', 'base64');
const proposalSource = '\\documentclass{article}\n\\begin{document}\n\\section{Proposal fixture}\nOriginal proposal text.\n\\end{document}\n';
const reportSource = '\\documentclass{article}\n\\usepackage{graphicx}\n\\begin{document}\n\\section{Report fixture}\nDifferent document text.\n\\input{sections/chapter}\n\\includegraphics{assets/pixel.png}\n\\end{document}\n';
const chapterSource = '\\subsection{Nested chapter}\nThe nested source belongs to the report.\n';
const importedSource = '\\documentclass{article}\n\\usepackage{graphicx}\n\\begin{document}\n\\section{Imported document}\nImported source and image.\n\\includegraphics{cover.png}\n\\end{document}\n';

function samplePdf(label, pageCount = 3) {
  const fontObject = 3 + pageCount * 2;
  const kids = Array.from({length: pageCount}, (_, index) => `${3 + index * 2} 0 R`).join(' ');
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`];
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

async function until(get, predicate, message, timeout = 20000) {
  const end = Date.now() + timeout;
  let value;
  do {
    value = await get();
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 40));
  } while (Date.now() < end);
  assert.fail(`${message}: ${JSON.stringify(value)}`);
}

async function launch() {
  try { return await chromium.launch({channel: 'chromium', headless: true}); }
  catch (error) {
    if (process.platform !== 'win32') throw error;
    return chromium.launch({channel: 'chrome', headless: true});
  }
}

async function projectDialog(page, tab) {
  await page.locator('#project-switcher').click();
  await page.locator('#project-dialog[open]').waitFor();
  await page.locator(`[data-project-tab="${tab}"]`).click();
}

async function loadedSource(page, text) {
  const editor = page.locator('#source-editor');
  await until(() => editor.isEnabled(), enabled => enabled, 'Source editor did not become enabled');
  await until(() => editor.inputValue(), value => value.includes(text), `Document ${text} did not load`);
  return editor;
}

async function checkContinuousPdf(page) {
  const preview = page.frameLocator('#pdf-preview');
  try {
    await until(() => preview.locator('#pdf-pages .pdf-page').count(), count => count === 3, 'Project PDF page stack did not load');
    await preview.locator('#page-number').fill('1');
    await preview.locator('#page-number').press('Enter');
    await preview.locator('#pdf-canvas[data-rendered="true"]').waitFor({timeout: 20000});
  } catch (error) {
    console.error('PDF readiness diagnostics:', JSON.stringify({
      iframe: await page.locator('#pdf-preview').getAttribute('src'),
      viewer: await preview.locator('body').evaluate(body => ({
        message: document.getElementById('viewer-message')?.textContent,
        page: document.getElementById('page-number')?.value,
        wrappers: document.querySelectorAll('.pdf-page').length,
        canvases: [...document.querySelectorAll('canvas')].map(canvas => ({page: canvas.dataset.page, rendered: canvas.dataset.rendered, hidden: canvas.hidden, width: canvas.width, height: canvas.height})),
        placeholders: [...document.querySelectorAll('.page-placeholder')].map(element => element.textContent),
        text: body.textContent.slice(0, 500)
      })).catch(failure => failure.message)
    }));
    throw error;
  }
  assert.equal(await preview.locator('#pdf-pages .pdf-page').count(), 3, 'Project PDF did not retain the continuous three-page preview');
  const container = preview.locator('#page-container');
  const height = await preview.locator('.pdf-page[data-page="1"]').evaluate(element => element.getBoundingClientRect().height);
  await container.hover();
  await page.mouse.wheel(0, height + 24);
  await until(() => preview.locator('#page-number').inputValue(), value => Number(value) >= 2, 'Wheel scrolling did not reach the next PDF page');
  await preview.locator('canvas[data-page="2"][data-rendered="true"]').waitFor({timeout: 20000});
}

const fixtureDir = await mkdtemp(path.join(tmpdir(), 'latex-projects-browser-'));
const proposalDir = path.join(fixtureDir, 'proposal');
const reportDir = path.join(fixtureDir, 'research-report');
const folderImportDir = path.join(fixtureDir, 'folder-import');
const workDir = path.join(fixtureDir, 'work');
const compileCalls = [];
let manager;
let browser;
let origin;

async function projectApi(endpoint, id, options) {
  const url = new URL(endpoint, origin);
  if (id) url.searchParams.set('project', id);
  const response = await fetch(url, options);
  assert.ok(response.ok, `${endpoint} returned ${response.status}: ${await response.clone().text()}`);
  return response.json();
}

async function pdfBytes(id) {
  const url = new URL('/api/pdf?raw=1', origin);
  url.searchParams.set('project', id);
  const response = await fetch(url);
  assert.equal(response.status, 200, `PDF for project ${id} is unavailable`);
  return Buffer.from(await response.arrayBuffer());
}

async function recentProject(page, id, expectedText) {
  await projectDialog(page, 'recent');
  await page.locator(`#recent-projects button[data-project-id="${id}"]`).click();
  return loadedSource(page, expectedText);
}

try {
  await Promise.all([
    mkdir(path.join(proposalDir, 'build'), {recursive: true}),
    mkdir(path.join(reportDir, 'sections'), {recursive: true}),
    mkdir(path.join(reportDir, 'assets'), {recursive: true}),
    mkdir(workDir, {recursive: true}),
    mkdir(screenshotDir, {recursive: true})
  ]);
  await Promise.all([
    writeFile(path.join(proposalDir, 'main-en.tex'), proposalSource),
    writeFile(path.join(proposalDir, 'build/main-en.pdf'), samplePdf('Original proposal preview')),
    writeFile(path.join(reportDir, 'report.tex'), reportSource),
    writeFile(path.join(reportDir, 'notes.tex'), '% A second file, not the compilation root.\n'),
    writeFile(path.join(reportDir, 'sections/chapter.tex'), chapterSource),
    writeFile(path.join(reportDir, 'assets/pixel.png'), pixel)
  ]);
  const folderSource = reportSource.replace('Different document text.', 'Folder import preserves subfolders.');
  const ignoredFolderFiles = [
    ...Array.from({length: 300}, (_, index) => [`generated-${index}.aux`, 'Generated auxiliary file.']),
    ['report.log', 'Generated compiler output.'],
    ['.git/hidden.tex', 'Hidden repository source.'],
    ['.tools/tool.tex', 'Compiler tools, not document inputs.'],
    ['build/generated.tex', 'Generated build source.'],
    ['jobs/job.tex', 'Generated compilation snapshot.'],
    ['cache/cache.tex', 'Generated cache data.'],
    ['node_modules/dependency.tex', 'Dependency source.']
  ];
  await Promise.all([
    ['report.tex', folderSource], ['sections/chapter.tex', chapterSource], ['assets/pixel.png', pixel], ...ignoredFolderFiles
  ].map(async ([name, content]) => {
    const filename = path.join(folderImportDir, ...name.split('/'));
    await mkdir(path.dirname(filename), {recursive: true});
    await writeFile(filename, content);
  }));
  manager = await createProjectManager({
    projectDir: proposalDir, workDir, assetDir: proposalDir,
    compile: async ({jobDir, sourcePath, outDir, onLog}) => {
      const source = await readFile(sourcePath, 'utf8');
      const mainFile = path.relative(jobDir, sourcePath).replaceAll(path.sep, '/');
      const call = {mainFile, source, chapter: null, image: null};
      if (source.includes('\\input{sections/chapter}')) {
        call.chapter = await readFile(path.join(jobDir, 'sections/chapter.tex'), 'utf8');
        call.image = await readFile(path.join(jobDir, 'assets/pixel.png'));
      } else if (source.includes('\\includegraphics{cover.png}')) {
        call.image = await readFile(path.join(jobDir, 'cover.png'));
      }
      compileCalls.push(call);
      onLog(`Building isolated test document ${mainFile}...\n`);
      await new Promise(resolve => setTimeout(resolve, 80));
      if (source.includes('\\brokencommand')) throw new Error('Undefined control sequence in test source.');
      const pdfPath = path.join(outDir, `${path.parse(sourcePath).name}.pdf`);
      await writeFile(pdfPath, samplePdf(`${mainFile} compilation ${compileCalls.length}`));
      return {pdfPath, log: `Output written on ${path.basename(pdfPath)} (3 pages).\n`};
    }
  });
  await new Promise(resolve => manager.server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${manager.server.address().port}`;
  browser = await launch();
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin, {waitUntil: 'domcontentloaded'});
  await loadedSource(page, 'Original proposal text');
  await page.locator('#auto-compile').uncheck();
  const proposal = await projectApi('/api/project');
  assert.equal(proposal.mainFile || proposal.sourceName, 'main-en.tex');
  const proposalPdf = await pdfBytes(proposal.id);
  await checkContinuousPdf(page);

  // The remainder exercises the project dialog against the real isolated server.
  await projectDialog(page, 'open');
  await page.locator('#open-project-path').fill(reportDir);
  await page.locator('#inspect-project-button').click();
  await until(() => page.locator('#open-main-file option').allTextContents(), values => values.some(value => value.includes('report.tex')), 'Inspect folder did not list the different compilation root');
  await page.locator('#open-main-file').selectOption('report.tex');
  await page.locator('#open-project-button').click();
  const reportEditor = await loadedSource(page, 'Different document text');
  await page.locator('#auto-compile').uncheck();
  const report = await projectApi('/api/project', new URL(page.url()).searchParams.get('project'));
  assert.notEqual(report.id, proposal.id, 'Opening another folder reused the proposal project ID');
  assert.equal(report.mainFile || report.sourceName, 'report.tex', 'Selected compilation root was not saved');
  assert.equal(await page.locator('#source-file').textContent(), 'report.tex', 'Source tab retained a hard-coded proposal filename');
  await until(() => page.locator('#file-tree').textContent(), value => value.includes('sections/chapter.tex') && value.includes('assets/pixel.png'), 'Nested sources and images were not listed');
  const editedReport = reportSource.replace('Different document text.', 'Edited independent report.');
  await reportEditor.fill(editedReport);
  await page.locator('#save-button').click();
  await until(() => readFile(path.join(reportDir, 'report.tex'), 'utf8'), value => value === editedReport, 'Different document did not save back to its selected folder');
  const staleWrite = await fetch(`${origin}/api/source?project=${proposal.id}`, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({source: 'A stale report request must not replace the proposal.', revision: report.revision})
  });
  assert.equal(staleWrite.status, 409, 'A stale save using another document revision was not rejected');
  assert.equal(await readFile(path.join(proposalDir, 'main-en.tex'), 'utf8'), proposalSource, 'A stale report request overwrote the proposal');
  assert.equal(await readFile(path.join(reportDir, 'report.tex'), 'utf8'), editedReport, 'A stale report request overwrote the selected report');
  await page.locator('#compile-button').click();
  await until(() => projectApi('/api/state', report.id), state => state.status === 'ready' && state.hasPdf, 'Different document compilation did not finish');
  const reportCall = compileCalls.find(call => call.mainFile === 'report.tex' && call.source === editedReport);
  assert.ok(reportCall, 'The compiler received the proposal source instead of the selected report');
  assert.equal(reportCall.chapter, chapterSource, 'The compilation snapshot omitted the nested input source');
  assert.deepEqual(reportCall.image, pixel, 'The compilation snapshot omitted the nested image');
  const reportPdf = await pdfBytes(report.id);
  assert.notDeepEqual(reportPdf, proposalPdf, 'Different projects shared the same PDF preview');
  assert.equal(await readFile(path.join(proposalDir, 'main-en.tex'), 'utf8'), proposalSource, 'Editing the report changed the proposal');
  await checkContinuousPdf(page);
  await page.screenshot({path: path.join(screenshotDir, 'editor-multiple-project-report.png'), fullPage: true, animations: 'disabled'});

  await projectDialog(page, 'new');
  await page.locator('#new-project-name').fill('Independent new document');
  await page.locator('#create-project-button').click();
  const newEditor = await loadedSource(page, '\\documentclass');
  await page.locator('#auto-compile').uncheck();
  const newProject = await projectApi('/api/project', new URL(page.url()).searchParams.get('project'));
  assert.notEqual(newProject.id, report.id);
  assert.notEqual(newProject.id, proposal.id);
  const newSource = '\\documentclass{article}\n\\begin{document}\n\\section{Independent document}\nNew document content.\n\\end{document}\n';
  await newEditor.fill(newSource);
  await page.locator('#compile-button').click();
  await until(() => projectApi('/api/state', newProject.id), state => state.status === 'ready' && state.hasPdf, 'New document did not compile');
  assert.equal((await projectApi('/api/project', newProject.id)).source, newSource, 'New document source was not saved before compiling');
  assert.ok(compileCalls.some(call => call.source === newSource), 'New document action did not create a compilable project');

  await projectDialog(page, 'import');
  await page.locator('#import-project-name').fill('Imported image document');
  await page.locator('#import-file-input').setInputFiles([
    {name: 'imported.tex', mimeType: 'text/plain', buffer: Buffer.from(importedSource)},
    {name: 'cover.png', mimeType: 'image/png', buffer: pixel}
  ]);
  await until(() => page.locator('#import-main-file option').allTextContents(), values => values.some(value => value.includes('imported.tex')), 'Import did not list the uploaded LaTeX root');
  await page.locator('#import-main-file').selectOption('imported.tex');
  await page.locator('#import-project-button').click();
  await loadedSource(page, 'Imported source and image');
  await page.locator('#auto-compile').uncheck();
  const imported = await projectApi('/api/project', new URL(page.url()).searchParams.get('project'));
  assert.equal(imported.mainFile || imported.sourceName, 'imported.tex');
  const importedFile = await projectApi('/api/files', imported.id);
  assert.ok(importedFile.files.some(file => file.name === 'cover.png'), 'Import discarded the uploaded image');
  await page.locator('#compile-button').click();
  await until(() => projectApi('/api/state', imported.id), state => state.status === 'ready' && state.hasPdf, 'Imported document did not compile');
  const importCall = compileCalls.find(call => call.source === importedSource);
  assert.ok(importCall, 'Imported source did not reach the compiler');
  assert.deepEqual(importCall.image, pixel, 'Imported image did not reach the compilation snapshot');

  // Real browser folder selection must omit generated files before enforcing
  // the 256-project-file limit, while preserving the supported subfolders.
  let uploadedFolder;
  const captureFolderUpload = request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/projects/import') {
      uploadedFolder = request.postDataJSON();
    }
  };
  page.on('request', captureFolderUpload);
  await projectDialog(page, 'import');
  await page.locator('#import-folder-input').setInputFiles(folderImportDir);
  await until(() => page.locator('#import-selection-status').textContent(), value => value.includes('3 project files') && value.includes('subfolders preserved') && value.includes('files omitted'), 'Folder import did not omit generated files while preserving nested paths');
  const importStatus = await page.locator('#import-selection-status').textContent();
  const omittedCount = Number(/(\d+) generated, hidden, or unsupported files omitted/.exec(importStatus)?.[1]);
  assert.ok(omittedCount >= 300, `Folder import ignored count was missing or incorrect: ${importStatus}`);
  assert.equal(await page.locator('#import-project-button').isEnabled(), true, 'Generated files counted toward the 256-project-file limit');
  assert.deepEqual(await page.locator('#import-main-file option').evaluateAll(options => options.map(option => option.value).sort()), ['report.tex', 'sections/chapter.tex'], 'Folder import main-file picker lost the nested source path');
  await page.locator('#import-main-file').selectOption('report.tex');
  await page.locator('#import-project-button').click();
  await loadedSource(page, 'Folder import preserves subfolders');
  page.off('request', captureFolderUpload);
  const folderProject = await projectApi('/api/project', new URL(page.url()).searchParams.get('project'));
  assert.equal(folderProject.mainFile || folderProject.sourceName, 'report.tex');
  assert.deepEqual(uploadedFolder.files.map(file => file.name).sort(), ['assets/pixel.png', 'report.tex', 'sections/chapter.tex'], 'The browser uploaded generated, hidden, or dependency files from the folder');
  const folderFiles = await projectApi('/api/files', folderProject.id);
  assert.deepEqual(folderFiles.files.map(file => file.name).sort(), ['assets/pixel.png', 'report.tex', 'sections/chapter.tex'], 'The imported project did not contain exactly its supported document files');
  await page.locator('#auto-compile').uncheck();
  await page.locator('#compile-button').click();
  await until(() => projectApi('/api/state', folderProject.id), state => state.status === 'ready' && state.hasPdf, 'Whole-folder import did not compile');
  const folderCall = compileCalls.find(call => call.source === folderSource);
  assert.ok(folderCall, 'Whole-folder source did not reach the compiler');
  assert.equal(folderCall.chapter, chapterSource, 'Whole-folder import lost the nested chapter');
  assert.deepEqual(folderCall.image, pixel, 'Whole-folder import lost the nested image');

  await recentProject(page, report.id, 'Edited independent report');
  assert.equal((await pdfBytes(report.id)).equals(reportPdf), true, 'Switching projects lost the report PDF');
  await recentProject(page, proposal.id, 'Original proposal text');
  assert.equal(await page.locator('#source-editor').inputValue(), proposalSource, 'Switching back changed the proposal source');
  assert.equal((await pdfBytes(proposal.id)).equals(proposalPdf), true, 'Switching back replaced the proposal PDF with another document');
  assert.equal(await readFile(path.join(proposalDir, 'main-en.tex'), 'utf8'), proposalSource, 'Project switching changed the original source on disk');
  const mobile = await browser.newPage({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, deviceScaleFactor: 2});
  mobile.on('pageerror', error => errors.push(error.message));
  await mobile.goto(`${origin}/?project=${proposal.id}`, {waitUntil: 'domcontentloaded'});
  await loadedSource(mobile, 'Original proposal text');
  await projectDialog(mobile, 'recent');
  const mobileDimensions = await mobile.evaluate(() => ({width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth}));
  assert.ok(mobileDimensions.scroll <= mobileDimensions.width + 1, 'Mobile project chooser overflowed horizontally');
  await mobile.screenshot({path: path.join(screenshotDir, 'editor-multiple-project-mobile.png'), fullPage: true, animations: 'disabled'});
  await mobile.locator(`#recent-projects button[data-project-id="${report.id}"]`).click();
  await loadedSource(mobile, 'Edited independent report');
  await mobile.locator('#preview-tab').click();
  await mobile.frameLocator('#pdf-preview').locator('#pdf-canvas[data-rendered="true"]').waitFor({timeout: 20000});
  assert.equal(await mobile.frameLocator('#pdf-preview').locator('#pdf-pages .pdf-page').count(), 3, 'Mobile project switch did not load its PDF');
  await mobile.close();
  assert.deepEqual(errors, [], `Browser errors: ${errors.join('; ')}`);
  console.log('Multiple-project browser checks passed: open another folder, select report.tex, nested source/image snapshot, save and compile, stale save rejection, create a new document, import source and image, import a whole folder while filtering 300+ generated files, switch projects, isolated sources/PDFs, and continuous PDF scrolling.');
} finally {
  await browser?.close();
  await manager?.close();
  assert.equal(path.dirname(fixtureDir), tmpdir(), 'Fixture cleanup escaped the temporary directory');
  assert.ok(path.basename(fixtureDir).startsWith('latex-projects-browser-'), 'Fixture cleanup target was not owned by this test');
  await rm(fixtureDir, {recursive: true, force: true});
}
