"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  let projectId = new URLSearchParams(window.location.search).get("project") || "";
  let projectDescriptor = null;
  let switchingProject = false;
  let sourceName = "main-en.tex";
  function projectUrl(path) {
    const url = new URL(path, window.location.origin);
    if (projectId) url.searchParams.set("project", projectId);
    return `${url.pathname}${url.search}${url.hash}`;
  }
  window.latexProjectUrl = projectUrl;
  const editor = $("source-editor");
  const autoCompile = $("auto-compile");
  const compileButton = $("compile-button");
  const saveButton = $("save-button");
  const pdfFrame = $("pdf-preview");
  const buildLabel = $("build-label");
  const saveStatus = $("save-status");
  let revision = null;
  let persistedSource = "";
  let loaded = false;
  let conflict = false;
  let savePromise = null;
  let saveTimer;
  let compileTimer;
  let eventStream;
  let currentState = { status: "idle" };
  let compileRequestedRevision = null;
  let previewVersion = null;
  let hasPreview = false;
  let compileStartedAt = null;
  let requestPending = false;
  let lastCompileError = null;
  let pendingSaveError = null;
  let findTerm = "";
  let resizePointerId = null;

  const sameRevision = (a, b) => a != null && b != null && String(a) === String(b);
  const isDirty = () => loaded && editor.value !== persistedSource;
  const stateRevision = (state) => state.status === "ready" && state.compiledRevision != null ? state.compiledRevision : state.buildRevision != null ? state.buildRevision : state.sourceRevision;
  const sourceIsCurrent = (state) => !isDirty() && sameRevision(stateRevision(state), revision);
  const seconds = (duration) => `${Math.max(0.1, Number(duration) / 1000).toFixed(1)}s`;
  const textValue = (value) => typeof value === "string" ? value : value && typeof value.message === "string" ? value.message : value == null ? "" : String(value);

  async function api(path, options = {}) {
    const response = await fetch(projectUrl(path), { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) }, cache: "no-store" });
    let body;
    try { body = await response.json(); } catch { body = {}; }
    if (!response.ok) {
      const error = new Error(textValue(body.error) || textValue(body.message) || `Request failed (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function showNotice(message, { persistent = false, reload = false } = {}) {
    $("notice-message").textContent = message;
    $("notice").hidden = false;
    $("notice-dismiss").hidden = persistent;
    $("reload-button").hidden = !reload;
  }

  function hideNotice() {
    if (!conflict) $("notice").hidden = true;
  }

  function updateSaveStatus() {
    let message = "Saved";
    let kind = "";
    if (!loaded) message = "Loading…";
    else if (conflict) { message = "File changed outside editor"; kind = "error"; }
    else if (savePromise) { message = "Saving…"; kind = "pending"; }
    else if (pendingSaveError) { message = "Save failed"; kind = "error"; }
    else if (isDirty()) { message = "Unsaved changes"; kind = "pending"; }
    const dot = document.createElement("span");
    dot.className = `status-dot ${kind}`;
    saveStatus.replaceChildren(dot, document.createTextNode(message));
    $("modified-dot").hidden = !isDirty();
    editor.disabled = !loaded || switchingProject;
    compileButton.disabled = !loaded || conflict || requestPending || switchingProject;
    saveButton.disabled = !loaded || conflict || Boolean(savePromise) || switchingProject;
    $("empty-compile").disabled = !loaded || conflict || requestPending;
  }

  function updateBuildStatus() {
    const status = $("build-status");
    status.className = "build-status";
    const compiling = currentState.status === "compiling";
    $("compile-progress").hidden = !compiling;
    if (conflict) {
      buildLabel.textContent = "Reload to continue";
      status.classList.add("error");
    } else if (!loaded) buildLabel.textContent = "Loading preview";
    else if (compiling) {
      const elapsed = compileStartedAt ? Math.max(0, Math.floor((Date.now() - compileStartedAt) / 1000)) : 0;
      buildLabel.textContent = `${currentState.queued ? "Compiling · next build queued" : "Compiling"}${elapsed > 0 ? ` · ${elapsed}s` : "…"}`;
      status.classList.add("compiling");
    } else if (currentState.status === "error" && sourceIsCurrent(currentState)) {
      buildLabel.textContent = "Compilation failed";
      status.classList.add("error");
    } else if (requestPending) {
      buildLabel.textContent = "Starting compilation…";
      status.classList.add("compiling");
    } else if (!sourceIsCurrent(currentState)) {
      buildLabel.textContent = autoCompile.checked ? "Changes pending" : "Ready to compile";
    } else if (hasPreview) {
      buildLabel.textContent = currentState.durationMs != null ? `Compiled · ${seconds(currentState.durationMs)}` : "Preview ready";
      status.classList.add("ready");
    } else buildLabel.textContent = "Ready to compile";
  }

  function updateCursor() {
    const before = editor.value.slice(0, editor.selectionStart);
    const lines = before.split("\n");
    $("cursor-position").textContent = `Ln ${lines.length}, Col ${lines[lines.length - 1].length + 1}`;
  }

  function updateLineNumbers() {
    const count = editor.value.split("\n").length;
    $("line-numbers").textContent = Array.from({ length: count }, (_, index) => index + 1).join("\n");
    syncGutter();
  }

  function syncGutter() {
    $("line-numbers").style.transform = `translateY(-${editor.scrollTop}px)`;
  }

  function setLogOpen(open) {
    $("log-toggle").setAttribute("aria-expanded", String(open));
    $("log-content").hidden = !open;
  }

  function jumpToLine(line) {
    const lines = editor.value.split("\n");
    const bounded = Math.min(Math.max(Number(line), 1), lines.length);
    let offset = 0;
    for (let index = 0; index < bounded - 1; index++) offset += lines[index].length + 1;
    activateTab("source");
    editor.focus();
    editor.setSelectionRange(offset, offset + lines[bounded - 1].length);
    const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 23;
    editor.scrollTop = Math.max(0, (bounded - 1) * lineHeight - editor.clientHeight / 3);
    syncGutter();
    updateCursor();
  }

  function updateLog(state) {
    const output = textValue(state.log);
    const error = textValue(state.error);
    if (output || error) $("compile-log").textContent = `${error && !output.includes(error) ? `${error}\n\n` : ""}${output}`;
    const failed = state.status === "error";
    $("log-badge").hidden = !failed;
    $("log-badge").textContent = "Error";
    $("log-summary").textContent = state.status === "compiling" ? "Compiling your document…" : failed ? "Review the compiler message" : state.status === "ready" ? !sourceIsCurrent(state) ? "Changes waiting for compilation" : `Compilation successful${state.durationMs != null ? ` · ${seconds(state.durationMs)}` : ""}` : "Ready when you are";
    const links = $("log-error-links");
    links.replaceChildren();
    if (failed) {
      const combined = `${error}\n${output}`;
      const matches = [...combined.matchAll(/(?:\bl\.(\d+)\b|(?:[\w.-]+\.tex):(\d+)(?::|\b)|\bline\s+(\d+)\b)/gi)];
      const lineNumbers = new Set(matches.map((match) => Number(match[1] || match[2] || match[3])));
      if (state.error && typeof state.error === "object" && state.error.line) lineNumbers.add(Number(state.error.line));
      [...lineNumbers].filter((line) => line > 0).slice(0, 8).forEach((line) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = `Go to line ${line}`;
        button.addEventListener("click", () => jumpToLine(line));
        links.append(button);
      });
    }
  }

  function showPdf(version, { initial = false } = {}) {
    if (!initial && String(version) === String(previewVersion) && hasPreview) return;
    previewVersion = version;
    hasPreview = true;
    pdfFrame.src = projectUrl(version == null ? '/pdf-viewer.html' : `/pdf-viewer.html?version=${encodeURIComponent(version)}`);
    pdfFrame.hidden = false;
    $("preview-empty").hidden = true;
    $("download-link").setAttribute("aria-disabled", "false");
    $("preview-updated").textContent = initial ? "Existing PDF loaded" : `Updated ${new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date())}`;
  }

  function handleState(nextState) {
    if (!nextState || typeof nextState !== "object") return;
    const previouslyCompiling = currentState.status === "compiling";
    const previousJob = currentState.jobId;
    currentState = nextState;
    if (nextState.status === "compiling" && (!previouslyCompiling || nextState.jobId !== previousJob)) compileStartedAt = Date.now();
    if (nextState.status !== "compiling") compileStartedAt = null;
    updateLog(nextState);
    if (nextState.status === "ready" && sourceIsCurrent(nextState) && nextState.pdfVersion != null) {
      showPdf(nextState.pdfVersion);
      lastCompileError = null;
      if (!pendingSaveError) hideNotice();
    }
    if (nextState.status === "error" && sourceIsCurrent(nextState)) {
      const key = `${nextState.jobId || ""}:${textValue(nextState.error)}`;
      if (key !== lastCompileError) {
        lastCompileError = key;
        setLogOpen(true);
        showNotice(hasPreview ? "Compilation needs attention. Your last successful PDF is still available." : "Compilation needs attention. Open the log to find the error.");
      }
    }
    updateBuildStatus();
    updateSaveStatus();
  }

  function connectEvents() {
    if (eventStream) eventStream.close();
    eventStream = new EventSource(projectUrl("/api/events"));
    eventStream.addEventListener("state", (event) => {
      try { handleState(JSON.parse(event.data)); } catch { /* Keep the current workspace on an incomplete event. */ }
    });
    eventStream.onopen = () => { $("connection-status").hidden = true; };
    eventStream.onerror = () => { $("connection-status").hidden = false; };
  }

  async function saveSource() {
    if (!loaded || conflict) return false;
    clearTimeout(saveTimer);
    if (savePromise) return savePromise;
    if (!isDirty()) { updateSaveStatus(); return true; }
    const run = async () => {
      while (isDirty() && !conflict) {
        const snapshot = editor.value;
        try {
          const saved = await api("/api/source", { method: "POST", body: JSON.stringify({ source: snapshot, revision }) });
          revision = saved.revision;
          persistedSource = snapshot;
          pendingSaveError = null;
        } catch (error) {
          if (error.status === 409) {
            conflict = true;
            clearTimeout(compileTimer);
            showNotice("This file changed outside the editor. Your edits are still here. Copy them before reloading from disk.", { persistent: true, reload: true });
          } else {
            pendingSaveError = error.message;
            showNotice(`Your changes could not be saved. ${error.message}`);
          }
          return false;
        }
      }
      return !conflict;
    };
    savePromise = run();
    updateSaveStatus();
    let success;
    try { success = await savePromise; }
    finally { savePromise = null; updateSaveStatus(); updateBuildStatus(); }
    return success;
  }

  async function requestCompile({ manual = false } = {}) {
    clearTimeout(compileTimer);
    if (!loaded || conflict || requestPending || switchingProject) return;
    let requestedRevision = null;
    requestPending = true;
    updateBuildStatus();
    updateSaveStatus();
    try {
      const saved = await saveSource();
      if (!saved || conflict || isDirty()) return;
      if (!manual && sameRevision(compileRequestedRevision, revision)) return;
      requestedRevision = revision;
      await api("/api/compile", { method: "POST", body: JSON.stringify({ revision: requestedRevision }) });
      compileRequestedRevision = requestedRevision;
      pendingSaveError = null;
      if (!conflict && !lastCompileError) hideNotice();
    } catch (error) {
      if (error.status === 409) {
        conflict = true;
        showNotice("This file changed outside the editor. Your edits are still here. Copy them before reloading from disk.", { persistent: true, reload: true });
      } else showNotice(`Compilation could not start. ${error.message}`);
    } finally {
      requestPending = false;
      updateSaveStatus();
      updateBuildStatus();
      if (autoCompile.checked && requestedRevision != null && (!sameRevision(requestedRevision, revision) || isDirty()) && !conflict) scheduleCompile();
    }
  }

  function scheduleCompile() {
    clearTimeout(compileTimer);
    if (autoCompile.checked && !conflict && !switchingProject) compileTimer = setTimeout(() => requestCompile(), 1100);
  }

  function onSourceChange() {
    pendingSaveError = null;
    updateLineNumbers();
    updateCursor();
    updateSaveStatus();
    updateBuildStatus();
    updateFindCount();
    document.dispatchEvent(new CustomEvent("latex-source-change", { detail: { source: editor.value } }));
    clearTimeout(saveTimer);
    if (!conflict) saveTimer = setTimeout(saveSource, 600);
    scheduleCompile();
  }

  async function loadProject() {
    try {
      const project = await api("/api/project");
      if (project.id) {
        projectId = String(project.id);
        const currentUrl = new URL(window.location.href);
        currentUrl.searchParams.set("project", projectId);
        window.history.replaceState(null, "", currentUrl);
      }
      sourceName = project.sourceName || project.mainFile || (/\.tex$/i.test(project.name || "") ? project.name : "main-en.tex");
      projectDescriptor = { id: projectId, name: project.name || sourceName, sourceName, mainFile: project.mainFile || sourceName, projectDir: project.projectDir || "" };
      persistedSource = typeof project.source === "string" ? project.source : "";
      revision = project.revision;
      editor.value = persistedSource;
      loaded = true;
      conflict = false;
      pendingSaveError = null;
      compileRequestedRevision = null;
      lastCompileError = null;
      $("notice").hidden = true;
      const name = projectDescriptor.name;
      $("project-name").textContent = name;
      $("file-title").textContent = sourceName;
      $("source-file").textContent = sourceName;
      $("download-link").href = projectUrl("/api/pdf?download=1");
      document.title = `${name} · LaTeX Studio`;
      document.dispatchEvent(new CustomEvent("latex-project-loaded", { detail: { ...projectDescriptor, source: editor.value } }));
      updateLineNumbers();
      updateCursor();
      updateSaveStatus();
      if (project.hasPdf) showPdf(project.pdfVersion, { initial: true });
      if (typeof project.status === "object") handleState(project.status);
      else if (typeof project.state === "object") handleState(project.state);
      else currentState = { status: project.status || "idle", sourceRevision: revision };
      updateBuildStatus();
      connectEvents();
      api("/api/state").then(handleState).catch(() => {});
      const requestedInitialCompile = new URLSearchParams(window.location.search).get("compile") === "1";
      if (requestedInitialCompile) {
        const currentUrl = new URL(window.location.href);
        currentUrl.searchParams.delete("compile");
        window.history.replaceState(null, "", currentUrl);
      }
      if (!project.hasPdf && (autoCompile.checked || requestedInitialCompile)) requestCompile({ manual: requestedInitialCompile });
    } catch (error) {
      showNotice(`The document could not be loaded. ${error.message}`, { persistent: true, reload: true });
      $("reload-button").textContent = "Try again";
      buildLabel.textContent = "Unable to load";
      $("preview-empty-title").textContent = "Waiting for your document";
      $("preview-empty-message").textContent = "Reload the document to try connecting again.";
      $("empty-compile").hidden = true;
      updateSaveStatus();
    }
  }

  function updateFindCount() {
    findTerm = $("find-input").value;
    if (!findTerm) { $("find-count").textContent = ""; return; }
    const haystack = editor.value.toLocaleLowerCase();
    const needle = findTerm.toLocaleLowerCase();
    let count = 0;
    let offset = 0;
    while ((offset = haystack.indexOf(needle, offset)) >= 0) { count++; offset += needle.length; }
    $("find-count").textContent = count === 0 ? "No results" : `${count} match${count === 1 ? "" : "es"}`;
  }

  function findNext() {
    updateFindCount();
    if (!findTerm) return;
    const haystack = editor.value.toLocaleLowerCase();
    const needle = findTerm.toLocaleLowerCase();
    let found = haystack.indexOf(needle, editor.selectionEnd);
    if (found < 0) found = haystack.indexOf(needle);
    if (found < 0) return;
    editor.focus();
    editor.setSelectionRange(found, found + findTerm.length);
    const line = editor.value.slice(0, found).split("\n").length;
    const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 23;
    editor.scrollTop = Math.max(0, (line - 1) * lineHeight - editor.clientHeight / 3);
    syncGutter();
    updateCursor();
  }

  function openFind() {
    $("find-bar").hidden = false;
    if (editor.selectionEnd > editor.selectionStart) {
      const selected = editor.value.slice(editor.selectionStart, editor.selectionEnd);
      if (!selected.includes("\n")) $("find-input").value = selected;
    }
    updateFindCount();
    $("find-input").focus();
    $("find-input").select();
  }

  function closeFind() {
    $("find-bar").hidden = true;
    editor.focus();
  }

  function indentSelection(outdent) {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    if (!outdent && !editor.value.slice(start, end).includes("\n")) {
      editor.setRangeText("  ", start, end, "end");
    } else {
      const blockStart = editor.value.lastIndexOf("\n", start - 1) + 1;
      const lastLineEnd = editor.value.indexOf("\n", end);
      const blockEnd = lastLineEnd < 0 ? editor.value.length : lastLineEnd;
      const lines = editor.value.slice(blockStart, blockEnd).split("\n");
      let firstDelta = 0;
      let totalDelta = 0;
      const replacement = lines.map((line, index) => {
        const match = outdent ? line.match(/^(?: {1,2}|\t)/) : null;
        const delta = outdent ? -(match ? match[0].length : 0) : 2;
        if (index === 0) firstDelta = delta;
        totalDelta += delta;
        return outdent ? line.slice(-delta) : `  ${line}`;
      }).join("\n");
      editor.setRangeText(replacement, blockStart, blockEnd, "preserve");
      editor.setSelectionRange(Math.max(blockStart, start + firstDelta), Math.max(blockStart, end + totalDelta));
    }
    onSourceChange();
  }

  function activateTab(tab) {
    const preview = tab === "preview";
    $("workspace").classList.toggle("preview-active", preview);
    $("source-tab").classList.toggle("active", !preview);
    $("preview-tab").classList.toggle("active", preview);
    $("source-tab").setAttribute("aria-selected", String(!preview));
    $("preview-tab").setAttribute("aria-selected", String(preview));
  }

  function setSplit(percent) {
    const bounded = Math.max(25, Math.min(75, percent));
    document.documentElement.style.setProperty("--source-width", `${bounded}%`);
    $("panel-resizer").setAttribute("aria-valuenow", String(Math.round(bounded)));
  }

  editor.addEventListener("input", onSourceChange);
  editor.addEventListener("scroll", syncGutter);
  ["keyup", "click", "select"].forEach((type) => editor.addEventListener(type, updateCursor));
  editor.addEventListener("keydown", (event) => {
    if (event.key === "Tab") { event.preventDefault(); indentSelection(event.shiftKey); }
    if (event.key === "Escape" && !$("find-bar").hidden) closeFind();
  });
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); requestCompile({ manual: true }); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); saveSource(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f" && (document.activeElement === editor || $("source-panel").contains(document.activeElement))) { event.preventDefault(); openFind(); }
  });
  compileButton.addEventListener("click", () => requestCompile({ manual: true }));
  $("empty-compile").addEventListener("click", () => requestCompile({ manual: true }));
  saveButton.addEventListener("click", saveSource);
  autoCompile.addEventListener("change", () => {
    try { localStorage.setItem("latex-studio-auto-compile", String(autoCompile.checked)); } catch { /* Preferences are optional. */ }
    clearTimeout(compileTimer);
    if (autoCompile.checked && (!hasPreview || !sourceIsCurrent(currentState))) scheduleCompile();
    updateBuildStatus();
  });
  $("notice-dismiss").addEventListener("click", hideNotice);
  $("reload-button").addEventListener("click", () => {
    if (isDirty() && !window.confirm("Reload from disk and discard the edits currently in this editor? Copy any edits you want to keep first.")) return;
    clearTimeout(saveTimer);
    clearTimeout(compileTimer);
    $("reload-button").textContent = "Reload document";
    $("empty-compile").hidden = false;
    loadProject();
  });
  $("download-link").addEventListener("click", (event) => { if (!hasPreview) event.preventDefault(); });
  $("log-toggle").addEventListener("click", () => setLogOpen($("log-toggle").getAttribute("aria-expanded") !== "true"));
  $("find-button").addEventListener("click", openFind);
  $("find-close").addEventListener("click", closeFind);
  $("find-next").addEventListener("click", findNext);
  $("find-input").addEventListener("input", updateFindCount);
  $("find-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); findNext(); }
    if (event.key === "Escape") { event.preventDefault(); closeFind(); }
  });
  $("wrap-button").addEventListener("click", () => {
    const wrap = $("wrap-button").getAttribute("aria-pressed") !== "true";
    $("wrap-button").setAttribute("aria-pressed", String(wrap));
    $("wrap-button").setAttribute("aria-label", `${wrap ? "Disable" : "Enable"} line wrapping`);
    $("editor-container").classList.toggle("wrap-enabled", wrap);
    editor.wrap = wrap ? "soft" : "off";
    editor.dataset.wrap = String(wrap);
    document.dispatchEvent(new CustomEvent("latex-editor-wrap"));
  });
  $("source-tab").addEventListener("click", () => activateTab("source"));
  $("preview-tab").addEventListener("click", () => activateTab("preview"));
  $("panel-resizer").addEventListener("pointerdown", (event) => {
    resizePointerId = event.pointerId;
    $("panel-resizer").setPointerCapture(event.pointerId);
    document.body.classList.add("resize-active");
  });
  $("panel-resizer").addEventListener("pointermove", (event) => {
    if (resizePointerId !== event.pointerId) return;
    const bounds = $("workspace").getBoundingClientRect();
    setSplit((event.clientX - bounds.left) / bounds.width * 100);
  });
  const stopResizing = () => { resizePointerId = null; document.body.classList.remove("resize-active"); };
  $("panel-resizer").addEventListener("pointerup", stopResizing);
  $("panel-resizer").addEventListener("pointercancel", stopResizing);
  $("panel-resizer").addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      setSplit(Number($("panel-resizer").getAttribute("aria-valuenow")) + (event.key === "ArrowLeft" ? -3 : 3));
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (isDirty()) { event.preventDefault(); event.returnValue = ""; }
  });
  window.addEventListener("pagehide", () => { if (eventStream) eventStream.close(); });
  setInterval(() => { if (currentState.status === "compiling") updateBuildStatus(); }, 1000);
  try {
    const savedPreference = localStorage.getItem("latex-studio-auto-compile");
    if (savedPreference != null) autoCompile.checked = savedPreference !== "false";
  } catch { /* Start with automatic compilation if storage is unavailable. */ }
  async function prepareProjectSwitch() {
    if (switchingProject) return false;
    switchingProject = true;
    clearTimeout(saveTimer);
    clearTimeout(compileTimer);
    updateSaveStatus();
    if (!loaded) return true;
    const saved = await saveSource();
    if (!saved) {
      switchingProject = false;
      updateSaveStatus();
      return false;
    }
    if (eventStream) eventStream.close();
    return true;
  }
  function cancelProjectSwitch() {
    switchingProject = false;
    updateSaveStatus();
    connectEvents();
    if (isDirty()) scheduleCompile();
  }
  window.latexStudio = Object.freeze({ jumpToLine, isDirty, save: saveSource, prepareProjectSwitch, cancelProjectSwitch, getProject: () => projectDescriptor, getSourceName: () => sourceName });
  loadProject();
})();
