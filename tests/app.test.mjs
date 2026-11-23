// Test end-to-end: apre index.html in Chromium e verifica avvio, test integrato,
// importazione SVG, messaggi d'errore ed export STL.
// Le dipendenze CDN vengono servite da node_modules (stesse versioni pinnate),
// così i test non dipendono dalla rete.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appUrl = pathToFileURL(path.join(root, 'index.html')).href;
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

// Ogni script CDN in index.html deve corrispondere a un file della stessa versione in node_modules.
const cdn = /https:\/\/cdn\.jsdelivr\.net\/npm\/((?:@[^/]+\/)?[^@/]+)@([^/]+)\/([^"]+)/g;
function localFile(url) {
  const [, name, version, file] = url.match(new RegExp(cdn.source)) ?? [];
  if (!name) return null;
  const pkgDir = path.join(root, 'node_modules', name);
  const installed = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).version;
  assert.equal(installed, version, `${name}: index.html usa ${version}, node_modules ha ${installed}`);
  return path.join(pkgDir, file);
}

async function openApp() {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith('file:')) return route.continue();
    const file = localFile(url);
    if (!file) return route.abort();
    return route.fulfill({ path: file, contentType: 'application/javascript' });
  });
  await page.goto(appUrl);
  await page.waitForFunction(() => !/^Carica un SVG/.test(document.getElementById('status').textContent));
  return { page, errors, status: () => page.textContent('#status') };
}

async function loadSvg(page, svg) {
  const before = await page.textContent('#status');
  await page.setInputFiles('#file', { name: 'test.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) });
  await page.waitForFunction(prev => document.getElementById('status').textContent !== prev, before);
}

const svg = body => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`;

test('le dipendenze CDN hanno versioni esatte', () => {
  const urls = [...html.matchAll(cdn)].map(m => m[0]);
  assert.ok(urls.length >= 4, 'attesi almeno 4 script CDN');
  for (const url of urls) assert.ok(fs.existsSync(localFile(url)), `file mancante per ${url}`);
});

test('avvio senza errori e revisione mostrata', async () => {
  const { page, errors, status } = await openApp();
  const revision = html.match(/Revisione: ([\w-]+)/)[1];
  assert.match(await status(), new RegExp(revision));
  assert.deepEqual(errors, []);
  await page.close();
});

test('il test integrato passa', async () => {
  const { page, errors, status } = await openApp();
  await page.click('#test');
  const text = await status();
  assert.match(text, /^Test superato: \d+ mesh controllate/, text);
  assert.deepEqual(errors, []);
  await page.close();
});

test('esporta STL binari validi per positiva e negativa', async () => {
  const { page, status } = await openApp();
  await loadSvg(page, svg('<path fill-rule="evenodd" d="M0 0H100V100H0Z M20 20H80V80H20Z"/>'));
  assert.match(await status(), /entrambe le mesh superano il controllo/, await status());
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
  await page.close();
});

test('rifiuta SVG senza aree riempite e blocca l’export', async () => {
  const { page, status } = await openApp();
  await loadSvg(page, svg('<circle cx="50" cy="50" r="40" fill="none" stroke="black"/>'));
  assert.match(await status(), /Nessuna area riempita valida/);
  assert.equal(await page.isDisabled('#male'), true);
  assert.equal(await page.isDisabled('#female'), true);
  await page.close();
});

test('i messaggi d’errore usano il nome del campo', async () => {
  const { page, status } = await openApp();
  await page.evaluate(() => { const w = document.getElementById('w'); w.value = ''; w.dispatchEvent(new Event('change')); });
  assert.match(await status(), /«Larghezza piastra \[mm\]»/);
  assert.equal(await page.getAttribute('#w', 'aria-invalid'), 'true');
  await page.evaluate(() => { const w = document.getElementById('w'); w.value = '10'; w.dispatchEvent(new Event('change')); });
  assert.match(await status(), /almeno 24 mm/);
  await page.evaluate(() => { const w = document.getElementById('w'); w.value = '130'; w.dispatchEvent(new Event('change')); });
  assert.equal(await page.getAttribute('#w', 'aria-invalid'), null);
  await page.close();
});
