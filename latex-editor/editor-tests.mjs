import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createEditorServer } from './server.mjs';

const originalSource = '\\documentclass{article}\n\\begin{document}\nOriginal document\n\\end{document}\n';
const originalPdf = Buffer.from('%PDF-1.4\noriginal-preview\n%%EOF\n');

async function fixture(t, compile) {
  const base = await mkdtemp(path.join(tmpdir(), 'latex-editor-test-'));
  const projectDir = path.join(base, 'project');
  const workDir = path.join(base, 'work');
  const assetDir = path.join(base, 'public');
  await Promise.all([
    mkdir(path.join(projectDir, 'build'), { recursive: true }),
    mkdir(workDir),
    mkdir(assetDir)
  ]);
  await Promise.all([
    writeFile(path.join(projectDir, 'main-en.tex'), originalSource),
    writeFile(path.join(projectDir, 'build', 'main-en.pdf'), originalPdf),
    writeFile(path.join(assetDir, 'index.html'), '<!doctype html><title>Editor test</title>'),
    writeFile(path.join(base, 'private.txt'), 'private-fixture-marker')
  ]);
  const editor = await createEditorServer({
    projectDir, workDir, assetDir,
    compile: compile ?? (async ({ outDir }) => {
      const pdfPath = path.join(outDir, 'main-en.pdf');
      await writeFile(pdfPath, originalPdf);
      return { pdfPath };
    })
  });
  await new Promise(resolve => editor.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${editor.server.address().port}`;
  t.after(async () => {
    await editor.close();
    // This directory was created by mkdtemp above; never remove the supplied project.
    assert.equal(path.dirname(base), tmpdir());
    await rm(base, { recursive: true, force: true });
  });
  const request = (route, options) => fetch(`${origin}${route}`, options);
  const post = (route, body, headers = {}) => request(route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, ...headers },
    body: JSON.stringify(body)
  });
  const project = async () => (await request('/api/project')).json();
  const state = async () => (await request('/api/state')).json();
  const save = async (source, revision) => {
    const response = await post('/api/source', { source, revision });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  return { base, projectDir, workDir, assetDir, editor, origin, request, post, project, state, save };
}

async function until(get, predicate, description, timeout = 6000) {
  const end = Date.now() + timeout;
  let value;
  do {
    value = await get();
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 25));
  } while (Date.now() < end);
  assert.fail(`Timed out waiting for ${description}: ${JSON.stringify(value)}`);
}

function rawRequest(origin, route, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.get(`${origin}${route}`, { headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    request.on('error', reject);
  });
}

test('loads the existing source and PDF, including valid and unsatisfiable byte ranges', async t => {
  const f = await fixture(t);
  const project = await f.project();
  assert.equal(project.source, originalSource);
  assert.equal(project.hasPdf, true);
  assert.ok(project.revision);
  const pdf = await f.request('/api/pdf');
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers.get('content-type'), /^application\/pdf/);
  assert.deepEqual(Buffer.from(await pdf.arrayBuffer()), originalPdf);
  const raw = await f.request('/api/pdf?raw=1');
  assert.equal(raw.headers.get('content-type'), 'application/octet-stream');
  assert.equal(raw.headers.get('content-disposition'), null);
  assert.deepEqual(Buffer.from(await raw.arrayBuffer()), originalPdf);
  const range = await f.request('/api/pdf', { headers: { Range: 'bytes=0-7' } });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get('content-range'), `bytes 0-7/${originalPdf.length}`);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), originalPdf.subarray(0, 8));
  const suffix = await f.request('/api/pdf', { headers: { Range: 'bytes=-6' } });
  assert.equal(suffix.status, 206);
  assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), originalPdf.subarray(-6));
  const invalid = await f.request('/api/pdf', { headers: { Range: 'bytes=9999-' } });
  assert.equal(invalid.status, 416);
  assert.equal(invalid.headers.get('content-range'), `bytes */${originalPdf.length}`);
});

test('saves the source and rejects a stale browser tab without overwriting its newer changes', async t => {
  const f = await fixture(t);
  const project = await f.project();
  const source = originalSource.replace('Original', 'Updated');
  const saved = await f.save(source, project.revision);
  assert.notEqual(saved.revision, project.revision);
  assert.equal(await readFile(path.join(f.projectDir, 'main-en.tex'), 'utf8'), source);
  const stale = await f.post('/api/source', { source: originalSource, revision: project.revision });
  assert.equal(stale.status, 409);
  assert.equal(await readFile(path.join(f.projectDir, 'main-en.tex'), 'utf8'), source);
  const staleCompile = await f.post('/api/compile', { revision: project.revision });
  assert.equal(staleCompile.status, 409);
});

test('detects edits made by another program and preserves them on a conflicting save', async t => {
  const f = await fixture(t);
  const project = await f.project();
  // Keep the same length so this tests content changes, not just a size check.
  const externalSource = originalSource.replace('Original', 'External');
  await writeFile(path.join(f.projectDir, 'main-en.tex'), externalSource);
  const response = await f.post('/api/source', { source: originalSource, revision: project.revision });
  assert.equal(response.status, 409);
  assert.equal(await readFile(path.join(f.projectDir, 'main-en.tex'), 'utf8'), externalSource);
  const updatedProject = await f.project();
  assert.equal(updatedProject.source, externalSource);
  assert.notEqual(updatedProject.revision, project.revision);
});

test('rejects foreign browser origins, foreign Hosts, invalid source payloads, and traversal', async t => {
  const f = await fixture(t);
  const project = await f.project();
  const foreignOrigin = await f.post('/api/source', { source: originalSource, revision: project.revision }, { Origin: 'https://unrelated.example' });
  assert.ok([400, 403].includes(foreignOrigin.status));
  const foreignHost = await rawRequest(f.origin, '/api/project', { Host: 'unrelated.example' });
  assert.ok([400, 403].includes(foreignHost.status));
  const nonString = await f.post('/api/source', { source: ['invalid'], revision: project.revision });
  assert.equal(nonString.status, 400);
  const notJson = await f.request('/api/source', {
    method: 'POST', headers: { Origin: f.origin, 'Content-Type': 'text/plain' }, body: '{}'
  });
  assert.ok([400, 415].includes(notJson.status));
  const oversized = await f.post('/api/source', { source: 'x'.repeat(1024 * 1024 + 1), revision: project.revision });
  assert.equal(oversized.status, 413);
  for (const route of ['/..%2fprivate.txt', '/%2e%2e%2fprivate.txt', '/main-en.tex', '/build/main-en.pdf']) {
    const result = await rawRequest(f.origin, route);
    assert.ok([400, 403, 404].includes(result.status), `Unexpected status for ${route}: ${result.status}`);
    assert.doesNotMatch(result.body, /private-fixture-marker|Original document/);
  }
  assert.equal(await readFile(path.join(f.projectDir, 'main-en.tex'), 'utf8'), originalSource);
});

test('keeps the last good PDF and provides compiler diagnostics after a failed compile', async t => {
  const f = await fixture(t, async ({ onLog }) => {
    onLog('! Undefined control sequence.\nl.3 \\brokencommand\n');
    const error = new Error('Compilation failed');
    error.log = '! Undefined control sequence.\nl.3 \\brokencommand\n';
    throw error;
  });
  const project = await f.project();
  const beforeState = await f.state();
  const response = await f.post('/api/compile', { revision: project.revision });
  assert.equal(response.status, 202);
  const failed = await until(f.state, state => Boolean(state.error) && state.status !== 'compiling', 'compiler error');
  assert.match(failed.log, /Undefined control sequence/);
  assert.equal(failed.hasPdf, true);
  assert.equal(failed.pdfVersion, beforeState.pdfVersion);
  const pdf = await f.request('/api/pdf');
  assert.deepEqual(Buffer.from(await pdf.arrayBuffer()), originalPdf);
});

test('keeps versioned PDF bytes stable when a later successful build replaces the preview', async t => {
  let buildNumber = 0;
  const outputs = [];
  const f = await fixture(t, async ({ outDir }) => {
    const bytes = Buffer.from(`%PDF-1.4\nsuccessful-build-${++buildNumber}\n%%EOF\n`);
    outputs.push(bytes);
    const pdfPath = path.join(outDir, 'main-en.pdf');
    await writeFile(pdfPath, bytes);
    return { pdfPath };
  });
  const project = await f.project();
  await f.post('/api/compile', { revision: project.revision });
  const first = await until(f.state, state => state.compiledRevision === project.revision && state.status !== 'compiling', 'first PDF build');
  const saved = await f.save(originalSource.replace('Original', 'Second'), project.revision);
  await f.post('/api/compile', { revision: saved.revision });
  const second = await until(f.state, state => state.compiledRevision === saved.revision && state.status !== 'compiling', 'second PDF build');
  assert.notEqual(String(first.pdfVersion), String(second.pdfVersion));
  const old = await f.request(`/api/pdf?version=${encodeURIComponent(first.pdfVersion)}`);
  assert.deepEqual(Buffer.from(await old.arrayBuffer()), outputs[0]);
  const oldRange = await f.request(`/api/pdf?version=${encodeURIComponent(first.pdfVersion)}`, { headers: { Range: 'bytes=9-19' } });
  assert.equal(oldRange.status, 206);
  assert.deepEqual(Buffer.from(await oldRange.arrayBuffer()), outputs[0].subarray(9, 20));
  const latest = await f.request(`/api/pdf?version=${encodeURIComponent(second.pdfVersion)}`);
  assert.deepEqual(Buffer.from(await latest.arrayBuffer()), outputs[1]);
});

test('compiles immutable source snapshots and coalesces rapid requests to the newest saved revision', async t => {
  const calls = [];
  let releaseFirst;
  const firstBarrier = new Promise(resolve => { releaseFirst = resolve; });
  t.after(() => releaseFirst());
  const f = await fixture(t, async ({ sourcePath, outDir, revision }) => {
    const call = { source: await readFile(sourcePath, 'utf8'), sourcePath, revision };
    calls.push(call);
    if (calls.length === 1) {
      await firstBarrier;
      assert.equal(await readFile(sourcePath, 'utf8'), call.source, 'Running job source was mutated');
    }
    const pdfPath = path.join(outDir, 'main-en.pdf');
    await writeFile(pdfPath, Buffer.from(`%PDF-1.4\nrevision:${revision}\n%%EOF\n`));
    return { pdfPath, log: `Compiled ${revision}` };
  });
  const project = await f.project();
  assert.equal((await f.post('/api/compile', { revision: project.revision })).status, 202);
  await until(async () => calls, value => value.length === 1, 'first compiler job');
  const middleSource = originalSource.replace('Original', 'Middle');
  const middle = await f.save(middleSource, project.revision);
  assert.equal((await f.post('/api/compile', { revision: middle.revision })).status, 202);
  const newestSource = originalSource.replace('Original', 'Newest');
  const newest = await f.save(newestSource, middle.revision);
  assert.equal((await f.post('/api/compile', { revision: newest.revision })).status, 202);
  const queued = await f.state();
  assert.equal(queued.queued, true);
  assert.equal(queued.queuedRevision, newest.revision);
  releaseFirst();
  const complete = await until(f.state, state => state.compiledRevision === newest.revision && !state.queued && state.status !== 'compiling', 'newest published PDF');
  assert.equal(calls.length, 2, 'Intermediate queued source should not start another compiler');
  assert.equal(calls[0].source, originalSource);
  assert.equal(calls[1].source, newestSource);
  assert.notEqual(calls[0].sourcePath, calls[1].sourcePath);
  assert.equal(complete.sourceRevision, newest.revision);
  const pdf = await f.request('/api/pdf');
  assert.ok(Buffer.from(await pdf.arrayBuffer()).toString().includes(`revision:${newest.revision}`));
});

test('restores the latest successful PDF and its source revision after restarting', async t => {
  const latestPdf = Buffer.from('%PDF-1.4\nlatest-saved-preview\n%%EOF\n');
  const f = await fixture(t, async ({ outDir }) => {
    const pdfPath = path.join(outDir, 'main-en.pdf');
    await writeFile(pdfPath, latestPdf);
    return { pdfPath };
  });
  const project = await f.project();
  const saved = await f.save(originalSource.replace('Original', 'Latest'), project.revision);
  await f.post('/api/compile', { revision: saved.revision });
  await until(f.state, state => state.compiledRevision === saved.revision && state.status === 'ready', 'saved preview');
  await f.editor.close();
  const reopened = await createEditorServer({ projectDir: f.projectDir, workDir: f.workDir, compile: async () => assert.fail('Restart should not compile') });
  try {
    await new Promise(resolve => reopened.server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${reopened.server.address().port}`;
    const state = await (await fetch(`${origin}/api/state`)).json();
    assert.equal(state.compiledRevision, saved.revision);
    assert.equal(state.status, 'ready');
    const pdf = await fetch(`${origin}/api/pdf?raw=1`);
    assert.deepEqual(Buffer.from(await pdf.arrayBuffer()), latestPdf);
  } finally { await reopened.close(); }
});

test('lists only visible top-level project files and previews assets without changing either source', async t => {
  const f = await fixture(t);
  const chineseSource = '\\documentclass{article}\n原始文件\n';
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nJcAAAAASUVORK5CYII=', 'base64');
  await Promise.all([
    writeFile(path.join(f.projectDir, 'main.tex'), chineseSource),
    writeFile(path.join(f.projectDir, 'Fig2.png'), png),
    writeFile(path.join(f.assetDir, 'Fig2.png'), png),
    writeFile(path.join(f.projectDir, 'Fig10.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9])),
    writeFile(path.join(f.projectDir, 'references.bib'), '@article{test, title={Test}}'),
    writeFile(path.join(f.projectDir, 'diagram.tikz'), '\\draw (0,0) -- (1,1);'),
    writeFile(path.join(f.projectDir, 'notes.pdf'), originalPdf),
    writeFile(path.join(f.projectDir, '.private.tex'), 'private-fixture-marker'),
    writeFile(path.join(f.projectDir, 'private.txt'), 'private-fixture-marker'),
    mkdir(path.join(f.projectDir, '.tools')),
    mkdir(path.join(f.projectDir, 'nested')),
  ]);
  await writeFile(path.join(f.projectDir, 'nested', 'nested.tex'), 'private-fixture-marker');
  const manifestResponse = await f.request('/api/files');
  assert.equal(manifestResponse.status, 200);
  const { files } = await manifestResponse.json();
  assert.deepEqual(files.map(file => file.name), ['diagram.tikz', 'Fig2.png', 'Fig10.jpg', 'main-en.tex', 'main.tex', 'notes.pdf', 'references.bib']);
  assert.deepEqual(files.find(file => file.name === 'Fig2.png'), { name: 'Fig2.png', size: png.length, type: 'image' });
  const sourcePreview = await f.request('/api/asset?name=main.tex');
  assert.equal(sourcePreview.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(await sourcePreview.text(), chineseSource);
  const imagePreview = await f.request('/api/asset?name=Fig2.png');
  assert.equal(imagePreview.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await imagePreview.arrayBuffer()), png);
  const head = await f.request('/api/asset?name=Fig2.png', { method: 'HEAD' });
  assert.equal(Number(head.headers.get('content-length')), png.length);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  const pdfPreview = await f.request('/api/asset?name=notes.pdf');
  assert.equal(pdfPreview.headers.get('content-type'), 'application/pdf');
  assert.deepEqual(Buffer.from(await pdfPreview.arrayBuffer()), originalPdf);
  await writeFile(path.join(f.projectDir, 'main.tex'), `${chineseSource}external update\n`);
  assert.equal(await (await f.request('/api/asset?name=main.tex')).text(), `${chineseSource}external update\n`);
  await rm(path.join(f.projectDir, 'Fig10.jpg'));
  assert.equal((await f.request('/api/asset?name=Fig10.jpg')).status, 404, 'Preview must use a fresh manifest');
  assert.equal(await readFile(path.join(f.projectDir, 'main-en.tex'), 'utf8'), originalSource);
  assert.equal(await readFile(path.join(f.projectDir, 'main.tex'), 'utf8'), `${chineseSource}external update\n`);
});

test('rejects private paths, foreign requests, and files above the preview limits', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.projectDir, '.private.tex'), 'private-fixture-marker');
  for (const name of ['../private.txt', '..\\private.txt', '.private.tex', 'build/main-en.pdf', 'C:\\Windows\\win.ini', 'missing.tex', '%2e%2e%2fprivate.txt']) {
    const result = await f.request(`/api/asset?name=${encodeURIComponent(name)}`);
    assert.ok([400, 404].includes(result.status), `Unexpected status for ${name}: ${result.status}`);
    assert.doesNotMatch(await result.text(), /private-fixture-marker|Original document/);
  }
  const foreignOrigin = await f.request('/api/files', { headers: { Origin: 'https://unrelated.example' } });
  assert.equal(foreignOrigin.status, 403);
  const foreignAsset = await f.request('/api/asset?name=main-en.tex', { headers: { 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(foreignAsset.status, 403);
  const foreignHost = await rawRequest(f.origin, '/api/asset?name=main-en.tex', { Host: 'unrelated.example' });
  assert.equal(foreignHost.status, 403);
  for (const [filename, size] of [['large.tex', 1024 * 1024 + 1], ['large.png', 32 * 1024 * 1024 + 1]]) {
    const filenamePath = path.join(f.projectDir, filename);
    await writeFile(filenamePath, '');
    await truncate(filenamePath, size);
    assert.equal((await f.request(`/api/asset?name=${filename}`)).status, 413);
  }
  const unsupportedWrite = await f.post('/api/asset?name=main-en.tex', { source: 'malicious replacement' });
  assert.equal(unsupportedWrite.status, 404);
  assert.equal(await readFile(path.join(f.projectDir, 'main-en.tex'), 'utf8'), originalSource);
});

test('does not list or follow a project file symlink', async t => {
  const f = await fixture(t);
  const target = path.join(f.base, 'private.tex');
  await writeFile(target, 'private-fixture-marker');
  try {
    await symlink(target, path.join(f.projectDir, 'linked.tex'), 'file');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
      t.skip('This Windows account cannot create file symlinks.');
      return;
    }
    throw error;
  }
  const { files } = await (await f.request('/api/files')).json();
  assert.equal(files.some(file => file.name === 'linked.tex'), false);
  const result = await f.request('/api/asset?name=linked.tex');
  assert.equal(result.status, 404);
  assert.doesNotMatch(await result.text(), /private-fixture-marker/);
});
