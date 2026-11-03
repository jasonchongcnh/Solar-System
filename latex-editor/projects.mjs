import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createEditorServer } from './server.mjs';

export const PROJECT_FILE_TYPES = new Map([
  ['.tex', ['tex', 'text/plain; charset=utf-8']], ['.sty', ['tex', 'text/plain; charset=utf-8']],
  ['.cls', ['tex', 'text/plain; charset=utf-8']], ['.tikz', ['tex', 'text/plain; charset=utf-8']],
  ['.bib', ['text', 'text/plain; charset=utf-8']], ['.bst', ['text', 'text/plain; charset=utf-8']],
  ['.csv', ['text', 'text/plain; charset=utf-8']], ['.eps', ['text', 'text/plain; charset=utf-8']],
  ['.txt', ['text', 'text/plain; charset=utf-8']], ['.dat', ['text', 'text/plain; charset=utf-8']],
  ['.png', ['image', 'image/png']], ['.jpg', ['image', 'image/jpeg']], ['.jpeg', ['image', 'image/jpeg']],
  ['.webp', ['image', 'image/webp']], ['.svg', ['image', 'image/svg+xml']], ['.pdf', ['pdf', 'application/pdf']],
  ['.ttf', ['font', 'font/ttf']], ['.otf', ['font', 'font/otf']], ['.woff', ['font', 'font/woff']],
  ['.woff2', ['font', 'font/woff2']], ['.fd', ['tex', 'text/plain; charset=utf-8']],
  ['.def', ['tex', 'text/plain; charset=utf-8']], ['.cfg', ['tex', 'text/plain; charset=utf-8']],
]);
const EXCLUDED = new Set(['.git', '.tools', '.artifacts', 'build', 'jobs', 'node_modules', 'cache']);
const HASH = value => createHash('sha256').update(value).digest('hex');
const failure = (status, message) => Object.assign(new Error(message), { status });
const TEMPLATE = '\\documentclass{article}\n\\usepackage[margin=1in]{geometry}\n\\usepackage{graphicx}\n\\title{New Document}\n\\author{}\n\\date{}\n\\begin{document}\n\\maketitle\n\\section{Introduction}\nStart writing here.\n\\end{document}\n';
export function safeRelativeName(value) {
  if (typeof value !== 'string' || !value || value.length > 1024 || /[\\:<>"|?*\u0000-\u001f\u007f]/.test(value) || path.isAbsolute(value)) throw failure(400, 'Choose a relative project file path.');
  const parts = value.split('/');
  if (parts.some(part => !part || part.startsWith('.') || part.length > 255 || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) || EXCLUDED.has(part.toLowerCase()))) throw failure(400, 'This project file path is not allowed.');
  return parts.join('/');
}

export async function safeProjectPath(projectDir, name) {
  const relative = safeRelativeName(name);
  let current = projectDir;
  const parts = relative.split('/');
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink() || (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) throw failure(404, 'Project file not found.');
  }
  const realRoot = await fs.realpath(projectDir);
  const realFile = await fs.realpath(current);
  const delta = path.relative(realRoot, realFile);
  if (!delta || delta === '..' || delta.startsWith('..' + path.sep) || path.isAbsolute(delta)) throw failure(404, 'Project file not found.');
  return current;
}

export async function readProjectFile(projectDir, name, limit = Infinity) {
  const filename = await safeProjectPath(projectDir, name);
  let handle;
  try {
    handle = await fs.open(filename, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
    const opened = await handle.stat();
    const after = await fs.lstat(await safeProjectPath(projectDir, name));
    if (!opened.isFile() || after.isSymbolicLink() || opened.ino !== after.ino || opened.dev !== after.dev) throw failure(404, 'Project file changed. Refresh the project.');
    if (opened.size > limit) throw failure(413, 'This project file exceeds the size limit.');
    const bytes = await handle.readFile();
    if (bytes.length > limit) throw failure(413, 'This project file exceeds the size limit.');
    return bytes;
  } finally { await handle?.close(); }
}

export async function listProjectFiles(projectDir, { recursive = true, excludeDir } = {}) {
  const files = [];
  const visit = async (directory, prefix = '') => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const name = prefix + entry.name;
      try { safeRelativeName(name); } catch { continue; }
      const filename = path.join(directory, entry.name);
      if (excludeDir && path.resolve(filename) === path.resolve(excludeDir)) continue;
      try {
        const stat = await fs.lstat(filename);
        if (stat.isSymbolicLink()) continue;
        if (stat.isDirectory() && recursive) await visit(filename, name + '/');
        else if (stat.isFile()) {
          const description = PROJECT_FILE_TYPES.get(path.extname(name).toLowerCase());
          if (description) files.push({ name, size: stat.size, type: description[0] });
        }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  };
  await visit(projectDir);
  return files.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }));
}

export async function inspectProject(directory, mainFile) {
  if (typeof directory !== 'string' || !directory.trim() || !path.isAbsolute(directory)) throw failure(400, 'Enter an absolute project folder path.');
  const projectDir = path.resolve(directory);
  let stat;
  try { stat = await fs.stat(projectDir); }
  catch (error) { if (['ENOENT', 'ENOTDIR'].includes(error.code)) throw failure(404, 'Project folder not found.'); throw error; }
  if (!stat.isDirectory()) throw failure(400, 'Choose a project folder.');
  if (projectDir === path.parse(projectDir).root) throw failure(400, 'Choose a document folder, rather than the drive root.');
  const files = (await listProjectFiles(projectDir)).filter(file => path.extname(file.name).toLowerCase() === '.tex').map(file => file.name);
  if (mainFile) {
    safeRelativeName(mainFile);
    if (!files.includes(mainFile)) throw failure(404, 'The selected main .tex file was not found in this folder.');
  }
  let suggestedMain = mainFile || ['main-en.tex', 'main.tex'].find(name => files.includes(name));
  if (!suggestedMain) {
    for (const name of files) {
      if (/\\documentclass(?:\[[^\]]*\])?\s*\{/.test((await readProjectFile(projectDir, name, 1024 * 1024)).toString('utf8'))) { suggestedMain = name; break; }
    }
  }
  return { projectDir, files, suggestedMain: suggestedMain || files[0] || null };
}

async function readBody(req, limit = 1024 * 1024) {
  if ((req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') throw failure(415, 'Use application/json for this request.');
  if (Number(req.headers['content-length']) > limit) throw failure(413, 'The project request is too large.');
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw failure(413, 'The project request is too large.'); chunks.push(chunk); }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw failure(400, 'Request must contain valid JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure(400, 'Request must be a JSON object.');
  return value;
}

/** One loopback server, with an isolated compiler queue and last-good PDF per document. */
export async function createProjectManager(options = {}) {
  const workDir = path.resolve(options.workDir || process.env.LATEX_WORK_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.artifacts', 'latex-editor'));
  const projectRoot = path.join(workDir, 'projects');
  const documentsDir = path.join(projectRoot, 'documents');
  const registryPath = path.join(projectRoot, 'registry.json');
  await fs.mkdir(projectRoot, { recursive: true });
  let stored = {};
  try { stored = JSON.parse(await fs.readFile(registryPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
  if (!stored || typeof stored !== 'object' || Array.isArray(stored) || !Array.isArray(stored.projects)) stored = {};
  const suppliedFolder = options.projectDir || process.env.LATEX_PROJECT_DIR;
  let original;
  if (suppliedFolder) original = await inspectProject(path.resolve(suppliedFolder), options.sourceName || process.env.LATEX_SOURCE_NAME);
  else {
    const candidates = (stored.projects || []).filter(descriptor => descriptor && typeof descriptor === 'object').sort((a, b) => Number(b.id === stored.defaultProjectId) - Number(a.id === stored.defaultProjectId));
    for (const descriptor of candidates) {
      try { original = await inspectProject(descriptor.projectDir, descriptor.mainFile); if (original.suggestedMain) break; }
      catch { /* A moved or unavailable remembered folder must not prevent a fresh editor session. */ }
    }
    if (!original?.suggestedMain) {
      await fs.mkdir(documentsDir, { recursive: true });
      const directory = path.join(documentsDir, `New-Document-${randomBytes(5).toString('hex')}`);
      await fs.mkdir(directory); await fs.writeFile(path.join(directory, 'main.tex'), TEMPLATE, { flag: 'wx' });
      original = await inspectProject(directory, 'main.tex');
    }
  }
  if (!original.suggestedMain) throw failure(400, 'This folder does not contain a .tex document.');
  const makeId = (directory, mainFile) => HASH(path.resolve(directory).toLowerCase() + '\n' + mainFile.toLowerCase()).slice(0, 20);
  const defaultId = makeId(original.projectDir, original.suggestedMain);
  const initial = { id: defaultId, name: path.basename(original.projectDir), projectDir: original.projectDir, mainFile: original.suggestedMain };
  const descriptors = new Map([[defaultId, initial]]);
  const instances = new Map();
  let activeProjectId = defaultId;
  {
    for (const descriptor of stored.projects || []) {
      if (!descriptor || typeof descriptor !== 'object') continue;
      if (typeof descriptor.projectDir !== 'string' || !path.isAbsolute(descriptor.projectDir) || typeof descriptor.mainFile !== 'string' || descriptor.id !== makeId(descriptor.projectDir, descriptor.mainFile)) continue;
      try { safeRelativeName(descriptor.mainFile); } catch { continue; }
      descriptors.set(descriptor.id, { id: descriptor.id, name: String(descriptor.name || path.basename(descriptor.projectDir)).slice(0, 120), projectDir: path.resolve(descriptor.projectDir), mainFile: descriptor.mainFile });
    }
    if (descriptors.has(stored.activeProjectId)) activeProjectId = stored.activeProjectId;
  }
  const legacyProjectId = descriptors.has(stored.defaultProjectId) ? stored.defaultProjectId : defaultId;
  if (suppliedFolder && (!(stored.projects || []).some(project => project?.id === defaultId) || options.sourceName || process.env.LATEX_SOURCE_NAME)) activeProjectId = defaultId;
  let mutation = Promise.resolve();
  const serial = action => { const next = mutation.then(action, action); mutation = next.catch(() => {}); return next; };
  const persist = async () => {
    const temporary = path.join(projectRoot, `registry-${randomBytes(8).toString('hex')}.tmp`);
    try { await fs.writeFile(temporary, JSON.stringify({ version: 1, defaultProjectId: legacyProjectId, activeProjectId, projects: [...descriptors.values()] }, null, 2)); await fs.rename(temporary, registryPath); }
    finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
  };
  let server;
  const instanceFor = async id => {
    const descriptor = descriptors.get(id);
    if (!descriptor) throw failure(404, 'Project not found.');
    if (!instances.has(id)) {
      const promise = createEditorServer({ ...options, projectDir: descriptor.projectDir, sourceName: descriptor.mainFile,
        name: descriptor.name, projectId: id, recursiveFiles: true, assetDir: descriptor.projectDir,
        workDir: id === legacyProjectId ? workDir : path.join(projectRoot, id), getServerAddress: () => server?.address() });
      instances.set(id, promise);
      try { await promise; } catch (error) { instances.delete(id); throw error; }
    }
    return instances.get(id);
  };
  // Preserve the original project's published PDF without compiling or rewriting its source.
  await instanceFor(defaultId);
  if (activeProjectId !== defaultId) {
    try { await instanceFor(activeProjectId); } catch { activeProjectId = defaultId; }
  }
  await persist();
  const open = async (directory, mainFile, name) => {
    const inspected = await inspectProject(directory, mainFile);
    if (!inspected.suggestedMain) throw failure(400, 'This folder does not contain a .tex document.');
    const id = makeId(inspected.projectDir, inspected.suggestedMain);
    const descriptor = { id, name: name || descriptors.get(id)?.name || path.basename(inspected.projectDir), projectDir: inspected.projectDir, mainFile: inspected.suggestedMain };
    const previous = descriptors.get(id);
    descriptors.set(id, descriptor);
    try { await instanceFor(id); }
    catch (error) { if (previous) descriptors.set(id, previous); else descriptors.delete(id); throw error; }
    activeProjectId = id;
    await persist();
    return descriptor;
  };
  const nameFolder = name => {
    if (typeof name !== 'string' || !name.trim() || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)) throw failure(400, 'Give the project a name of 1 to 120 characters.');
    return name.trim().replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 70) || 'document';
  };
  const newFolder = async name => {
    const stem = nameFolder(name);
    await fs.mkdir(documentsDir, { recursive: true });
    const directory = path.join(documentsDir, `${stem}-${randomBytes(5).toString('hex')}`);
    await fs.mkdir(directory);
    return directory;
  };
  const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
  const checkLocal = req => {
    const port = server.address()?.port;
    const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    if (!allowed.has((req.headers.host || '').toLowerCase()) || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) throw failure(403, 'Access this editor through its localhost address.');
    if ((req.headers.origin && !allowed.has(String(req.headers.origin).replace(/^http:\/\//, '').toLowerCase())) || req.headers['sec-fetch-site'] === 'cross-site') throw failure(403, 'Requests from another website are not allowed.');
  };
  server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store');
    try {
      checkLocal(req);
      const url = new URL(req.url, 'http://localhost');
      if (/%2f|%5c|%2e|\\|(?:^|\/)\.\.(?:\/|$)/i.test(req.url.split('?')[0])) throw failure(400, 'Invalid URL path.');
      if (req.method === 'GET' && url.pathname === '/api/health') {
        json(res, 200, { app: 'latex-studio', projectDir: descriptors.get(activeProjectId).projectDir, port: server.address()?.port, multiProject: true, version: 2 });
      } else if (req.method === 'GET' && url.pathname === '/api/projects') {
        json(res, 200, { projects: [...descriptors.values()], activeProjectId });
      } else if (req.method === 'GET' && url.pathname === '/api/projects/inspect') {
        json(res, 200, await inspectProject(url.searchParams.get('projectDir')));
      } else if (req.method === 'POST' && url.pathname === '/api/projects/open') {
        const body = await readBody(req);
        json(res, 200, { project: await serial(() => open(body.projectDir, body.mainFile)) });
      } else if (req.method === 'POST' && url.pathname === '/api/projects/activate') {
        const body = await readBody(req);
        json(res, 200, { project: await serial(async () => {
          if (!descriptors.has(body.id)) throw failure(404, 'Project not found.');
          await instanceFor(body.id); activeProjectId = body.id; await persist(); return descriptors.get(body.id);
        }) });
      } else if (req.method === 'POST' && url.pathname === '/api/projects/new') {
        const body = await readBody(req);
        json(res, 201, { project: await serial(async () => {
          const directory = await newFolder(body.name);
          await fs.writeFile(path.join(directory, 'main.tex'), TEMPLATE, { flag: 'wx' });
          return open(directory, 'main.tex', body.name.trim());
        }) });
      } else if (req.method === 'POST' && url.pathname === '/api/projects/import') {
        const body = await readBody(req, 64 * 1024 * 1024);
        nameFolder(body.name);
        if (!Array.isArray(body.files) || !body.files.length || body.files.length > 256) throw failure(400, 'Import between 1 and 256 project files.');
        let total = 0; const seen = new Set();
        const files = body.files.map(file => {
          const name = safeRelativeName(file?.name);
          if (!PROJECT_FILE_TYPES.has(path.extname(name).toLowerCase())) throw failure(400, `Unsupported project file: ${name}`);
          if (seen.has(name.toLowerCase())) throw failure(400, 'Project contains duplicate file paths.'); seen.add(name.toLowerCase());
          if (typeof file.content !== 'string' || file.content.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.content)) throw failure(400, 'Imported files must contain base64 data.');
          const bytes = Buffer.from(file.content, 'base64');
          if (bytes.toString('base64') !== file.content) throw failure(400, 'Imported files must contain valid base64 data.');
          total += bytes.length;
          if (total > 48 * 1024 * 1024) throw failure(413, 'Imported files exceed the 48 MB content limit.');
          if (path.extname(name).toLowerCase() === '.tex' && (bytes.length > 1024 * 1024 || bytes.includes(0))) throw failure(400, 'LaTeX source must be text under 1 MB.');
          return { name, bytes };
        });
        for (const file of files) {
          const parts = file.name.toLowerCase().split('/');
          for (let depth = 1; depth < parts.length; depth++) if (seen.has(parts.slice(0, depth).join('/'))) throw failure(400, 'A file path cannot also be a project folder.');
        }
        if (!files.some(file => path.extname(file.name).toLowerCase() === '.tex')) throw failure(400, 'Import a project containing a .tex file.');
        if (body.mainFile && !files.some(file => file.name === body.mainFile && path.extname(file.name).toLowerCase() === '.tex')) throw failure(400, 'Choose a main .tex file from the imported files.');
        json(res, 201, { project: await serial(async () => {
          const directory = await newFolder(body.name);
          try {
            for (const file of files) {
              const destination = path.join(directory, ...file.name.split('/'));
              await fs.mkdir(path.dirname(destination), { recursive: true });
              await fs.writeFile(destination, file.bytes, { flag: 'wx' });
            }
            return await open(directory, body.mainFile, body.name.trim());
          } catch (error) {
            const delta = path.relative(documentsDir, directory);
            if (delta && !delta.startsWith('..') && !path.isAbsolute(delta)) await fs.rm(directory, { recursive: true, force: true });
            throw error;
          }
        }) });
      } else {
        const id = url.pathname.startsWith('/api/') ? (url.searchParams.has('project') ? url.searchParams.get('project') : activeProjectId) : defaultId;
        const instance = await instanceFor(id);
        instance.server.emit('request', req, res);
      }
    } catch (error) {
      if (res.headersSent || res.destroyed) { res.destroy(); return; }
      let status = error.status || (['ENOENT', 'ENOTDIR'].includes(error.code) ? 404 : ['EACCES', 'EPERM'].includes(error.code) ? 403 : 500);
      json(res, status, { error: status === 500 ? 'The project request could not be completed. Check the server console.' : error.message });
      if (status === 500) console.error(error);
    }
  });
  server.requestTimeout = 30_000; server.headersTimeout = 10_000;
  const nativeListen = server.listen.bind(server);
  server.listen = (...args) => {
    const host = typeof args[0] === 'object' && args[0] ? args[0].host : typeof args[1] === 'string' ? args[1] : null;
    if (host && !['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('The editor must bind to a loopback address.');
    if (typeof args[0] === 'object' && args[0]) args[0] = { ...args[0], host: host || '127.0.0.1' }; else if (!host) args.splice(1, 0, '127.0.0.1');
    return nativeListen(...args);
  };
  const close = async () => {
    await mutation;
    await Promise.all([...instances.values()].map(async promise => (await promise).close()));
    if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  };
  return { server, close, workDir, sourcePath: path.join(initial.projectDir, ...initial.mainFile.split('/')), projectDir: initial.projectDir,
    getProjects: () => ({ projects: [...descriptors.values()], activeProjectId }) };
}
