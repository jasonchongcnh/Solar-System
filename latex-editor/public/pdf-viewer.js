import * as pdfjs from '/vendor/pdfjs/pdf.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.mjs';
const $ = id => document.getElementById(id);
const container = $('page-container');
const pageList = $('pdf-pages');
const parameters = new URLSearchParams(location.search);
const version = parameters.get('version');
const projectId = parameters.get('project');
const pdfParameters = new URLSearchParams();
if (version) pdfParameters.set('version', version);
if (projectId) pdfParameters.set('project', projectId);
const pdfUrl = '/api/pdf' + (pdfParameters.size ? '?' + pdfParameters : '');
const positionKey = projectId ? 'latex-preview-position:' + projectId : 'latex-preview-position';
$('open-pdf').href = pdfUrl;
let documentPdf;
let pages = [];
let pageNumber = 1;
let zoom = 'fit';
let initialPosition = { page: 1, offset: 0 };
try {
  const stored = JSON.parse(sessionStorage.getItem(positionKey) || '{}');
  pageNumber = Math.max(1, Math.trunc(Number(stored.page) || 1));
  if ([...$('zoom').options].some(option => option.value === stored.zoom)) zoom = stored.zoom;
  initialPosition = { page: pageNumber, offset: Number.isFinite(stored.offset) ? stored.offset : 0 };
} catch { /* Default position works when browser storage is unavailable. */ }
$('zoom').value = zoom;
let layoutReady = false;
let layoutWidth = 0;
let layoutZoom = null;
let generation = 0;
let renderRunning = false;
let renderPending = false;
let frame;
let saveTimer;
let resizeTimer;
let useSequence = 0;
let editingPageNumber = false;

function pageTop(entry) {
  return entry.node.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
}
function visiblePages(buffer = 0) {
  const top = container.scrollTop - buffer;
  const bottom = container.scrollTop + container.clientHeight + buffer;
  return pages.filter(entry => pageTop(entry) + entry.height > top && pageTop(entry) < bottom);
}
function activePage() {
  if (!layoutReady) return pages[pageNumber - 1];
  const top = container.scrollTop;
  const bottom = top + container.clientHeight;
  let selected = pages[pageNumber - 1];
  let largest = 0;
  for (const entry of pages) {
    const start = pageTop(entry);
    const amount = Math.max(0, Math.min(bottom, start + entry.height) - Math.max(top, start));
    if (amount > largest) { selected = entry; largest = amount; }
  }
  return selected;
}
function currentPosition() {
  if (!layoutReady) return initialPosition;
  const entry = activePage();
  return { page: entry?.number || 1, offset: entry ? (container.scrollTop - pageTop(entry)) / entry.height : 0 };
}
function savePosition() {
  clearTimeout(saveTimer);
  const position = currentPosition();
  try { sessionStorage.setItem(positionKey, JSON.stringify({ ...position, zoom })); } catch { }
}
function updateControls() {
  $('page-number').disabled = !documentPdf;
  if (!editingPageNumber) $('page-number').value = pageNumber;
  $('page-number').max = documentPdf?.numPages || 1;
  $('page-count').textContent = '/ ' + (documentPdf?.numPages || '—');
  $('previous-page').disabled = !documentPdf || pageNumber === 1;
  $('next-page').disabled = !documentPdf || pageNumber >= documentPdf.numPages;
}
function trackScroll() {
  if (!layoutReady) return;
  pageNumber = activePage()?.number || 1;
  updateControls();
  requestRendering();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(savePosition, 150);
}
function clearCanvas(entry) {
  if (entry.task) return;
  entry.canvas.width = 0;
  entry.canvas.height = 0;
  entry.canvas.hidden = true;
  entry.canvas.dataset.rendered = 'false';
  entry.renderedGeneration = -1;
  entry.placeholder.hidden = false;
}
function trimCanvasCache() {
  const visible = new Set(visiblePages());
  const rendered = pages.filter(entry => !entry.canvas.hidden);
  const candidates = rendered.filter(entry => !visible.has(entry) && !entry.task).sort((a, b) => a.lastUsed - b.lastUsed);
  let excess = rendered.length - 6;
  for (const entry of candidates) {
    const distance = Math.abs(pageTop(entry) - container.scrollTop);
    if (excess > 0 || distance > container.clientHeight * 3 + entry.height) {
      clearCanvas(entry);
      excess--;
    }
  }
}
async function renderNearbyPages() {
  renderRunning = true;
  try {
    while (renderPending && layoutReady) {
      renderPending = false;
      const ticket = generation;
      const center = container.scrollTop + container.clientHeight / 2;
      const targets = visiblePages(container.clientHeight * 0.8)
        .sort((a, b) => Math.abs(pageTop(a) + a.height / 2 - center) - Math.abs(pageTop(b) + b.height / 2 - center));
      for (const entry of targets) {
        if (ticket !== generation) break;
        if (entry.renderedGeneration === ticket && !entry.canvas.hidden) { entry.lastUsed = ++useSequence; continue; }
        const ratio = Math.min(devicePixelRatio || 1, 2, Math.sqrt(4_000_000 / (entry.width * entry.height)));
        const nextCanvas = document.createElement('canvas');
        nextCanvas.width = Math.max(1, Math.ceil(entry.width * ratio));
        nextCanvas.height = Math.max(1, Math.ceil(entry.height * ratio));
        entry.node.setAttribute('aria-busy', 'true');
        const task = entry.pdfPage.render({
          canvasContext: nextCanvas.getContext('2d'), viewport: entry.viewport,
          transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
        });
        entry.task = task;
        try { await task.promise; }
        catch (error) {
          if (error.name === 'RenderingCancelledException') continue;
          entry.placeholder.textContent = 'Page ' + entry.number + ' could not render. Use Open PDF to view it.';
          entry.placeholder.hidden = false;
          entry.node.setAttribute('aria-busy', 'false');
          continue;
        } finally { if (entry.task === task) entry.task = null; }
        if (ticket !== generation) continue;
        entry.canvas.width = nextCanvas.width;
        entry.canvas.height = nextCanvas.height;
        entry.canvas.getContext('2d').drawImage(nextCanvas, 0, 0);
        entry.canvas.hidden = false;
        entry.canvas.dataset.rendered = 'true';
        entry.renderedGeneration = ticket;
        entry.lastUsed = ++useSequence;
        entry.placeholder.hidden = true;
        entry.node.setAttribute('aria-busy', 'false');
        $('viewer-message').hidden = true;
        trimCanvasCache();
      }
    }
  } finally {
    renderRunning = false;
    if (renderPending && layoutReady) requestRendering();
  }
}
function requestRendering() {
  if (!layoutReady || container.clientWidth < 40 || container.clientHeight < 1) return;
  renderPending = true;
  if (!renderRunning) renderNearbyPages().catch(showError);
}
function showError(error) {
  $('viewer-message').textContent = 'The preview could not load. Use Open PDF to view the document. ' + error.message;
  $('viewer-message').hidden = false;
}
function restorePosition(position) {
  const number = Math.min(pages.length, Math.max(1, Math.trunc(Number(position.page) || 1)));
  const entry = pages[number - 1];
  const offset = Number.isFinite(position.offset) ? position.offset : 0;
  container.scrollTop = Math.max(0, pageTop(entry) + offset * entry.height);
  pageNumber = number;
  updateControls();
}
function layoutPages(position = currentPosition()) {
  if (!pages.length || container.clientWidth < 40 || container.clientHeight < 1) return;
  const style = getComputedStyle(container);
  const width = Math.max(80, container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
  if (!layoutReady || Math.abs(width - layoutWidth) > 0.5 || zoom !== layoutZoom) {
    generation++;
    for (const entry of pages) {
      entry.task?.cancel();
      const scale = zoom === 'fit' ? width / entry.base.width : Number(zoom);
      entry.viewport = entry.pdfPage.getViewport({ scale });
      entry.width = entry.viewport.width;
      entry.height = entry.viewport.height;
      entry.node.style.width = entry.width + 'px';
      entry.node.style.height = entry.height + 'px';
      entry.canvas.dataset.rendered = 'false';
    }
    layoutReady = true;
    layoutWidth = width;
    layoutZoom = zoom;
    restorePosition(position);
  }
  trackScroll();
}
function goToPage(value) {
  if (!documentPdf) return;
  editingPageNumber = false;
  const number = Math.min(documentPdf.numPages, Math.max(1, Math.trunc(Number(value) || 1)));
  if (!layoutReady) {
    initialPosition = { page: number, offset: 0 };
    layoutPages(initialPosition);
  }
  if (layoutReady) restorePosition({ page: number, offset: 0 });
  pageNumber = number;
  $('page-number').value = number;
  updateControls();
  savePosition();
  requestRendering();
}
$('previous-page').addEventListener('click', () => goToPage(pageNumber - 1));
$('next-page').addEventListener('click', () => goToPage(pageNumber + 1));
$('page-number').addEventListener('change', event => goToPage(event.target.value));
$('page-number').addEventListener('input', () => { editingPageNumber = true; });
$('page-number').addEventListener('blur', () => { editingPageNumber = false; updateControls(); });
$('page-number').addEventListener('keydown', event => {
  if (event.key === 'Enter') { goToPage(event.target.value); container.focus({ preventScroll: true }); }
});
$('zoom').addEventListener('change', event => {
  const position = currentPosition();
  zoom = event.target.value;
  layoutPages(position);
  savePosition();
});
container.addEventListener('scroll', () => {
  if (frame) return;
  frame = requestAnimationFrame(() => { frame = null; trackScroll(); });
}, { passive: true });
container.addEventListener('keydown', event => {
  if (event.key === 'ArrowRight') { event.preventDefault(); goToPage(pageNumber + 1); }
  if (event.key === 'ArrowLeft') { event.preventDefault(); goToPage(pageNumber - 1); }
});
new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => layoutPages(currentPosition()), 120);
}).observe(container);
window.addEventListener('pagehide', savePosition);
try {
  const response = await fetch(pdfUrl + (pdfUrl.includes('?') ? '&' : '?') + 'raw=1');
  if (!response.ok) throw new Error('PDF request failed (' + response.status + ')');
  const pdfBytes = new Uint8Array(await response.arrayBuffer());
  documentPdf = await pdfjs.getDocument({
    data: pdfBytes, cMapUrl: '/vendor/pdfjs/cmaps/', cMapPacked: true,
    standardFontDataUrl: '/vendor/pdfjs/standard_fonts/', wasmUrl: '/vendor/pdfjs/wasm/',
    isEvalSupported: false,
  }).promise;
  const pdfPages = await Promise.all(Array.from({ length: documentPdf.numPages }, (_, index) => documentPdf.getPage(index + 1)));
  const fragment = document.createDocumentFragment();
  pages = pdfPages.map((pdfPage, index) => {
    const number = index + 1;
    const node = document.createElement('section');
    node.className = 'pdf-page';
    node.dataset.page = String(number);
    node.setAttribute('aria-label', 'Document page ' + number + ' of ' + documentPdf.numPages);
    node.setAttribute('aria-busy', 'true');
    const placeholder = document.createElement('span');
    placeholder.className = 'page-placeholder';
    placeholder.textContent = 'Loading page ' + number + '…';
    const canvas = document.createElement('canvas');
    canvas.id = number === 1 ? 'pdf-canvas' : 'pdf-canvas-' + number;
    canvas.dataset.page = String(number);
    canvas.dataset.rendered = 'false';
    canvas.setAttribute('aria-label', 'Document page ' + number + ' of ' + documentPdf.numPages);
    canvas.width = 0; canvas.height = 0; canvas.hidden = true;
    node.append(placeholder, canvas);
    fragment.append(node);
    return { number, pdfPage, node, placeholder, canvas, base: pdfPage.getViewport({ scale: 1 }),
      width: 0, height: 0, renderedGeneration: -1, lastUsed: 0, task: null };
  });
  pageList.replaceChildren(fragment);
  $('viewer-message').hidden = true;
  pageNumber = Math.min(documentPdf.numPages, pageNumber);
  initialPosition.page = pageNumber;
  updateControls();
  layoutPages(initialPosition);
} catch (error) { showError(error); }
