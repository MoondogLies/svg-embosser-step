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
  assert.match(text, /Pareti inclinate di 25°/); // cartoncino 300 g/m² predefinito
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
  await page.selectOption('#printer', 'none');
  await page.evaluate(() => { const r = document.getElementById('r'); r.value = '0.64'; r.dispatchEvent(new Event('change')); });
  await page.reload();
  await page.waitForFunction(() => document.getElementById('status').textContent.length > 0);
  assert.equal(await page.inputValue('#r'), '0.64');
  assert.equal(await page.inputValue('#printer'), 'none');
  assert.equal(await page.inputValue('#layer'), '0');
  await page.click('#reset');
  assert.equal(await page.inputValue('#r'), '0.48'); // cartoncino 300 g/m², layer 0,16
  assert.equal(await page.inputValue('#b'), '2');
  assert.equal(await page.inputValue('#printer'), 'a1');
  assert.equal(await page.inputValue('#nozzle'), '0.4');
  assert.equal(await page.inputValue('#material'), 'card300');
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

test('la pianta 2D mostra piastra e guide anche senza disegno, poi rilievo e cavità', async () => {
  const { page, context, status } = await openApp();
  await page.selectOption('#preset', 'custom');
  const classes = () => page.$$eval('#plan svg path', (ps) => ps.map((p) => p.getAttribute('class')));
  const pinPath = () => page.getAttribute('#plan path.pin', 'd');
  let list = await classes();
  for (const c of ['plate', 'safe', 'hole', 'pin']) assert.ok(list.includes(c), 'manca ' + c + ' senza disegno');
  assert.ok(!list.includes('relief'));
  const before = await pinPath();
  await page.evaluate(() => { const y = document.getElementById('pinY'); y.value = '-10'; y.dispatchEvent(new Event('change')); });
  assert.notEqual(await pinPath(), before, 'lo spostamento dei perni deve cambiare la pianta');
  await loadSvg(page, svg('<rect x="10" y="10" width="80" height="80"/>'));
  await waitStatus(page, DONE);
  assert.match(await status(), /superano il controllo/, await status());
  list = await classes();
  for (const c of ['plate', 'safe', 'relief', 'hole', 'flare', 'cavity', 'pin']) assert.ok(list.includes(c), 'manca ' + c);
  // Tacca disattivata e angoli vivi: la piastra diventa un rettangolo di 4 vertici per lato.
  for (const [id, v] of [['notchD', '0'], ['cornerR', '0']])
    await page.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change')); }, [id, v]);
  await waitStatus(page, DONE);
  const plate = await page.getAttribute('#plan path.plate', 'd');
  assert.equal(plate.split('Z').filter(Boolean).every((loop) => loop.split('L').length === 4), true, plate);
  await context.close();
});

test('anteprima del foglio goffrato e finestra 3D coerenti con il preset', async () => {
  const { page, context, status, errors } = await openApp();
  await page.selectOption('#preset', 'businessCard');
  // Senza disegno: foglio piatto del preset, già apribile.
  assert.match(await page.textContent('#sheetNote'), /Foglio 85 × 55 mm del preset/);
  await loadSvg(page, svg('<rect x="10" y="10" width="80" height="80"/><rect x="30" y="30" width="40" height="40" fill="white"/>'));
  await waitStatus(page, DONE);
  assert.match(await status(), /superano il controllo/, await status());
  assert.match(await page.textContent('#sheetNote'), /Foglio 85 × 55 mm del preset/);
  // L'anteprima ha le proporzioni del foglio e mostra ombre (non è uniforme).
  const info = await page.evaluate(() => {
    const c = document.getElementById('sheetPreview');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let min = 255, max = 0;
    for (let i = 0; i < d.length; i += 4) { min = Math.min(min, d[i]); max = Math.max(max, d[i]); }
    return { ratio: c.width / c.height, min, max };
  });
  assert.ok(Math.abs(info.ratio - 85 / 55) < 0.02, 'proporzioni ' + info.ratio);
  assert.ok(info.max - info.min > 40, 'anteprima senza ombre');
  assert.equal(await page.isDisabled('#sheet3d'), false);
  await page.click('#sheet3d');
  assert.equal(await page.evaluate(() => document.getElementById('sheetDialog').open), true);
  assert.match(await page.textContent('#sheetTitle'), /85 × 55 mm/);
  assert.equal(await page.locator('#sheetView canvas').count(), 1);
  await page.selectOption('#sheetExaggeration', '4');
  await page.click('#sheetFlip');
  await page.click('#sheetClose');
  assert.equal(await page.evaluate(() => document.getElementById('sheetDialog').open), false);
  assert.equal(await page.locator('#sheetView canvas').count(), 0);
  // Preset personalizzato: foglio pari all'ingombro del disegno più 5 mm per lato.
  await page.selectOption('#preset', 'custom');
  await waitStatus(page, /^Errore/); // disegno largo 85 mm su piastra alta 70: non entra
  assert.match(await page.textContent('#sheetNote'), /correggi l’errore/);
  await page.evaluate(() => { const aw = document.getElementById('aw'); aw.value = '50'; aw.dispatchEvent(new Event('change')); });
  await waitStatus(page, DONE);
  assert.match(await status(), /superano il controllo/, await status());
  assert.match(await page.textContent('#sheetNote'), /Foglio 60 × 60 mm \(ingombro del disegno più 5 mm per lato\)/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('preset J card: cartoncino, battute agli angoli inferiori, sedi e avvisi', async () => {
  const { page, context, status, errors } = await openApp();
  await page.selectOption('#preset', 'jCard');
  // Materiale iniziale della J card: cartoncino 250 g/m²; i suoi valori prevalgono sul profilo A1.
  assert.equal(await page.inputValue('#material'), 'card250');
  assert.equal(await page.inputValue('#paper'), '0.29');
  assert.equal(await page.inputValue('#lateral'), '0.39');
  assert.equal(await page.inputValue('#r'), '0.48');
  assert.equal(await page.inputValue('#draft'), '20');
  assert.equal(await page.inputValue('#stops'), 'bottom');
  assert.equal(await page.isDisabled('#stops'), false);
  // Battute visibili in pianta già prima del disegno.
  assert.equal(await page.locator('#plan path.stop').count(), 1);
  await loadSvg(page, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 62"><path fill-rule="evenodd" d="M5 5H95V57H5Z M10 10H90V52H10Z"/><circle cx="50" cy="31" r="12"/></svg>`);
  await waitStatus(page, DONE);
  const text = await status();
  assert.match(text, /superano il controllo/, text);
  assert.match(text, /Battute di riscontro agli angoli inferiori, alte 1\.12 mm, sedi sulla negativa profonde 1\.28 mm/, text);
  assert.match(await page.textContent('#sheetNote'), /Foglio 101\.6 × 63\.5 mm del preset/);
  assert.equal(await page.locator('#plan path.stop').count(), 1);
  assert.equal(await page.locator('#plan path.recess').count(), 1);
  // Quattro angoli: avviso sul dorso della J card.
  await page.selectOption('#stops', 'corners');
  await waitStatus(page, DONE);
  assert.match(await page.textContent('#warnings'), /dorso della J card urta le battute superiori/);
  // Nessuna battuta: niente sedi, campi disattivati.
  await page.selectOption('#stops', 'none');
  await waitStatus(page, DONE);
  assert.equal(await page.locator('#plan path.stop').count(), 0);
  assert.equal(await page.isDisabled('#stopW'), true);
  // Preset senza foglio: battute non disponibili.
  await page.selectOption('#preset', 'custom');
  assert.equal(await page.isDisabled('#stops'), true);
  assert.deepEqual(errors, []);
  await context.close();
});

test('materiale e ugello calcolano i valori di partenza; avviso sul rilievo troppo profondo', async () => {
  const { page, context, status } = await openApp();
  await page.selectOption('#preset', 'businessCard');
  const v = (id) => page.inputValue('#' + id);
  // Cartoncino 350 g/m² con ugello 0,8: layer 0,24, giochi più larghi, rilievo ≤ 1,5 × carta per difetto a multipli del layer.
  await page.selectOption('#nozzle', '0.8');
  await page.selectOption('#material', 'card350');
  assert.equal(await v('layer'), '0.24');
  assert.equal(await v('paper'), '0.4');
  assert.equal(await v('lateral'), '0.6');
  assert.equal(await v('r'), '0.48');
  assert.equal(await v('draft'), '25');
  assert.equal(await v('minFeature'), '1.68');
  assert.equal(await v('pg'), '0.25');
  // Carta sottile con ugello 0,4.
  await page.selectOption('#nozzle', '0.4');
  await page.selectOption('#material', 'paper120');
  assert.equal(await v('paper'), '0.14');
  assert.equal(await v('lateral'), '0.24');
  assert.equal(await v('r'), '0.16');
  assert.equal(await v('draft'), '15');
  // Spessore misurato: i valori seguono il campo.
  await page.selectOption('#material', 'measured');
  await page.evaluate(() => { const p = document.getElementById('paper'); p.value = '0.25'; p.dispatchEvent(new Event('change')); });
  assert.equal(await v('lateral'), '0.35');
  assert.equal(await v('r'), '0.32');
  // Rilievo esagerato a mano: avviso grinze.
  await loadSvg(page, svg('<rect x="10" y="10" width="80" height="80"/>'));
  await waitStatus(page, DONE);
  await page.evaluate(() => { const r = document.getElementById('r'); r.value = '0.8'; r.dispatchEvent(new Event('change')); });
  await waitStatus(page, DONE);
  assert.match(await status(), /superano il controllo/, await status());
  assert.match(await page.textContent('#warnings'), /volte lo spessore della carta: rischio di grinze/);
  await context.close();
});

test('preset personali: salva, ricarica dopo il riavvio, carica, esporta, importa, elimina', async () => {
  const { page, context } = await openApp();
  await page.selectOption('#preset', 'custom');
  const setValue = (id, value) => page.evaluate(([id, value]) => { const el = document.getElementById(id); el.value = value; el.dispatchEvent(new Event('change')); }, [id, value]);
  await setValue('sheetW', '90');
  await setValue('sheetH', '50');
  await page.selectOption('#nozzle', '0.8');
  await page.selectOption('#stops', 'corners');
  await page.fill('#myPresetName', 'Cartolina 0,8');
  await page.click('#savePreset');
  assert.match(await page.textContent('#myPresetsNote'), /salvato/);
  // Il foglio personalizzato abilita battute e anteprima del foglio.
  assert.match(await page.textContent('#sheetNote'), /Foglio 90 × 50 mm/);
  // Cambio impostazioni e ricarico la pagina: il preset c'è ancora e si ricarica.
  await page.selectOption('#preset', 'businessCard');
  await page.selectOption('#nozzle', '0.4');
  await page.reload();
  await page.waitForFunction(() => document.getElementById('status').textContent.length > 0);
  assert.deepEqual(await page.$$eval('#myPresets option', (o) => o.map((x) => x.value)), ['Cartolina 0,8']);
  await page.click('#loadPreset');
  assert.equal(await page.inputValue('#preset'), 'custom');
  assert.equal(await page.inputValue('#nozzle'), '0.8');
  assert.equal(await page.inputValue('#sheetW'), '90');
  assert.equal(await page.inputValue('#stops'), 'corners');
  // Esporta, elimina, reimporta.
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#exportPresets')]);
  const file = await download.path();
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(json.presets['Cartolina 0,8'].values);
  await page.click('#deletePreset');
  assert.equal(await page.locator('#myPresets option').count(), 0);
  assert.equal(await page.isDisabled('#loadPreset'), true);
  await page.setInputFiles('#importPresets', file);
  await page.waitForFunction(() => /importati/.test(document.getElementById('myPresetsNote').textContent));
  assert.equal(await page.locator('#myPresets option').count(), 1);
  // Un file non valido viene rifiutato senza toccare i preset.
  await page.setInputFiles('#importPresets', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"foo":1}') });
  await page.waitForFunction(() => /non riuscita/.test(document.getElementById('myPresetsNote').textContent));
  assert.equal(await page.locator('#myPresets option').count(), 1);
  await context.close();
});

test('valori negativi solo per lo spostamento verticale dei perni', async () => {
  const { page, context, status } = await openApp();
  await page.evaluate(() => { const el = document.getElementById('pinInset'); el.value = '-3'; el.dispatchEvent(new Event('change')); });
  assert.match(await status(), /«Distanza centro perni dal bordo laterale \[mm\]» non può essere negativo/);
  await page.evaluate(() => { const el = document.getElementById('pinInset'); el.value = '7'; el.dispatchEvent(new Event('change')); });
  await page.evaluate(() => { const el = document.getElementById('pinY'); el.value = '-5'; el.dispatchEvent(new Event('change')); });
  assert.doesNotMatch(await status(), /Errore/);
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

// Corpi chiusi in un STL binario: ogni spigolo orientato compare una volta, insieme al suo opposto.
function stlShells(data) {
  const n = data.readUInt32LE(80),
    key = (o) => [0, 4, 8].map((k) => Math.round(data.readFloatLE(o + k) * 1000)).join(','),
    edges = new Map(),
    parent = new Map(),
    zs = [],
    xs = [],
    ys = [];
  const find = (x) => {
    while (parent.get(x) !== x) x = parent.get(x);
    return x;
  };
  for (let i = 0; i < n; i++) {
    const v = [0, 1, 2].map((j) => key(84 + i * 50 + 12 + j * 12));
    for (let j = 0; j < 3; j++) {
      const o = 84 + i * 50 + 12 + j * 12;
      xs.push(data.readFloatLE(o));
      ys.push(data.readFloatLE(o + 4));
      zs.push(data.readFloatLE(o + 8));
      if (!parent.has(v[j])) parent.set(v[j], v[j]);
      const e = v[j] + '>' + v[(j + 1) % 3];
      edges.set(e, (edges.get(e) || 0) + 1);
    }
    parent.set(find(v[1]), find(v[0]));
    parent.set(find(v[2]), find(v[0]));
  }
  let open = 0;
  for (const [e, c] of edges) {
    const [a, b] = e.split('>');
    if (c !== 1 || edges.get(b + '>' + a) !== 1) open++;
  }
  const shells = new Set([...parent.keys()].map(find)).size;
  const range = (a) => [Math.min(...a), Math.max(...a)];
  return { open, shells, x: range(xs), y: range(ys), z: range(zs) };
}

test('cerniera print-in-place: un solo STL con due corpi chiusi, nessun perno, piega in anteprima', async () => {
  const { page, context, errors, status } = await openApp();
  await page.selectOption('#preset', 'businessCard');
  await waitStatus(page, /carica un SVG/);
  await page.selectOption('#hinge', 'bottom');
  assert.equal(await page.isHidden('#male'), true);
  assert.equal(await page.isVisible('#hingeStl'), true);
  assert.equal(await page.isDisabled('#pin'), true);
  assert.equal(await page.isDisabled('#mirror'), true);
  await loadSvg(page, svg('<circle cx="30" cy="30" r="20"/><path fill-rule="evenodd" d="M60 10h30v40h-30z M68 18v24h14v-24z"/>'));
  await waitStatus(page, DONE);
  const text = await status();
  assert.match(text, /cerniera print-in-place sul lato inferiore: \d+ nodi/, text);
  assert.match(text, /nessuna interferenza da 0° a 180°/);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#hingeStl')]);
  assert.equal(download.suggestedFilename(), 'embosser_cerniera.stl');
  const info = stlShells(fs.readFileSync(await download.path()));
  assert.equal(info.open, 0, 'STL chiuso');
  assert.equal(info.shells, 2, 'positiva e negativa sono due corpi separati');
  assert.ok(Math.abs(info.z[0]) < 1e-3, 'appoggiato sul piano');
  // Spessore del pacchetto chiuso = 2 × quota dell'asse: la cerniera non deve superarlo.
  const zh = Number(text.match(/asse a ([\d,]+) mm/)[1].replace(',', '.'));
  assert.ok(info.z[1] <= 2 * zh + 0.011, `cerniera più alta del pacchetto chiuso: ${info.z[1]} > ${2 * zh}`);
  assert.ok(info.x[1] - info.x[0] <= 256 && info.y[1] - info.y[0] <= 256, 'entra nel piano A1');
  assert.ok(info.y[1] - info.y[0] > 2 * 70, 'piastre una sopra l’altra');
  const [d3mf] = await Promise.all([page.waitForEvent('download'), page.click('#both')]);
  assert.equal(d3mf.suggestedFilename(), 'embosser_cerniera.3mf');
  const model = unzipStored(fs.readFileSync(await d3mf.path()))['3D/3dmodel.model'].toString('utf8');
  assert.deepEqual([...model.matchAll(/<object id="\d+" name="([^"]+)"/g)].map((m) => m[1]), ['Piastre con cerniera']);
  await page.$eval('#fold', (e) => {
    e.value = 180;
    e.dispatchEvent(new Event('input'));
  });
  assert.equal(await page.textContent('#foldValue'), '180°');
  // Sul lato destro le piastre affiancate non entrano nel piano dell'A1: errore chiaro.
  await page.selectOption('#hinge', 'right');
  await waitStatus(page, DONE);
  assert.match(await status(), /oltre il piano di stampa.*lato inferiore/, await status());
  // Tornando ai perni ricompaiono i due export separati.
  await page.selectOption('#hinge', 'pins');
  await waitStatus(page, /superano il controllo/);
  assert.equal(await page.isVisible('#male'), true);
  assert.equal(await page.isDisabled('#mirror'), false);
  assert.deepEqual(errors, []);
  await context.close();
});
