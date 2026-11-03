"use strict";

(() => {
  const $ = id => document.getElementById(id);
  const dialog = $('project-dialog');
  if (!dialog) return;
  let busy = false;
  let inspectedPath = '';
  let importFiles = [];
  let recentRequest = 0;
  const maxFiles = 256;
  const maxBodyBytes = 64 * 1024 * 1024;
  const maxContentBytes = 48 * 1024 * 1024;
  const importExtensions = new Set(['tex', 'sty', 'cls', 'tikz', 'bib', 'bst', 'csv', 'txt', 'dat', 'eps', 'png', 'jpg', 'jpeg', 'webp', 'svg', 'pdf', 'ttf', 'otf', 'woff', 'woff2', 'fd', 'def', 'cfg']);
  const excludedDirectories = new Set(['build', 'jobs', 'node_modules', 'cache']);
  const nameSorter = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

  async function projectApi(path, options = {}) {
    const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers }, cache: 'no-store' });
    let body;
    try { body = await response.json(); } catch { body = {}; }
    if (!response.ok) throw new Error(body.error?.message || body.error || body.message || `Request failed (${response.status}).`);
    return body;
  }

  function showError(message = '') {
    $('project-error').textContent = message;
    $('project-error').hidden = !message;
  }

  function setBusy(value) {
    busy = value;
    dialog.setAttribute('aria-busy', String(value));
    for (const control of dialog.querySelectorAll('button, input, select')) {
      if (value) { control.dataset.previousDisabled = String(control.disabled); control.disabled = true; }
      else { control.disabled = control.dataset.previousDisabled === 'true'; delete control.dataset.previousDisabled; }
    }
  }

  function chooseTab(tab) {
    if (busy) return;
    for (const panel of dialog.querySelectorAll('[data-project-panel]')) panel.hidden = panel.dataset.projectPanel !== tab;
    for (const button of dialog.querySelectorAll('[data-project-tab]')) button.setAttribute('aria-pressed', String(button.dataset.projectTab === tab));
    showError();
    if (tab === 'recent') loadRecent();
  }

  function openChooser(tab = 'recent') {
    for (const menu of document.querySelectorAll('details[data-menu]')) menu.open = false;
    if (!dialog.open) dialog.showModal();
    chooseTab(tab);
    if (tab === 'new') $('new-project-name').focus();
    if (tab === 'open') $('open-project-path').focus();
  }

  async function loadRecent() {
    const request = ++recentRequest;
    const list = $('recent-projects');
    try {
      const data = await projectApi('/api/projects');
      if (request !== recentRequest) return;
      const currentId = window.latexStudio?.getProject()?.id || data.activeProjectId;
      const fragment = document.createDocumentFragment();
      for (const project of data.projects || []) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `recent-project${project.id === currentId ? ' current-project' : ''}`;
        button.dataset.projectId = project.id;
        const title = document.createElement('strong');
        title.textContent = project.name || project.mainFile;
        const file = document.createElement('span');
        file.textContent = project.mainFile || 'LaTeX document';
        const path = document.createElement('small');
        path.textContent = project.projectDir || '';
        button.title = `${project.mainFile || ''}\n${project.projectDir || ''}`;
        button.append(title, file, path);
        if (project.id === currentId) button.setAttribute('aria-current', 'page');
        button.addEventListener('click', () => switchDocument(project));
        fragment.append(button);
      }
      if (!fragment.childNodes.length) {
        const empty = document.createElement('p');
        empty.className = 'project-note';
        empty.textContent = 'Create a document or open a folder to get started.';
        fragment.append(empty);
      }
      list.replaceChildren(fragment);
    } catch (error) {
      if (request !== recentRequest) return;
      const note = document.createElement('p');
      note.className = 'project-note';
      note.textContent = 'The document list could not load. Restart the local editor if you recently updated it.';
      list.replaceChildren(note);
      if (!dialog.querySelector('[data-project-panel="recent"]').hidden) showError(error.message);
    }
  }

  async function switchDocument(project) {
    if (busy) return;
    showError();
    setBusy(true);
    let prepared = false;
    try {
      prepared = await window.latexStudio.prepareProjectSwitch();
      if (!prepared) throw new Error('Your current changes could not be saved. Keep this document open and resolve the save message before switching.');
      await projectApi('/api/projects/activate', { method: 'POST', body: JSON.stringify({ id: project.id }) });
      const url = new URL(window.location.href);
      url.searchParams.set('project', project.id);
      url.searchParams.delete('compile');
      window.location.assign(url.href);
    } catch (error) {
      if (prepared) window.latexStudio.cancelProjectSwitch();
      setBusy(false);
      showError(error.message);
    }
  }

  async function createAndOpen(path, payload) {
    if (busy) return;
    showError();
    setBusy(true);
    let prepared = false;
    try {
      prepared = await window.latexStudio.prepareProjectSwitch();
      if (!prepared) throw new Error('Your current changes could not be saved. Keep this document open and resolve the save message before switching.');
      const body = JSON.stringify(payload);
      if (new Blob([body]).size > maxBodyBytes) throw new Error('This import exceeds the 64 MB upload limit after encoding. Select fewer or smaller files.');
      const result = await projectApi(path, { method: 'POST', body });
      const project = result.project;
      if (!project?.id) throw new Error('The server did not return a document ID.');
      await projectApi('/api/projects/activate', { method: 'POST', body: JSON.stringify({ id: project.id }) });
      const url = new URL(window.location.href);
      url.searchParams.set('project', project.id);
      url.searchParams.set('compile', '1');
      window.location.assign(url.href);
    } catch (error) {
      if (prepared) window.latexStudio.cancelProjectSwitch();
      setBusy(false);
      showError(error.message);
    }
  }

  function fillMainFiles(select, files, suggested) {
    select.replaceChildren();
    for (const file of files.slice().sort(nameSorter.compare)) {
      const option = document.createElement('option');
      option.value = typeof file === 'string' ? file : file.name;
      option.textContent = option.value;
      select.append(option);
    }
    if (suggested && [...select.options].some(option => option.value === suggested)) select.value = suggested;
  }

  async function inspectFolder() {
    if (busy) return;
    const projectDir = $('open-project-path').value.trim();
    if (!projectDir) { $('open-project-path').reportValidity(); return; }
    showError();
    setBusy(true);
    let succeeded = false;
    try {
      const result = await projectApi(`/api/projects/inspect?projectDir=${encodeURIComponent(projectDir)}`);
      if (!result.files?.length) throw new Error('This folder does not contain any .tex files.');
      inspectedPath = result.projectDir || projectDir;
      $('open-project-path').value = inspectedPath;
      fillMainFiles($('open-main-file'), result.files, result.suggestedMain);
      $('open-main-picker').hidden = false;
      succeeded = true;
    } catch (error) {
      inspectedPath = '';
      $('open-main-picker').hidden = true;
      showError(error.message);
    } finally { setBusy(false); }
    if (succeeded) $('open-main-file').focus();
  }

  function selectImportFiles(fileList, fromFolder) {
    showError();
    const selectedFiles = [...fileList].map(file => ({
      file,
      name: fromFolder ? (file.webkitRelativePath || file.name).replace(/^[^/]+\//, '') : file.name
    }));
    const isProjectFile = item => {
      const parts = item.name.split('/');
      return !parts.some(part => part.startsWith('.') || excludedDirectories.has(part.toLowerCase()))
        && importExtensions.has(parts[parts.length - 1].split('.').pop().toLowerCase());
    };
    const unsupportedFiles = selectedFiles.filter(item => !isProjectFile(item));
    importFiles = selectedFiles.filter(isProjectFile);
    const total = importFiles.reduce((sum, item) => sum + item.file.size, 0);
    const texFiles = importFiles.filter(item => /\.tex$/i.test(item.name)).map(item => item.name);
    const names = new Set(importFiles.map(item => item.name.toLowerCase()));
    let error = '';
    if (importFiles.length > maxFiles) error = `Choose up to ${maxFiles} files. You selected ${importFiles.length}.`;
    else if (total > maxContentBytes) error = 'Choose project files totaling less than 48 MB. The encoded upload is limited to 64 MB.';
    else if (names.size !== importFiles.length) error = 'Files with duplicate names need to be imported as a folder so their subfolders are preserved.';
    else if (!texFiles.length && selectedFiles.length) error = 'Include at least one .tex source file.';
    else if (!fromFolder && unsupportedFiles.length) error = `Unsupported project file: ${unsupportedFiles[0].name}. Select LaTeX sources, images, fonts, or data files.`;
    $('import-selection-status').textContent = selectedFiles.length ? `${importFiles.length} project files · ${(total / 1024 / 1024).toFixed(1)} MB${fromFolder ? ' · subfolders preserved' : ''}${unsupportedFiles.length ? ` · ${unsupportedFiles.length} generated, hidden, or unsupported files omitted` : ''}` : 'No files selected. Up to 256 files, 48 MB total (64 MB encoded upload).';
    const firstPath = fromFolder ? fileList[0]?.webkitRelativePath?.split('/')[0] : '';
    if (!$('import-project-name').value || fromFolder) $('import-project-name').value = firstPath || texFiles[0]?.split('/').pop().replace(/\.tex$/i, '') || '';
    fillMainFiles($('import-main-file'), texFiles, texFiles.includes('main.tex') ? 'main.tex' : texFiles[0]);
    $('import-main-file').disabled = !texFiles.length || Boolean(error);
    $('import-project-button').disabled = !texFiles.length || Boolean(error);
    if (error) showError(error);
  }

  function readBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
      reader.readAsDataURL(file);
    });
  }

  async function importDocument(event) {
    event.preventDefault();
    if (busy || !importFiles.length || !$('import-main-file').value || !$('import-project-form').reportValidity()) return;
    showError();
    setBusy(true);
    try {
      const files = [];
      for (const item of importFiles) files.push({ name: item.name, content: await readBase64(item.file) });
      const payload = { name: $('import-project-name').value.trim(), mainFile: $('import-main-file').value, files };
      setBusy(false);
      await createAndOpen('/api/projects/import', payload);
    } catch (error) { setBusy(false); showError(error.message); }
  }

  $('project-switcher').addEventListener('click', () => openChooser());
  $('project-dialog-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('click', event => { if (event.target === dialog && !busy) dialog.close(); });
  document.addEventListener('click', event => {
    const action = event.target.closest('[data-project-action]');
    if (action) openChooser(action.dataset.projectAction === 'projects' ? 'recent' : action.dataset.projectAction);
    const tab = event.target.closest('[data-project-tab]');
    if (tab) chooseTab(tab.dataset.projectTab);
  });
  $('refresh-projects-button').addEventListener('click', loadRecent);
  $('new-project-form').addEventListener('submit', event => {
    event.preventDefault();
    if ($('new-project-form').reportValidity()) createAndOpen('/api/projects/new', { name: $('new-project-name').value.trim() });
  });
  $('inspect-project-button').addEventListener('click', inspectFolder);
  $('open-project-path').addEventListener('input', () => { inspectedPath = ''; $('open-main-picker').hidden = true; showError(); });
  $('open-project-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!inspectedPath) { inspectFolder(); return; }
    if ($('open-main-file').value) createAndOpen('/api/projects/open', { projectDir: inspectedPath, mainFile: $('open-main-file').value });
  });
  $('choose-import-files-button').addEventListener('click', () => $('import-file-input').click());
  $('choose-import-folder-button').addEventListener('click', () => $('import-folder-input').click());
  $('browse-project-folder-button').addEventListener('click', () => { chooseTab('import'); $('import-folder-input').click(); });
  $('import-file-input').addEventListener('change', event => selectImportFiles(event.target.files, false));
  $('import-folder-input').addEventListener('change', event => selectImportFiles(event.target.files, true));
  $('import-project-form').addEventListener('submit', importDocument);
  document.addEventListener('latex-project-loaded', event => {
    $('project-switcher').title = `${event.detail.mainFile || event.detail.sourceName}\n${event.detail.projectDir || 'Open or switch documents'}`;
  });
})();
