// Test end-to-end: apre l'app in Chromium e verifica avvio, test integrato,
// importazione SVG, messaggi d'errore, export STL e calcolo nel Web Worker.
// Le dipendenze CDN vengono servite da node_modules (stesse versioni pinnate),
// così i test non dipendono dalla rete.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const workerJs = read('js/worker.js');
const version = read('js/config.js').match(/E\.VERSION = '([\w-]+)'/)[1];

const types = { '.html': 'text/html', '.js': 'application/javascript' };
let browser, server, httpUrl;
const fileUrl = pathToFileURL(path.join(root, 'index.html')).href;

before(async () => {
  browser = await chromium.launch();
  server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.join(root, rel);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  httpUrl = `http://127.0.0.1:${server.address().port}/index.html`;
});
after(async () => {
  await browser?.close();
  server?.close();
});

// Ogni script CDN deve corrispondere a un file della stessa versione in node_modules.
const cdn = /https:\/\/cdn\.jsdelivr\.net\/npm\/((?:@[^/]+\/)?[^@/]+)@([^/]+)\/([^"']+)/g;
function localFile(url) {
  const [, name, version, file] = url.match(new RegExp(cdn.source)) ?? [];
  if (!name) return null;
  const pkgDir = path.join(root, 'node_modules', name);
  const installed = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).version;
  assert.equal(installed, version, `${name}: l'app usa ${version}, node_modules ha ${installed}`);
  return path.join(pkgDir, file);
}

async function openApp(url = httpUrl) {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // context.route intercetta anche le richieste del Web Worker.
  await context.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('file:') || u.startsWith(new URL(httpUrl).origin)) return route.continue();
    const file = localFile(u);
    if (!file) return route.abort();
    return route.fulfill({ path: file, contentType: 'application/javascript' });
  });
  await page.goto(url);
  await page.waitForFunction((v) => document.getElementById('status').textContent.startsWith(v + ':'), version);
  return { page, context, errors, status: () => page.textContent('#status') };
}

async function waitStatus(page, re) {
  await page.waitForFunction((src) => new RegExp(src).test(document.getElementById('status').textContent), re.source, { timeout: 60000 });
}

async function loadSvg(page, svg) {
  await page.setInputFiles('#file', { name: 'test.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) });
}

const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`;
const DONE = /superano il controllo|^Errore/;

test('le dipendenze CDN hanno versioni esatte, uguali in pagina e worker', () => {
  const pageUrls = [...html.matchAll(cdn)].map((m) => m[0]);
  const workerUrls = [...workerJs.matchAll(cdn)].map((m) => m[0]);
  assert.ok(pageUrls.length >= 4, 'attesi almeno 4 script CDN in index.html');
  assert.ok(workerUrls.length >= 2, 'attesi almeno 2 script CDN nel worker');
  for (const url of workerUrls) assert.ok(pageUrls.includes(url), `${url} del worker non coincide con index.html`);
  for (const url of [...pageUrls, ...workerUrls]) assert.ok(fs.existsSync(localFile(url)), `file mancante per ${url}`);
});

test('avvio senza errori, revisione mostrata e calcolo nel worker', async () => {
  const { page, context, errors } = await openApp();
  await loadSvg(page, svg('<rect x="10" y="10" width="80" height="80"/>'));
  await waitStatus(page, DONE);
  assert.match(await page.textContent('#status'), /superano il controllo/);
  assert.equal(await page.evaluate(() => window.embosser.engine.mode), 'worker');
  assert.deepEqual(errors, []);
  await context.close();
});

test('il test integrato passa (worker)', async () => {
  const { page, context, errors, status } = await openApp();
  await page.click('#test');
  await waitStatus(page, /^Test (superato|fallito)/);
  assert.match(await status(), /^Test superato: \d+ mesh controllate/, await status());
  assert.deepEqual(errors, []);
  await context.close();
});

test('da file:// il calcolo ripiega sulla pagina e funziona', async () => {
  const { page, context, errors, status } = await openApp(fileUrl);
  await loadSvg(page, svg('<rect x="10" y="10" width="80" height="80"/>'));
  await waitStatus(page, DONE);
  assert.match(await status(), /superano il controllo/, await status());
  assert.equal(await page.evaluate(() => window.embosser.engine.mode), 'local');
  await page.click('#test');
  await waitStatus(page, /^Test (superato|fallito)/);
  assert.match(await status(), /^Test superato/, await status());
  assert.deepEqual(errors, []);
  await context.close();
});

test('esporta STL binari validi per positiva e negativa', async () => {
  const { page, context, status } = await openApp();
  await loadSvg(page, svg('<path fill-rule="evenodd" d="M0 0H100V100H0Z M20 20H80V80H20Z"/>'));
  await waitStatus(page, DONE);
  assert.match(await status(), /superano il controllo/, await status());
  for (const [button, name] of [['#male', 'embosser_positivo.stl'], ['#female', 'embosser_negativo.stl']]) {
    assert.equal(await page.isDisabled(button), false);
    const [download] = await Promise.all([page.waitForEvent('download'), page.click(button)]);
    assert.equal(download.suggestedFilename(), name);
    const data = fs.readFileSync(await download.path());
    const triangles = data.readUInt32LE(80);
    assert.ok(triangles > 0);
    assert.equal(data.length, 84 + triangles * 50, 'dimensione STL binario coerente');
    for (let i = 0; i < Math.min(triangles, 500); i++)
      for (let k = 0; k < 12; k++) assert.ok(Number.isFinite(data.readFloatLE(84 + i * 50 + k * 4)));
  }
  await context.close();
});

test('gli stroke diventano rilievi; disattivandoli l’SVG di soli contorni viene rifiutato', async () => {
  const { page, context, status } = await openApp();
  await loadSvg(page, svg('<circle cx="50" cy="50" r="40" fill="none" stroke="black" stroke-width="6"/>'));
  await waitStatus(page, DONE);
  assert.match(await status(), /superano il controllo/, await status());
  assert.match(await page.textContent('#warnings'), /stroke\) convertiti/);
  await page.click('#strokes');
  await waitStatus(page, /^Errore/);
  assert.match(await status(), /solo contorni/);
  assert.equal(await page.isDisabled('#male'), true);
  assert.equal(await page.isDisabled('#both'), true);
  await context.close();
});

// Estrae un file da uno ZIP senza compressione (come quello generato dall'app).
function unzipStored(buf) {
  const files = {};
  let o = 0;
  while (buf.readUInt32LE(o) === 0x04034b50) {
    assert.equal(buf.readUInt16LE(o + 8), 0, 'atteso metodo store');
    const size = buf.readUInt32LE(o + 18),
      nameLen = buf.readUInt16LE(o + 26),
      extra = buf.readUInt16LE(o + 28);
    const name = buf.toString('utf8', o + 30, o + 30 + nameLen);
    files[name] = buf.subarray(o + 30 + nameLen + extra, o + 30 + nameLen + extra + size);
    o += 30 + nameLen + extra + size;
  }
  return files;
}

test('profilo A1: quote multiple del layer ed export 3MF con due oggetti chiusi sul piano', async () => {
  const { page, context, status } = await openApp();
  assert.equal(await page.inputValue('#printer'), 'a1');
  await loadSvg(page, svg('<rect x="10" y="10" width="80" height="80"/><rect x="30" y="30" width="40" height="40" fill="white"/>'));
  await waitStatus(page, DONE);
  const text = await status();
  assert.match(text, /multipli del layer 0\.16 mm/, text);
  const depth = Number(text.match(/cavità ([\d.]+)/)[1]);
  assert.ok(Math.abs(depth / 0.16 - Math.round(depth / 0.16)) < 1e-6, 'cavità multipla del layer: ' + depth);
  assert.match(text, /Pareti inclinate di 15°/);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#both')]);
  assert.equal(download.suggestedFilename(), 'embosser_matrici.3mf');
  const files = unzipStored(fs.readFileSync(await download.path()));
  assert.ok(files['[Content_Types].xml'] && files['_rels/.rels'] && files['3D/3dmodel.model']);
  const model = files['3D/3dmodel.model'].toString('utf8');
  assert.match(model, /unit="millimeter"/);
  const objects = [...model.matchAll(/<object id="(\d+)" name="([^"]+)"[^>]*>(.*?)<\/object>/g)];
  assert.deepEqual(objects.map((m) => m[2]), ['Positiva', 'Negativa']);
  for (const [, , name, body] of objects) {
    const vertices = [...body.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"/g)];
    const tris = [...body.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)].map((m) => m.slice(1).map(Number));
    assert.ok(vertices.length > 0 && tris.length > 0, name);
    // Ogni spigolo orientato compare una volta e il suo opposto una volta: mesh chiusa.
    const edges = new Map();
    for (const t of tris)
      for (let k = 0; k < 3; k++) {
        assert.ok(t[k] < vertices.length);
        const key = t[k] + '>' + t[(k + 1) % 3];
        edges.set(key, (edges.get(key) || 0) + 1);
      }
    for (const [key, n] of edges) {
      const [a, b] = key.split('>');
      assert.equal(n, 1, name + ': spigolo duplicato ' + key);
      assert.equal(edges.get(b + '>' + a), 1, name + ': spigolo senza opposto ' + key);
    }
  }
  // Piastre 100 × 70 affiancate sul piano 256 × 256.
  const items = [...model.matchAll(/<item objectid="\d+" transform="1 0 0 0 1 0 0 0 1 ([\d.]+) ([\d.]+) 0"/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.equal(items.length, 2);
  for (const [x, y] of items) assert.ok(x - 50 >= 0 && x + 50 <= 256 && y - 35 >= 0 && y + 35 <= 256, `fuori piano: ${x},${y}`);
  await context.close();
});

test('dettagli più sottili dell’ugello generano un avviso', async () => {
  const { page, context } = await openApp();
  await page.selectOption('#preset', 'custom');
  await loadSvg(page, svg('<rect x="0" y="0" width="100" height="30"/><rect x="0" y="49.8" width="100" height="0.4"/><rect x="0" y="70" width="100" height="30"/>'));
  await waitStatus(page, DONE);
  assert.match(await page.textContent('#warnings'), /più sottili di 0\.84 mm/);
  await context.close();
});

test('le impostazioni restano dopo il ricaricamento e «Valori predefiniti» le azzera', async () => {
  const { page, context } = await openApp();
  await page.selectOption('#preset', 'custom');
  await page.evaluate(() => { const r = document.getElementById('r'); r.value = '0.64'; r.dispatchEvent(new Event('change')); });
  await page.selectOption('#printer', 'none');
  await page.reload();
  await page.waitForFunction(() => document.getElementById('status').textContent.length > 0);
  assert.equal(await page.inputValue('#r'), '0.64');
  assert.equal(await page.inputValue('#printer'), 'none');
  assert.equal(await page.inputValue('#layer'), '0');
  await page.click('#reset');
  assert.equal(await page.inputValue('#r'), '0.8');
  assert.equal(await page.inputValue('#printer'), 'a1');
  assert.equal(await page.inputValue('#layer'), '0.16');
  await context.close();
});

test('si può trascinare un SVG sulla pagina', async () => {
  const { page, context, status } = await openApp();
  const handle = await page.evaluateHandle((text) => {
    const dt = new DataTransfer();
    dt.items.add(new File([text], 'drop.svg', { type: 'image/svg+xml' }));
    return dt;
  }, svg('<rect x="10" y="10" width="80" height="80"/>'));
  await page.dispatchEvent('#drop', 'drop', { dataTransfer: handle });
  await waitStatus(page, DONE);
  assert.match(await status(), /superano il controllo/, await status());
  await context.close();
});

test('gli errori di geometria dal worker arrivano all’interfaccia', async () => {
  const { page, context, status } = await openApp();
  await page.selectOption('#preset', 'custom');
  await loadSvg(page, svg('<rect width="100" height="100"/>'));
  await waitStatus(page, DONE);
  await page.evaluate(() => { const b = document.getElementById('b'); b.value = '1'; b.dispatchEvent(new Event('change')); });
  await waitStatus(page, /^Errore/);
  assert.match(await status(), /Aumentare lo spessore piastra/);
  assert.equal(await page.isDisabled('#male'), true);
  await context.close();
});

test('una modifica rapida annulla il calcolo precedente e vince l’ultima', async () => {
  const { page, context, status } = await openApp();
  await page.selectOption('#preset', 'custom');
  let circles = '';
  for (let i = 0; i < 20; i++) for (let j = 0; j < 10; j++) circles += `<circle cx="${i * 10 + 5}" cy="${j * 10 + 5}" r="4"/>`;
  await loadSvg(page, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">${circles}</svg>`);
  // Due modifiche consecutive senza attendere: deve restare solo il risultato dell'ultima.
  await page.evaluate(() => {
    const aw = document.getElementById('aw');
    aw.value = '50';
    aw.dispatchEvent(new Event('change'));
    aw.value = '55';
    aw.dispatchEvent(new Event('change'));
  });
  await waitStatus(page, DONE);
  assert.match(await status(), /superano il controllo/, await status());
  assert.equal(await page.isDisabled('#male'), false);
  await context.close();
});

test('i messaggi d’errore usano il nome del campo', async () => {
  const { page, context, status } = await openApp();
  const set = (v) => page.evaluate((v) => { const w = document.getElementById('w'); w.value = v; w.dispatchEvent(new Event('change')); }, v);
  await set('');
  assert.match(await status(), /«Larghezza piastra \[mm\]»/);
  assert.equal(await page.getAttribute('#w', 'aria-invalid'), 'true');
  await set('10');
  assert.match(await status(), /almeno 24 mm/);
  await set('130');
  assert.equal(await page.getAttribute('#w', 'aria-invalid'), null);
  await context.close();
});
