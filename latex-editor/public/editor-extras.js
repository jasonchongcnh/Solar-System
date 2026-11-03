"use strict";

(() => {
  const $ = id => document.getElementById(id);
  const studio = document.querySelector('.studio');
  const editor = $('source-editor');
  const highlight = $('source-highlight');
  const highlightContent = $('source-highlight-content') || highlight;
  const outline = $('document-outline');
  const files = $('file-tree');
  const dialog = $('asset-dialog');
  const mobileQuery = matchMedia('(max-width: 900px)');
  let history = [];
  let historyIndex = -1;
  let restoring = false;
  let outlineTimer;
  let layout = 'split';
  let previewRequest = 0;
  let lastOutlineSource = null;
  let sourceName = window.latexStudio?.getSourceName() || 'main-en.tex';
  const projectUrl = path => window.latexProjectUrl ? window.latexProjectUrl(path) : path;

  function syncHighlight() {
    if (!highlight) return;
    highlight.style.width = `${editor.clientWidth}px`;
    highlight.scrollTop = editor.scrollTop;
    highlight.scrollLeft = editor.scrollLeft;
  }

  function renderHighlight() {
    if (!highlight) return;
    const source = editor.value;
    const pattern = /%[^\n]*|\\(?:[a-zA-Z@]+\*?|[^\r\n])|\$\$[\s\S]*?\$\$|\$(?:\\.|[^$\\\r\n])*\$|#\d|[{}\[\]]/g;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const match of source.matchAll(pattern)) {
      fragment.append(document.createTextNode(source.slice(cursor, match.index)));
      const token = document.createElement('span');
      token.className = match[0].startsWith('%') ? 'syntax-comment' : match[0].startsWith('\\') ? 'syntax-command' : match[0].startsWith('$') ? 'syntax-math' : match[0].startsWith('#') ? 'syntax-parameter' : 'syntax-punctuation';
      token.textContent = match[0];
      fragment.append(token);
      cursor = match.index + match[0].length;
    }
    fragment.append(document.createTextNode(source.slice(cursor) + '\n'));
    highlightContent.replaceChildren(fragment);
    $('editor-container').classList.add('highlight-enabled');
    syncHighlight();
  }

  function recordHistory(reset = false) {
    if (restoring) return;
    if (reset) { history = []; historyIndex = -1; }
    const entry = { source: editor.value, start: editor.selectionStart, end: editor.selectionEnd };
    if (history[historyIndex]?.source === entry.source) return;
    history.splice(historyIndex + 1);
    history.push(entry);
    if (history.length > 80) history.shift();
    historyIndex = history.length - 1;
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    for (const button of document.querySelectorAll('[data-editor-action="undo"]')) button.disabled = historyIndex <= 0;
    for (const button of document.querySelectorAll('[data-editor-action="redo"]')) button.disabled = historyIndex >= history.length - 1;
  }

  function restoreHistory(direction) {
    const target = historyIndex + direction;
    if (target < 0 || target >= history.length) return;
    historyIndex = target;
    const entry = history[target];
    restoring = true;
    editor.value = entry.source;
    editor.focus();
    editor.setSelectionRange(entry.start, entry.end);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    restoring = false;
    updateHistoryButtons();
  }

  function insertText(before, after = '', placeholder = '') {
    const start = editor.selectionStart;
    const selection = editor.value.slice(start, editor.selectionEnd) || placeholder;
    editor.setRangeText(before + selection + after, start, editor.selectionEnd, 'end');
    editor.focus();
    editor.setSelectionRange(start + before.length, start + before.length + selection.length);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function toggleComment() {
    const start = editor.value.lastIndexOf('\n', editor.selectionStart - 1) + 1;
    const nextBreak = editor.value.indexOf('\n', editor.selectionEnd);
    const end = nextBreak < 0 ? editor.value.length : nextBreak;
    const lines = editor.value.slice(start, end).split('\n');
    const uncomment = lines.every(line => /^\s*%/.test(line));
    const replacement = lines.map(line => uncomment ? line.replace(/^(\s*)% ?/, '$1') : `% ${line}`).join('\n');
    editor.setRangeText(replacement, start, end, 'select');
    editor.focus();
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function formatSource(action) {
    if (editor.disabled) return;
    if (action === 'undo') restoreHistory(-1);
    if (action === 'redo') restoreHistory(1);
    if (action === 'bold') insertText('\\textbf{', '}', 'text');
    if (action === 'italic') insertText('\\textit{', '}', 'text');
    if (action === 'section') insertText('\\section{', '}\n', 'Section title');
    if (action === 'itemize') insertText('\\begin{itemize}\n  \\item ', '\n\\end{itemize}\n', 'Item');
    if (action === 'comment') toggleComment();
  }

  function readableHeading(text) {
    return text.replace(/\\(?:textbf|textit|emph|textrm)\{([^}]*)\}/g, '$1')
      .replace(/\\([%&_#])/g, '$1').replace(/\\[a-zA-Z]+\s*/g, '').replace(/[{}]/g, '').trim();
  }

  function headingText(line, start) {
    let depth = 1;
    let result = '';
    for (let index = start; index < line.length; index++) {
      const character = line[index];
      if (character === '{' && line[index - 1] !== '\\') depth++;
      if (character === '}' && line[index - 1] !== '\\') depth--;
      if (!depth) break;
      result += character;
    }
    return readableHeading(result);
  }

  function renderOutline() {
    if (!outline || lastOutlineSource === editor.value) return;
    lastOutlineSource = editor.value;
    const fragment = document.createDocumentFragment();
    const counters = [0, 0, 0];
    for (const [index, raw] of editor.value.split('\n').entries()) {
      const line = raw.replace(/(^|[^\\])%.*/, '$1');
      const match = /^\s*\\(section|subsection|subsubsection)(\*)?(?:\[[^\]]*\])?\s*\{/.exec(line);
      if (!match) continue;
      const level = ['section', 'subsection', 'subsubsection'].indexOf(match[1]);
      let number = '';
      if (!match[2]) {
        counters[level]++;
        for (let deeper = level + 1; deeper < 3; deeper++) counters[deeper] = 0;
        number = counters.slice(0, level + 1).join('.') + ' ';
      }
      const title = headingText(line, match[0].length);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'outline-item';
      button.dataset.level = String(level);
      button.dataset.line = String(index + 1);
      button.title = `${title} · line ${index + 1}`;
      button.textContent = number + title;
      button.addEventListener('click', () => {
        $('source-tab').click();
        if (layout === 'preview') setLayout('split');
        window.latexStudio?.jumpToLine(index + 1);
        for (const item of outline.querySelectorAll('.active')) item.classList.remove('active');
        button.classList.add('active');
        if (mobileQuery.matches) studio.classList.remove('sidebar-open');
        updateSidebarButtons();
      });
      fragment.append(button);
    }
    if (!fragment.childNodes.length) {
      const empty = document.createElement('p');
      empty.className = 'sidebar-empty';
      empty.textContent = 'Section headings appear here.';
      fragment.append(empty);
    }
    outline.replaceChildren(fragment);
  }

  function iconFor(type) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('file-icon');
    const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    shape.setAttribute('d', type === 'image' ? 'M3 4h18v16H3z M5 17l5-6 4 4 3-3 4 5 M7 8h.01' : 'M5 3h9l5 5v13H5z M14 3v5h5 M8 12h8 M8 16h6');
    svg.append(shape);
    return svg;
  }

  async function loadFiles() {
    if (!files) return;
    try {
      const response = await fetch(projectUrl('/api/files'), { cache: 'no-store' });
      if (!response.ok) throw new Error('Project files could not load.');
      const project = await response.json();
      const sorter = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
      const entries = project.files.slice().sort((a, b) => (a.name === sourceName ? -1 : b.name === sourceName ? 1 : sorter.compare(a.name, b.name)));
      const fragment = document.createDocumentFragment();
      for (const file of entries) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `file-tree-item${file.name === sourceName ? ' active' : ''}`;
        button.dataset.fileName = file.name;
        button.dataset.fileType = file.type;
        button.title = file.name === sourceName ? `Edit ${sourceName}` : `Preview ${file.name}`;
        if (file.name === sourceName) button.setAttribute('aria-current', 'page');
        button.append(iconFor(file.type));
        const label = document.createElement('span');
        label.className = 'file-label';
        label.textContent = file.name;
        button.append(label);
        button.addEventListener('click', () => {
          if (file.name === sourceName) {
            $('source-tab').click();
            if (layout === 'preview') setLayout('split');
            if (mobileQuery.matches) studio.classList.remove('sidebar-open');
            updateSidebarButtons();
            editor.focus();
          } else openAsset(file);
        });
        fragment.append(button);
      }
      files.replaceChildren(fragment);
    } catch (error) {
      const message = document.createElement('p');
      message.className = 'sidebar-empty';
      message.textContent = error.message;
      files.replaceChildren(message);
    }
  }

  function openDialog(title) {
    $('asset-name').textContent = title;
    $('asset-content').replaceChildren();
    if (!dialog.open) dialog.showModal();
  }

  async function openAsset(file) {
    const ticket = ++previewRequest;
    openDialog(file.name);
    const content = $('asset-content');
    const url = projectUrl(`/api/asset?name=${encodeURIComponent(file.name)}`);
    const note = document.createElement('p');
    note.className = 'asset-note';
    note.textContent = 'File preview';
    content.append(note);
    if (file.type === 'image') {
      const image = document.createElement('img');
      image.alt = file.name;
      image.src = url;
      image.addEventListener('error', () => { if (ticket === previewRequest) note.textContent = 'This image could not load.'; });
      content.append(image);
    } else if (file.type === 'pdf') {
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.className = 'button';
      link.textContent = 'Open PDF';
      content.append(link);
    } else {
      note.textContent = 'Read-only file preview';
      const pre = document.createElement('pre');
      pre.textContent = 'Loading…';
      content.append(pre);
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('This file could not load.');
        const source = await response.text();
        if (ticket === previewRequest) pre.textContent = source;
      } catch (error) { if (ticket === previewRequest) pre.textContent = error.message; }
    }
  }

  function showHelp() {
    ++previewRequest;
    openDialog('Editor shortcuts');
    const list = document.createElement('dl');
    for (const [shortcut, description] of [['Ctrl + S', 'Save document'], ['Ctrl + Enter', 'Recompile document'], ['Ctrl + F', 'Find in source'], ['Ctrl + Z', 'Undo'], ['Ctrl + Shift + Z', 'Redo'], ['Tab / Shift + Tab', 'Indent / outdent selected lines']]) {
      const key = document.createElement('dt'); key.textContent = shortcut;
      const value = document.createElement('dd'); value.textContent = description;
      list.append(key, value);
    }
    $('asset-content').append(list);
  }

  function updateSidebarButtons() {
    const visible = mobileQuery.matches ? studio.classList.contains('sidebar-open') : !studio.classList.contains('sidebar-hidden');
    $('sidebar-toggle')?.setAttribute('aria-expanded', String(visible));
    const outlineVisible = !studio.classList.contains('outline-hidden');
    $('outline-toggle')?.setAttribute('aria-pressed', String(outlineVisible));
    $('outline-toggle')?.setAttribute('aria-expanded', String(outlineVisible));
  }

  function toggleSidebar() {
    studio.classList.toggle(mobileQuery.matches ? 'sidebar-open' : 'sidebar-hidden');
    updateSidebarButtons();
    requestAnimationFrame(syncHighlight);
  }

  function setLayout(value) {
    layout = value;
    $('workspace').classList.toggle('layout-source', value === 'source');
    $('workspace').classList.toggle('layout-preview', value === 'preview');
    if (mobileQuery.matches) $(value === 'preview' ? 'preview-tab' : 'source-tab').click();
    const button = $('layout-button');
    if (button) {
      button.dataset.layout = value;
      button.title = `Layout: ${value}. Click to change.`;
      button.setAttribute('aria-label', `Layout: ${value}. Change layout`);
    }
    requestAnimationFrame(syncHighlight);
  }

  function closeMenus(except = null) {
    for (const menu of document.querySelectorAll('details[data-menu]')) if (menu !== except) menu.open = false;
  }

  function runAction(action) {
    if (action === 'save') $('save-button').click();
    if (action === 'compile') $('compile-button').click();
    if (action === 'reload') $('reload-button').click();
    if (action === 'find') { $('source-tab').click(); $('find-button').click(); }
    if (action === 'wrap') $('wrap-button').click();
    if (action === 'sidebar') toggleSidebar();
    if (action === 'outline') { studio.classList.toggle('outline-hidden'); updateSidebarButtons(); }
    if (action === 'layout') setLayout(['split', 'source', 'preview'][(['split', 'source', 'preview'].indexOf(layout) + 1) % 3]);
    if (action === 'layout-source') setLayout('source');
    if (action === 'layout-preview') setLayout('preview');
    if (action === 'layout-split') setLayout('split');
    if (action === 'refresh-files') loadFiles();
    if (action === 'help') showHelp();
    if (action === 'download-pdf') $('download-link').click();
    if (action === 'download-source') {
      const url = URL.createObjectURL(new Blob([editor.value], { type: 'text/plain;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url; link.download = sourceName.split(/[\\/]/).pop(); link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  document.addEventListener('click', event => {
    const format = event.target.closest('[data-editor-action]');
    const action = event.target.closest('[data-action]');
    if (format) { formatSource(format.dataset.editorAction); closeMenus(); }
    else if (action) { runAction(action.dataset.action); closeMenus(); }
    else if (!event.target.closest('details[data-menu]')) closeMenus();
    if (mobileQuery.matches && studio.classList.contains('sidebar-open') && !event.target.closest('#project-sidebar, #sidebar-toggle, [data-action="sidebar"]')) {
      studio.classList.remove('sidebar-open'); updateSidebarButtons();
    }
  });
  for (const menu of document.querySelectorAll('details[data-menu]')) menu.addEventListener('toggle', () => { if (menu.open) closeMenus(menu); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { closeMenus(); studio.classList.remove('sidebar-open'); updateSidebarButtons(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && event.target === editor) {
      event.preventDefault(); restoreHistory(event.shiftKey ? 1 : -1);
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y' && event.target === editor) {
      event.preventDefault(); restoreHistory(1);
    }
  });
  $('asset-close')?.addEventListener('click', () => dialog.close());
  $('sidebar-toggle')?.addEventListener('click', toggleSidebar);
  $('outline-toggle')?.addEventListener('click', () => runAction('outline'));
  $('layout-button')?.addEventListener('click', () => runAction('layout'));
  dialog?.addEventListener('close', () => { ++previewRequest; });
  dialog?.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  editor.addEventListener('input', () => recordHistory());
  editor.addEventListener('scroll', syncHighlight);
  document.addEventListener('latex-source-change', () => {
    renderHighlight();
    recordHistory();
    clearTimeout(outlineTimer);
    outlineTimer = setTimeout(renderOutline, 180);
  });
  document.addEventListener('latex-project-loaded', event => {
    sourceName = event.detail.sourceName || event.detail.mainFile || 'main-en.tex';
    recordHistory(true); renderHighlight(); renderOutline(); loadFiles();
  });
  document.addEventListener('latex-editor-wrap', () => requestAnimationFrame(syncHighlight));
  new ResizeObserver(syncHighlight).observe(editor);
  mobileQuery.addEventListener('change', () => { studio.classList.remove('sidebar-open'); updateSidebarButtons(); });
  updateSidebarButtons(); setLayout('split'); updateHistoryButtons();
  if (!editor.disabled) { recordHistory(true); renderHighlight(); renderOutline(); loadFiles(); }
})();
