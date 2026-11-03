import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import fs from 'node:fs/promises';
import http from 'node:http';
import { createProjectManager, inspectProject } from './projects.mjs';

const tex = name => `\\documentclass{article}\n\\begin{document}\n${name}\n\\input{chapters/body}\n\\end{document}\n`;
const pdf = name => Buffer.from(`%PDF-1.4\n${name}\n%%EOF\n`);

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(tmpdir(), 'latex-projects-test-'));
  const workDir = path.join(base, 'work');
  const a = path.join(base, 'Proposal'); const b = path.join(base, 'Other');
  for (const directory of [a, b]) {
    await fs.mkdir(path.join(directory, 'chapters'), { recursive: true });
    await fs.mkdir(path.join(directory, 'images'));
  }
  await fs.writeFile(path.join(a, 'main-en.tex'), tex('Proposal'));
  await fs.writeFile(path.join(a, 'chapters', 'body.tex'), 'Proposal chapter');
  await fs.writeFile(path.join(a, 'images', 'sample.png'), 'AAAA');
  await fs.writeFile(path.join(b, 'report.tex'), tex('Different document'));
  await fs.writeFile(path.join(b, 'chapters', 'body.tex'), 'Other chapter');
  await fs.writeFile(path.join(b, 'images', 'sample.png'), 'BBBB');
  const jobs = [];
  const compile = async job => {
    const source = await fs.readFile(job.sourcePath, 'utf8');
    const chapter = await fs.readFile(path.join(job.jobDir, 'chapters', 'body.tex'), 'utf8');
    const image = await fs.readFile(path.join(job.jobDir, 'images', 'sample.png'), 'utf8');
    jobs.push({ source, chapter, image, filename: path.basename(job.sourcePath), jobDir: job.jobDir });
    const pdfPath = path.join(job.outDir, path.parse(job.sourcePath).name + '.pdf');
    await fs.writeFile(pdfPath, pdf(`${source}\n${chapter}\n${image}`));
    return { pdfPath, log: 'Finished ' + path.basename(job.sourcePath) };
  };
  let manager;
  const start = async (opts = { projectDir: a }) => {
    manager = await createProjectManager({ ...opts, workDir, compile });
    await new Promise(resolve => manager.server.listen(0, '127.0.0.1', resolve));
    return manager;
  };
  await start();
  t.after(async () => {
    await manager.close();
    assert.equal(path.dirname(base), tmpdir());
    await fs.rm(base, { recursive: true, force: true });
  });
  const request = (route, options) => fetch(`http://127.0.0.1:${manager.server.address().port}${route}`, options);
  const post = (route, body, headers = {}) => request(route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const get = async route => (await request(route)).json();
  const open = async (projectDir, mainFile) => {
    const result = await post('/api/projects/open', { projectDir, mainFile });
    assert.equal(result.status, 200, await result.clone().text());
    return (await result.json()).project;
  };
  const build = async id => {
    const project = await get(`/api/project?project=${id}`);
    const result = await post(`/api/compile?project=${id}`, { revision: project.revision });
    assert.equal(result.status, 202, await result.clone().text());
    const end = Date.now() + 5000;
    while (Date.now() < end) {
      const state = await get(`/api/state?project=${id}`);
      if (state.status === 'ready' || state.status === 'error') { assert.equal(state.status, 'ready', state.log); return state; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.fail('Timed out compiling the isolated document.');
  };
  return { base, a, b, workDir, request, post, get, open, build, jobs, start,
    close: () => manager.close(), manager: () => manager };
}

test('opens different main files and keeps saves, builds, assets and stale tabs scoped to each project', async t => {
  const f = await fixture(t);
  const first = (await f.get('/api/projects')).activeProjectId;
  const oldTab = await f.get(`/api/project?project=${first}`);
  const second = await f.open(f.b);
  assert.equal(second.mainFile, 'report.tex');
  const current = await f.get(`/api/project?project=${second.id}`);
  assert.equal(current.sourceName, 'report.tex'); assert.equal(current.id, second.id);
  assert.equal(current.projectDir, f.b);
  assert.equal((await f.get('/api/project')).id, second.id);
  const saved = await f.post(`/api/source?project=${first}`, { source: oldTab.source.replace('Proposal\n', 'Changed proposal\n'), revision: oldTab.revision });
  assert.equal(saved.status, 200);
  assert.equal(await fs.readFile(path.join(f.b, 'report.tex'), 'utf8'), tex('Different document'));
  assert.equal((await f.post(`/api/source?project=${second.id}`, { source: 'wrong project', revision: oldTab.revision })).status, 409);
  await f.build(first); await f.build(second.id);
  assert.deepEqual(f.jobs.map(job => [job.filename, job.chapter, job.image]), [['main-en.tex', 'Proposal chapter', 'AAAA'], ['report.tex', 'Other chapter', 'BBBB']]);
  assert.notEqual(f.jobs[0].jobDir, f.jobs[1].jobDir);
  const aPdf = await (await f.request(`/api/pdf?project=${first}&raw=1`)).text();
  const bPdf = await (await f.request(`/api/pdf?project=${second.id}&raw=1`)).text();
  assert.match(aPdf, /Changed proposal/); assert.doesNotMatch(aPdf, /Other chapter/);
  assert.match(bPdf, /Different document/); assert.doesNotMatch(bPdf, /Changed proposal/);
  assert.match((await f.request(`/api/pdf?project=${second.id}&download=1`)).headers.get('content-disposition'), /report\.pdf/);
  const tree = await f.get(`/api/files?project=${second.id}`);
  assert.ok(tree.files.some(file => file.name === 'chapters/body.tex'));
  assert.ok(tree.files.some(file => file.name === 'images/sample.png'));
  assert.equal(await (await f.request(`/api/asset?project=${second.id}&name=chapters%2Fbody.tex`)).text(), 'Other chapter');
});

test('reads changed images with identical sizes on the next build instead of stale project mirrors', async t => {
  const f = await fixture(t);
  const id = (await f.open(f.b)).id;
  await f.build(id);
  await fs.writeFile(path.join(f.b, 'images', 'sample.png'), 'CCCC');
  await f.build(id);
  assert.deepEqual(f.jobs.map(job => job.image), ['BBBB', 'CCCC']);
  assert.equal(await (await f.request(`/api/asset?project=${id}&name=images%2Fsample.png`)).text(), 'CCCC');
});

test('restores the selected document and its last good PDF after reopening, including without a supplied folder', async t => {
  const f = await fixture(t);
  const second = await f.open(f.b); await f.build(second.id);
  const bytes = await (await f.request(`/api/pdf?project=${second.id}&raw=1`)).text();
  await f.close(); await f.start({});
  const project = await f.get('/api/project');
  assert.equal(project.id, second.id); assert.equal(project.hasPdf, true);
  assert.equal(await (await f.request(`/api/pdf?project=${second.id}&raw=1`)).text(), bytes);
  assert.equal((await f.get('/api/projects')).projects.length, 2);
});

test('keeps each document PDF in the same storage when a later launch supplies a different starting folder', async t => {
  const f = await fixture(t);
  const first = (await f.get('/api/projects')).activeProjectId;
  await f.build(first);
  const firstBytes = await (await f.request(`/api/pdf?project=${first}&raw=1`)).text();
  await f.close(); await f.start({ projectDir: f.b });
  const second = (await f.get('/api/projects')).activeProjectId;
  assert.notEqual(first, second);
  await f.build(second);
  const secondBytes = await (await f.request(`/api/pdf?project=${second}&raw=1`)).text();
  await f.close(); await f.start({ projectDir: f.a });
  assert.equal(await (await f.request(`/api/pdf?project=${first}&raw=1`)).text(), firstBytes);
  assert.equal(await (await f.request(`/api/pdf?project=${second}&raw=1`)).text(), secondBytes);
  const registry = JSON.parse(await fs.readFile(path.join(f.workDir, 'projects', 'registry.json'), 'utf8'));
  assert.equal(registry.defaultProjectId, first);
});

test('inspects main files, prefers the conventional main names and permits an explicit nested main file', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.b, 'chapter.tex'), 'A chapter without documentclass');
  const inspected = await f.get(`/api/projects/inspect?projectDir=${encodeURIComponent(f.b)}`);
  assert.equal(inspected.suggestedMain, 'report.tex');
  assert.ok(inspected.files.includes('chapters/body.tex'));
  await fs.mkdir(path.join(f.b, 'manuscripts'));
  await fs.writeFile(path.join(f.b, 'manuscripts', 'paper.tex'), tex('Nested main'));
  const nested = await f.open(f.b, 'manuscripts/paper.tex');
  await f.build(nested.id);
  assert.equal(f.jobs.at(-1).filename, 'paper.tex');
  assert.match(f.jobs.at(-1).source, /Nested main/);
  await fs.writeFile(path.join(f.b, 'main.tex'), tex('Main'));
  assert.equal((await inspectProject(f.b)).suggestedMain, 'main.tex');
  assert.equal((await inspectProject(f.a)).suggestedMain, 'main-en.tex');
});

test('creates a reusable template and imports a complete nested document without changing existing documents', async t => {
  const f = await fixture(t);
  const newResponse = await f.post('/api/projects/new', { name: 'Research Notes' });
  assert.equal(newResponse.status, 201);
  const created = (await newResponse.json()).project;
  assert.equal(created.name, 'Research Notes'); assert.equal(created.mainFile, 'main.tex');
  assert.ok(path.relative(path.join(f.workDir, 'projects', 'documents'), created.projectDir).startsWith('Research-Notes-'));
  assert.match((await f.get(`/api/project?project=${created.id}`)).source, /\\documentclass\{article\}/);
  const response = await f.post('/api/projects/import', { name: 'Imported Research', mainFile: 'draft/paper.tex', files: [
    { name: 'draft/paper.tex', content: Buffer.from(tex('Imported')).toString('base64') },
    { name: 'chapters/body.tex', content: Buffer.from('Imported chapter').toString('base64') },
    { name: 'images/sample.png', content: Buffer.from('DDDD').toString('base64') },
    { name: 'references.bib', content: Buffer.from('@article{example}').toString('base64') },
  ] });
  assert.equal(response.status, 201, await response.clone().text());
  const imported = (await response.json()).project; assert.equal(imported.mainFile, 'draft/paper.tex');
  await f.build(imported.id);
  assert.deepEqual([f.jobs.at(-1).chapter, f.jobs.at(-1).image], ['Imported chapter', 'DDDD']);
  assert.equal(await fs.readFile(path.join(f.a, 'main-en.tex'), 'utf8'), tex('Proposal'));
});

test('rejects unrecognized projects, imports with traversal or hidden paths, foreign origins and symlink escapes', async t => {
  const f = await fixture(t);
  for (const route of ['/api/project', '/api/files', '/api/pdf', '/api/state', '/api/asset?name=main-en.tex']) {
    assert.equal((await f.request(`${route}${route.includes('?') ? '&' : '?'}project=unknown`)).status, 404);
  }
  assert.equal((await f.post('/api/projects/activate', { id: 'unknown' })).status, 404);
  assert.equal((await f.post('/api/projects/open', { projectDir: f.b }, { Origin: 'https://unrelated.example' })).status, 403);
  const foreignHost = await new Promise((resolve, reject) => {
    const request = http.get(`http://127.0.0.1:${f.manager().server.address().port}/api/projects`, { headers: { Host: 'unrelated.example' } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    request.on('error', reject);
  });
  assert.equal(foreignHost, 403);
  for (const name of ['../escape.tex', '..\\escape.tex', '/escape.tex', 'C:\\escape.tex', '.hidden.tex', 'nested/.git/main.tex', 'build/main.tex', 'CON.tex']) {
    const result = await f.post('/api/projects/import', { name: 'Unsafe', files: [{ name, content: Buffer.from(tex('unsafe')).toString('base64') }] });
    assert.equal(result.status, 400, name);
  }
  assert.equal((await f.post('/api/projects/import', { name: 'Invalid', files: [{ name: 'main.tex', content: 'not base64' }] })).status, 400);
  assert.equal((await f.post('/api/projects/import', { name: 'Invalid', files: [{ name: 'main.tex', content: Buffer.from('a').toString('base64') }, { name: 'MAIN.tex', content: Buffer.from('b').toString('base64') }] })).status, 400);
  await fs.writeFile(path.join(f.base, 'private.tex'), 'PRIVATE');
  try { await fs.symlink(path.join(f.base, 'private.tex'), path.join(f.b, 'outside.tex'), 'file'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.diagnostic('File symlinks are unavailable for this account.'); return; } throw error; }
  const opened = await f.open(f.b);
  assert.equal((await f.get(`/api/files?project=${opened.id}`)).files.some(file => file.name === 'outside.tex'), false);
  assert.equal((await f.request(`/api/asset?project=${opened.id}&name=outside.tex`)).status, 404);
  assert.equal((await f.post('/api/projects/open', { projectDir: f.b, mainFile: 'outside.tex' })).status, 404);
});

test('starts with an editable template when no existing folder or registry was supplied', async t => {
  const base = await fs.mkdtemp(path.join(tmpdir(), 'latex-empty-test-'));
  const manager = await createProjectManager({ workDir: base, compile: async () => ({}) });
  t.after(async () => { await manager.close(); assert.equal(path.dirname(base), tmpdir()); await fs.rm(base, { recursive: true, force: true }); });
  await new Promise(resolve => manager.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${manager.server.address().port}`;
  const project = await (await fetch(`${origin}/api/project`)).json();
  assert.equal(project.sourceName, 'main.tex'); assert.match(project.source, /Start writing here/);
  assert.equal((await (await fetch(`${origin}/api/health`)).json()).multiProject, true);
  assert.throws(() => manager.server.listen(0, '0.0.0.0'), /loopback/);
});
