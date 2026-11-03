import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { PROJECT_FILE_TYPES, createProjectManager, inspectProject, listProjectFiles, readProjectFile, safeProjectPath } from './projects.mjs';

const BODY_LIMIT = 1024 * 1024;
const LOG_LIMIT = 512 * 1024;
const ASSET_LIMIT = 32 * 1024 * 1024;
const STATIC_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/editor.js', ['editor.js', 'text/javascript; charset=utf-8']],
  ['/editor-extras.js', ['editor-extras.js', 'text/javascript; charset=utf-8']],
  ['/editor-projects.js', ['editor-projects.js', 'text/javascript; charset=utf-8']],
  ['/editor.css', ['editor.css', 'text/css; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
  ['/pdf-viewer.html', ['pdf-viewer.html', 'text/html; charset=utf-8']],
  ['/pdf-viewer.js', ['pdf-viewer.js', 'text/javascript; charset=utf-8']],
  ['/pdf-viewer.css', ['pdf-viewer.css', 'text/css; charset=utf-8']],
]);
const HASH = (value) => createHash('sha256').update(value).digest('hex');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PDFJS_ROOT = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));

function pdfJsAsset(urlPath) {
  if (urlPath === '/vendor/pdfjs/pdf.mjs') return ['build/pdf.mjs', 'text/javascript; charset=utf-8'];
  if (urlPath === '/vendor/pdfjs/pdf.worker.mjs') return ['build/pdf.worker.mjs', 'text/javascript; charset=utf-8'];
  const match = /^\/vendor\/pdfjs\/(cmaps|standard_fonts|wasm)\/([\w.-]+\.(bcmap|ttf|pfb|wasm|mjs))$/.exec(urlPath);
  if (!match) return null;
  const mime = match[3] === 'wasm' ? 'application/wasm' : match[3] === 'mjs' ? 'text/javascript; charset=utf-8' : 'application/octet-stream';
  return [`${match[1]}/${match[2]}`, mime];
}

class HttpError extends Error {
  constructor(status, message, detail = {}) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

function boundedLog(value) {
  const bytes = Buffer.from(String(value || ''), 'utf8');
  if (bytes.length <= LOG_LIMIT) return bytes.toString('utf8');
  return '[Earlier compiler output omitted]\n' + bytes.subarray(-LOG_LIMIT + 40).toString('utf8');
}

function isInside(parent, target) {
  const relative = path.relative(parent, target);
  return relative !== '' && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
}

async function readJson(req) {
  if ((req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new HttpError(415, 'Use application/json for this request.');
  }
  const length = Number(req.headers['content-length']);
  if (Number.isFinite(length) && length > BODY_LIMIT) throw new HttpError(413, 'Request exceeds the 1 MB limit.');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw new HttpError(413, 'Request exceeds the 1 MB limit.');
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'Request must contain valid JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Request must be a JSON object.');
  return value;
}

function requireRevision(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new HttpError(400, 'A valid source revision is required.');
  }
}

/** Directly invokes Tectonic without a shell, with its untrusted input restrictions. */
export function createCompiler(options = {}) {
  const compilerPath = options.compilerPath || process.env.LATEX_COMPILER_PATH;
  if (!compilerPath) throw new Error('LATEX_COMPILER_PATH must point to tectonic.exe.');
  const cacheDir = options.cacheDir || process.env.LATEX_CACHE_DIR;
  const fontConfigPath = options.fontConfigPath || options.fontconfigFile || process.env.FONTCONFIG_FILE;
  return async ({ jobDir, sourcePath, outDir, signal, onLog }) => {
    const env = { ...process.env };
    if (cacheDir) {
      env.TECTONIC_CACHE_DIR = cacheDir;
      env.XDG_CACHE_HOME = cacheDir;
    }
    if (fontConfigPath) env.FONTCONFIG_FILE = fontConfigPath;
    const onlyCached = options.onlyCached === true || process.env.LATEX_OFFLINE === '1';
    const outputStem = path.parse(sourcePath).name;
    const args = ['--untrusted', ...(onlyCached ? ['--only-cached'] : []), '--keep-logs', '--outdir', outDir, '--chatter', 'minimal', path.relative(jobDir, sourcePath)];
    let log = '';
    await new Promise((resolve, reject) => {
      let child;
      try { child = spawn(compilerPath, args, { cwd: jobDir, env, windowsHide: true, shell: false }); }
      catch (error) { reject(error); return; }
      const append = (chunk) => {
        log = boundedLog(log + chunk.toString('utf8'));
        onLog?.(chunk.toString('utf8'));
      };
      child.stdout.on('data', append);
      child.stderr.on('data', append);
      const abort = () => child.kill('SIGKILL');
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      child.on('error', (error) => {
        signal?.removeEventListener('abort', abort);
        error.log = log;
        reject(error);
      });
      child.on('close', (code) => {
        signal?.removeEventListener('abort', abort);
        if (signal?.aborted) {
          const error = new Error('Compilation was interrupted.');
          error.log = log;
          reject(error);
        } else if (code !== 0) {
          const error = new Error(`LaTeX compilation failed (exit code ${code}).`);
          error.log = log;
          reject(error);
        } else resolve();
      });
    });
    // Tectonic's .log contains useful diagnostics even when chatter is minimal.
    try {
      const texLog = await fs.readFile(path.join(outDir, `${outputStem}.log`), 'utf8');
      log = boundedLog(log + '\n' + texLog);
    } catch { /* Process output remains available when no .log was written. */ }
    return { pdfPath: path.join(outDir, `${outputStem}.pdf`), log };
  };
}

/**
 * Creates an unbound, loopback-only HTTP server. Tests can inject compile(job),
 * which receives immutable sourcePath/jobDir, signal, and onLog, and returns
 * {pdfPath, log?}. Call server.listen(port, '127.0.0.1') after awaiting this.
 */
export async function createEditorServer(options = {}) {
  const projectDir = path.resolve(options.projectDir || process.env.LATEX_PROJECT_DIR || process.cwd());
  const workDir = path.resolve(options.workDir || process.env.LATEX_WORK_DIR || path.join(HERE, '..', '.artifacts', 'latex-editor'));
  const assetDir = path.resolve(options.assetDir || process.env.LATEX_ASSET_DIR || projectDir);
  const inspected = await inspectProject(projectDir, options.sourceName || process.env.LATEX_SOURCE_NAME);
  const sourceName = inspected.suggestedMain;
  if (!sourceName) throw new Error('The project folder does not contain a .tex document.');
  const sourcePath = await safeProjectPath(projectDir, sourceName);
  const outputStem = path.parse(sourceName).name;
  const jobsDir = path.join(workDir, 'jobs');
  const publishedDir = path.join(workDir, 'published');
  const latestMetadataPath = path.join(publishedDir, 'latest.json');
  const publicDir = path.join(HERE, 'public');
  await fs.mkdir(jobsDir, { recursive: true });
  let sourceBytes = await readProjectFile(projectDir, sourceName, BODY_LIMIT);
  let revision = HASH(sourceBytes);
  let publishedPdf = null;
  let publishedJobDir = null;
  let pending = null;
  let runner = null;
  let activeAbort = null;
  let activeRevision = null;
  let closed = false;
  let operationChain = Promise.resolve();
  let sequence = 0;
  const clients = new Set();
  const ownedJobs = [];
  const publishedVersions = new Map();
  const compile = options.compile || ((job) => createCompiler(options)(job));
  const state = {
    status: 'idle', jobId: null, pdfVersion: null, hasPdf: false,
    log: '', error: null, sourceRevision: revision, buildRevision: null, compiledRevision: null,
    durationMs: null, queued: false, queuedRevision: null,
  };
  let savedPreview = null;
  try {
    const metadata = JSON.parse(await fs.readFile(latestMetadataPath, 'utf8'));
    if (metadata.projectDir === projectDir && (metadata.sourceName === sourceName || (!metadata.sourceName && sourceName === 'main-en.tex')) && /^[a-f0-9]{64}$/.test(metadata.revision) && /^latest-\d+-\d+\.pdf$/.test(metadata.filename)) {
      savedPreview = metadata;
    }
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  const initialPaths = [
    ...(savedPreview ? [path.join(publishedDir, savedPreview.filename)] : []),
    path.join(projectDir, 'build', `${outputStem}.pdf`), path.join(projectDir, `${outputStem}.pdf`),
    path.join(assetDir, 'build', `${outputStem}.pdf`),
  ];
  for (const initialPath of initialPaths) {
    try {
      const stat = await fs.stat(initialPath);
      if (stat.isFile() && stat.size > 4) {
        await fs.mkdir(publishedDir, { recursive: true });
        publishedPdf = path.join(publishedDir, 'initial-preview.pdf');
        await fs.copyFile(initialPath, publishedPdf);
        state.hasPdf = true;
        state.pdfVersion = `initial-${Math.trunc(stat.mtimeMs)}`;
        publishedVersions.set(state.pdfVersion, publishedPdf);
        if (savedPreview && initialPath === path.join(publishedDir, savedPreview.filename)) state.compiledRevision = savedPreview.revision;
        state.status = 'ready';
        break;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const snapshotState = () => ({ ...state });
  const broadcast = () => {
    if (closed) return;
    const body = `event: state\ndata: ${JSON.stringify(snapshotState())}\n\n`;
    for (const client of clients) {
      if (client.destroyed || client.writableLength > 2 * LOG_LIMIT) {
        client.destroy();
        clients.delete(client);
      } else client.write(body);
    }
  };
  let broadcastTimer = null;
  const scheduleBroadcast = () => {
    if (broadcastTimer) return;
    broadcastTimer = setTimeout(() => { broadcastTimer = null; broadcast(); }, 100);
    broadcastTimer.unref();
  };
  const serialized = (action) => {
    const current = operationChain.then(action, action);
    operationChain = current.catch(() => {});
    return current;
  };
  const refreshSource = async () => {
    sourceBytes = await readProjectFile(projectDir, sourceName, BODY_LIMIT);
    const nextRevision = HASH(sourceBytes);
    if (revision !== nextRevision) {
      revision = nextRevision;
      state.sourceRevision = revision;
      broadcast();
    }
    return { source: sourceBytes.toString('utf8'), bytes: Buffer.from(sourceBytes), revision };
  };
  const checkRevision = async (expected) => {
    const current = await refreshSource();
    if (expected !== current.revision) {
      throw new HttpError(409, 'The source has changed on disk. Reload it before saving or compiling to avoid overwriting those changes.', { revision: current.revision });
    }
    return current;
  };
  const projectManifest = async () => {
    const files = await listProjectFiles(projectDir, { recursive: options.recursiveFiles === true, excludeDir: workDir });
    // Direct API consumers retain the original top-level manifest contract.
    return options.recursiveFiles ? files : files.filter(file => ['.tex', '.sty', '.cls', '.tikz', '.bib', '.csv', '.eps', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.pdf'].includes(path.extname(file.name).toLowerCase()));
  };
  const serveAsset = async (req, res, url) => {
    const name = url.searchParams.get('name');
    if (!options.recursiveFiles && (!name || name.length > 255 || name.startsWith('.') || /[\\/:\u0000-\u001f\u007f]/.test(name) || path.basename(name) !== name)) {
      throw new HttpError(400, 'Choose a top-level project file.');
    }
    const entry = (await projectManifest()).find(file => file.name === name);
    if (!entry) throw new HttpError(404, 'Project file not found.');
    const [, mime] = PROJECT_FILE_TYPES.get(path.extname(name).toLowerCase());
    const limit = ['tex', 'text'].includes(entry.type) ? BODY_LIMIT : ASSET_LIMIT;
    if (entry.size > limit) throw new HttpError(413, `This preview exceeds the ${limit / 1024 / 1024} MB limit.`);
    try {
      const contents = await readProjectFile(projectDir, name, limit);
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
      res.writeHead(200, { 'Content-Type': mime, 'Content-Length': contents.length });
      res.end(req.method === 'HEAD' ? undefined : contents);
    } catch (error) {
      if (['ENOENT', 'ELOOP'].includes(error.code)) throw new HttpError(404, 'Project file not found.');
      throw error;
    }
  };
  const snapshotAssets = async (jobDir) => {
    for (const entry of await listProjectFiles(projectDir, { excludeDir: workDir })) {
      if (entry.name === sourceName || entry.name === `${outputStem}.pdf`) continue;
      const contents = await readProjectFile(projectDir, entry.name, 64 * 1024 * 1024);
      const destination = path.join(jobDir, ...entry.name.split('/'));
      await fs.mkdir(path.dirname(destination), { recursive: true });
      // Copy fresh bytes, rather than hard-linking mutable inputs or reusing a previous project mirror.
      await fs.writeFile(destination, contents, { flag: 'wx' });
    }
  };
  const cleanupJobs = async () => {
    const publishedJobs = new Set([...publishedVersions.values()].map((pdf) => path.dirname(pdf)));
    const eligible = ownedJobs.filter((dir) => dir !== publishedJobDir && !publishedJobs.has(dir));
    for (const dir of eligible.slice(0, Math.max(0, ownedJobs.length - 5))) {
      if (!isInside(jobsDir, dir)) continue;
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      const index = ownedJobs.indexOf(dir);
      if (index >= 0) ownedJobs.splice(index, 1);
    }
  };
  const processQueue = async () => {
    while (pending && !closed) {
      const job = pending;
      pending = null;
      activeRevision = job.revision;
      state.queued = false;
      state.queuedRevision = null;
      state.status = 'compiling';
      state.jobId = job.id;
      state.buildRevision = job.revision;
      state.log = '';
      state.error = null;
      state.durationMs = null;
      const started = Date.now();
      const jobDir = path.join(jobsDir, job.id);
      activeAbort = new AbortController();
      const controller = activeAbort;
      let timeout;
      let abortListener;
      broadcast();
      try {
        await fs.mkdir(jobDir);
        ownedJobs.push(jobDir);
        await snapshotAssets(jobDir);
        const snapshotSource = path.join(jobDir, ...sourceName.split('/'));
        await fs.mkdir(path.dirname(snapshotSource), { recursive: true });
        await fs.writeFile(snapshotSource, job.bytes);
        const interrupted = new Promise((_, reject) => {
          abortListener = () => reject(new Error(closed ? 'Editor closed during compilation.' : 'Compilation exceeded the 90 second time limit.'));
          controller.signal.addEventListener('abort', abortListener, { once: true });
          if (controller.signal.aborted) abortListener();
        });
        timeout = setTimeout(() => controller.abort(), options.compileTimeoutMs || 90_000);
        timeout.unref();
        const result = await Promise.race([
          compile({ jobDir, sourcePath: snapshotSource, outDir: jobDir, revision: job.revision,
            jobId: job.id, signal: controller.signal, onLog: (chunk) => {
              if (controller.signal.aborted) return;
              state.log = boundedLog(state.log + String(chunk));
              scheduleBroadcast();
            } }),
          interrupted,
        ]);
        if (result?.log) state.log = boundedLog(result.log);
        const candidate = path.resolve(result?.pdfPath || path.join(jobDir, `${outputStem}.pdf`));
        if (!isInside(jobDir, candidate)) throw new Error('Compiler returned a PDF outside its job directory.');
        const handle = await fs.open(candidate, 'r');
        try {
          const header = Buffer.alloc(5);
          await handle.read(header, 0, 5, 0);
          if (header.toString('ascii') !== '%PDF-') throw new Error('Compilation did not produce a valid PDF file.');
        } finally { await handle.close(); }
        const current = await serialized(refreshSource);
        if (current.revision === job.revision && !closed) {
          // Keep an immutable PDF plus an atomic pointer so reopening restores the last good build.
          await fs.mkdir(publishedDir, { recursive: true });
          const filename = `latest-${job.id}.pdf`;
          await fs.copyFile(candidate, path.join(publishedDir, filename));
          const metadataTemp = path.join(publishedDir, `latest-${job.id}.json.tmp`);
          try {
            await fs.writeFile(metadataTemp, JSON.stringify({ projectDir, sourceName, revision: job.revision, filename }));
            await fs.rename(metadataTemp, latestMetadataPath);
          } finally { await fs.rm(metadataTemp, { force: true }).catch(() => {}); }
          for (const entry of await fs.readdir(publishedDir)) {
            if (/^latest-\d+-\d+\.pdf$/.test(entry) && entry !== filename) await fs.rm(path.join(publishedDir, entry)).catch(() => {});
          }
          publishedPdf = candidate;
          publishedJobDir = jobDir;
          state.pdfVersion = job.id;
          publishedVersions.set(job.id, candidate);
          const completed = [...publishedVersions.keys()].filter((version) => !version.startsWith('initial-'));
          for (const expired of completed.slice(0, Math.max(0, completed.length - 5))) publishedVersions.delete(expired);
          state.hasPdf = true;
          state.compiledRevision = job.revision;
          state.status = 'ready';
        } else {
          state.status = state.hasPdf ? 'ready' : 'idle';
          state.log = boundedLog(state.log + '\nSource changed during this build; waiting for the current revision to compile.');
        }
      } catch (error) {
        state.status = 'error';
        state.error = error.message || 'Compilation failed.';
        if (error.log) state.log = boundedLog(error.log);
        state.log = boundedLog(state.log + '\n' + state.error);
      } finally {
        clearTimeout(timeout);
        if (abortListener) controller.signal.removeEventListener('abort', abortListener);
        activeAbort = null;
        activeRevision = null;
        state.durationMs = Date.now() - started;
        state.queued = Boolean(pending);
        state.queuedRevision = pending?.revision || null;
        broadcast();
        await cleanupJobs();
      }
    }
  };
  const startRunner = () => {
    if (runner || closed) return;
    runner = processQueue().catch((error) => {
      state.status = 'error';
      state.error = error.message;
      broadcast();
    }).finally(() => {
      runner = null;
      if (pending && !closed) startRunner();
    });
  };

  const securityHeaders = (res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' blob:; worker-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'");
    res.setHeader('Cache-Control', 'no-store');
  };
  const json = (res, status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(value));
  };
  const validateLocalRequest = (req) => {
    const address = options.getServerAddress?.() || server.address();
    const port = typeof address === 'object' ? address?.port : null;
    const host = (req.headers.host || '').toLowerCase();
    const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    if (!allowed.has(host)) throw new HttpError(403, 'Access this editor through its localhost address.');
    const remote = req.socket.remoteAddress;
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) throw new HttpError(403, 'This editor only accepts local connections.');
    const origin = req.headers.origin;
    if (origin && !allowed.has(String(origin).replace(/^http:\/\//, '').toLowerCase())) {
      throw new HttpError(403, 'Requests from another website are not allowed.');
    }
    if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Requests from another website are not allowed.');
  };
  const servePdf = async (req, res, url) => {
    if (!publishedPdf) throw new HttpError(404, 'No compiled PDF is available yet.');
    const requestedVersion = url.searchParams.get('version') || url.searchParams.get('v');
    const pdfPath = requestedVersion ? publishedVersions.get(requestedVersion) : publishedPdf;
    if (!pdfPath) throw new HttpError(404, 'This PDF version is no longer available. Refresh the preview.');
    const stat = await fs.stat(pdfPath);
    let start = 0;
    let end = stat.size - 1;
    let status = 200;
    if (req.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (!match || (!match[1] && !match[2])) {
        res.setHeader('Content-Range', `bytes */${stat.size}`);
        throw new HttpError(416, 'Requested PDF range is not available.');
      }
      if (!match[1]) {
        const suffix = Number(match[2]);
        start = Math.max(0, stat.size - suffix);
        if (suffix === 0) start = stat.size;
      } else {
        start = Number(match[1]);
        if (match[2]) end = Math.min(Number(match[2]), stat.size - 1);
      }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) {
        res.setHeader('Content-Range', `bytes */${stat.size}`);
        throw new HttpError(416, 'Requested PDF range is not available.');
      }
      status = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    }
    const rawPdf = url.searchParams.get('raw') === '1';
    res.setHeader('Content-Type', rawPdf ? 'application/octet-stream' : 'application/pdf');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', end - start + 1);
    if (!rawPdf) res.setHeader('Content-Disposition', `${url.searchParams.get('download') === '1' ? 'attachment' : 'inline'}; filename="${outputStem.replace(/[^a-zA-Z0-9_.-]/g, '_')}.pdf"; filename*=UTF-8''${encodeURIComponent(outputStem + '.pdf')}`);
    res.writeHead(status);
    if (req.method === 'HEAD') { res.end(); return; }
    const stream = createReadStream(pdfPath, { start, end });
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  };

  const server = http.createServer(async (req, res) => {
    securityHeaders(res);
    try {
      validateLocalRequest(req);
      const url = new URL(req.url, 'http://localhost');
      // Resolve only explicit static names, never a user-controlled filesystem path.
      if (/%2f|%5c|%2e|\\|(?:^|\/)\.\.(?:\/|$)/i.test(req.url.split('?')[0])) throw new HttpError(400, 'Invalid URL path.');
      if (req.method === 'GET' && url.pathname === '/api/health') {
        json(res, 200, { app: 'latex-studio', projectDir, port: server.address()?.port });
      } else if (req.method === 'GET' && url.pathname === '/api/project') {
        const current = await serialized(refreshSource);
        json(res, 200, { id: options.projectId || null, name: options.name || path.basename(projectDir), projectDir, sourceName, mainFile: sourceName, source: current.source, revision: current.revision,
          pdfVersion: state.pdfVersion, hasPdf: state.hasPdf, status: state.status });
      } else if (req.method === 'GET' && url.pathname === '/api/files') {
        json(res, 200, { files: await projectManifest() });
      } else if (['GET', 'HEAD'].includes(req.method) && url.pathname === '/api/asset') {
        await serveAsset(req, res, url);
      } else if (req.method === 'POST' && url.pathname === '/api/source') {
        const body = await readJson(req);
        requireRevision(body.revision);
        if (typeof body.source !== 'string' || Buffer.byteLength(body.source, 'utf8') > BODY_LIMIT || body.source.includes('\0')) {
          throw new HttpError(400, 'Source must be a text string under 1 MB without null characters.');
        }
        const result = await serialized(async () => {
          await checkRevision(body.revision);
          const nextBytes = Buffer.from(body.source, 'utf8');
          const nextRevision = HASH(nextBytes);
          if (nextRevision !== revision) {
            await safeProjectPath(projectDir, sourceName);
            const tempPath = path.join(path.dirname(sourcePath), `.latex-editor-save-${randomBytes(8).toString('hex')}.tmp`);
            try {
              await fs.writeFile(tempPath, nextBytes, { flag: 'wx' });
              // Check again after writing the temporary file, before replacing the source.
              await checkRevision(body.revision);
              await fs.rename(tempPath, sourcePath);
            } finally { await fs.rm(tempPath, { force: true }).catch(() => {}); }
            sourceBytes = nextBytes;
            revision = nextRevision;
            state.sourceRevision = revision;
            broadcast();
          }
          return { revision };
        });
        json(res, 200, result);
      } else if (req.method === 'POST' && url.pathname === '/api/compile') {
        const body = await readJson(req);
        requireRevision(body.revision);
        const result = await serialized(async () => {
          const current = await checkRevision(body.revision);
          if (state.status === 'compiling' && !pending && state.jobId && activeRevision === current.revision) {
            return { jobId: state.jobId, queued: false };
          }
          if (pending?.revision === current.revision) return { jobId: pending.id, queued: Boolean(runner) };
          const id = `${Date.now()}-${++sequence}`;
          pending = { id, revision: current.revision, bytes: current.bytes };
          const queued = Boolean(runner);
          state.queued = queued;
          state.queuedRevision = queued ? current.revision : null;
          startRunner();
          broadcast();
          return { jobId: id, queued };
        });
        json(res, 202, result);
      } else if (req.method === 'GET' && url.pathname === '/api/state') {
        await serialized(refreshSource);
        json(res, 200, snapshotState());
      } else if (req.method === 'GET' && url.pathname === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
        clients.add(res);
        res.write(`event: state\ndata: ${JSON.stringify(snapshotState())}\n\n`);
        const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 20_000);
        heartbeat.unref();
        res.on('close', () => { clearInterval(heartbeat); clients.delete(res); });
      } else if (['GET', 'HEAD'].includes(req.method) && url.pathname === '/api/pdf') {
        await servePdf(req, res, url);
      } else if (['GET', 'HEAD'].includes(req.method) && pdfJsAsset(url.pathname)) {
        const [filename, mime] = pdfJsAsset(url.pathname);
        let contents;
        try { contents = await fs.readFile(path.join(PDFJS_ROOT, filename)); }
        catch (error) { if (error.code === 'ENOENT') throw new HttpError(404, 'Viewer resource not found.'); throw error; }
        res.writeHead(200, { 'Content-Type': mime, 'Content-Length': contents.length, 'Cache-Control':'public, max-age=86400' });
        res.end(req.method === 'HEAD' ? undefined : contents);
      } else if (['GET', 'HEAD'].includes(req.method) && STATIC_FILES.has(url.pathname)) {
        const [filename, mime] = STATIC_FILES.get(url.pathname);
        let contents;
        try { contents = await fs.readFile(path.join(publicDir, filename)); }
        catch (error) { if (error.code === 'ENOENT') throw new HttpError(404, 'Editor file not found.'); throw error; }
        res.writeHead(200, { 'Content-Type': mime, 'Content-Length': contents.length });
        res.end(req.method === 'HEAD' ? undefined : contents);
      } else throw new HttpError(404, 'Not found.');
    } catch (error) {
      if (res.headersSent || res.destroyed) { res.destroy(); return; }
      const status = error.status || (['ENOENT', 'ENOTDIR'].includes(error.code) ? 404 : ['EACCES', 'EPERM'].includes(error.code) ? 403 : 500);
      json(res, status, { error: status === 500 ? 'The editor could not complete the request. Check the server console.' : error.message, ...(error.detail || {}) });
      if (status === 500) console.error(error);
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  // Ensure API users cannot accidentally bind the editor to all network interfaces.
  const nativeListen = server.listen.bind(server);
  server.listen = (...args) => {
    let host;
    if (typeof args[0] === 'object' && args[0]) host = args[0].host;
    else if (typeof args[1] === 'string') host = args[1];
    if (host && !['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('The editor must bind to a loopback address.');
    if (typeof args[0] === 'object' && args[0]) args[0] = { ...args[0], host: host || '127.0.0.1' };
    else if (!host) args.splice(1, 0, '127.0.0.1');
    return nativeListen(...args);
  };
  const close = async () => {
    closed = true;
    pending = null;
    clearTimeout(broadcastTimer);
    for (const client of clients) client.end();
    clients.clear();
    activeAbort?.abort();
    await runner;
    if (server.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  };
  return { server, close, getState: snapshotState, sourcePath, projectDir, workDir };
}

function cliOptions(argv) {
  const options = {};
  const mapping = { '--project-dir': 'projectDir', '--source-name': 'sourceName', '--work-dir': 'workDir', '--asset-dir': 'assetDir', '--compiler-path': 'compilerPath', '--cache-dir': 'cacheDir', '--fontconfig-file': 'fontConfigPath', '--port': 'port' };
  for (let i = 0; i < argv.length; i++) {
    const name = mapping[argv[i]];
    if (!name || !argv[i + 1]) throw new Error(`Unknown or incomplete option: ${argv[i]}`);
    options[name] = argv[++i];
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = cliOptions(process.argv.slice(2));
    const port = Number(options.port || process.env.LATEX_EDITOR_PORT || process.env.PORT || 4380);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be between 1 and 65535.');
    const editor = await createProjectManager(options);
    editor.server.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
    editor.server.listen(port, '127.0.0.1', () => console.log(`LaTeX editor ready: http://127.0.0.1:${port}\nSource: ${editor.sourcePath}`));
    const shutdown = () => editor.close().then(() => process.exit(0), () => process.exit(1));
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
