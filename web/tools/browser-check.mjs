/**
 * End-to-end smoke test for the web app, with no test-runner dependency beyond Node itself.
 *
 * It talks to a real Chrome over the DevTools Protocol, hands the file input a photo
 * directly (so no OS file dialog is involved), waits for the result card, collects console
 * errors, and writes a screenshot plus a JSON report.
 *
 *   node tools/browser-check.mjs <url> <photo> <outPrefix> [--rotate N]
 *
 * Start the pieces first:
 *
 *   npm run build && npm run preview &
 *   chrome --headless=new --remote-debugging-port=9222 \
 *          --user-data-dir=/tmp/ps-profile about:blank &
 *
 * Exit code is 0 only when the page reaches the result state after every rotation.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const [url, photo, outPrefix] = process.argv.slice(2);
if (!url || !photo || !outPrefix) {
  console.error('usage: node tools/browser-check.mjs <url> <photo> <outPrefix> [--rotate N]');
  process.exit(2);
}

const orientIndex = process.argv.indexOf('--orient');
const orientation = orientIndex >= 0 ? Number(process.argv[orientIndex + 1] ?? 0) : -1;

// --drag "cornerIndex:x,y" drags one corner handle to that fraction of the photo overlay.
const dragIndex = process.argv.indexOf('--drag');
const dragSpec = dragIndex >= 0 ? process.argv[dragIndex + 1] : null;
const endpoint = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9222';
const timeoutMs = Number(process.env.CDP_TIMEOUT_MS ?? 300_000);

/* ------------------------------------------------------------------ connection */

async function findPageSocket() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const targets = await (await fetch(`${endpoint}/json/list`)).json();
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* Chrome is not listening yet. */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No page target on ${endpoint}. Is Chrome running with --remote-debugging-port?`);
}

const socket = new WebSocket(await findPageSocket());
const pending = new Map();
const consoleMessages = [];
const exceptions = [];
let nextId = 1;

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);

  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result);
    return;
  }

  if (message.method === 'Runtime.consoleAPICalled') {
    consoleMessages.push({
      type: message.params.type,
      text: message.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '),
    });
  }
  if (message.method === 'Runtime.exceptionThrown') {
    exceptions.push(message.params.exceptionDetails.exception?.description ?? 'exception');
  }
});

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

await send('Runtime.enable');
await send('Page.enable');

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true });
  return result.result.value;
}

/* ----------------------------------------------------------------------- probe */

const readState = () =>
  evaluate(`(() => {
    const dds = [...document.getElementById('stats').querySelectorAll('dd')].map(n => n.textContent);
    return {
      result: !document.getElementById('result').hidden,
      working: !document.getElementById('working').hidden,
      failed: !document.getElementById('error').hidden,
      errorText: document.getElementById('errorText').textContent,
      stage: document.getElementById('stage').textContent,
      size: dds[0] || '',
      blob: document.getElementById('afterImg').src,
      downloadName: document.getElementById('download').getAttribute('download'),
    };
  })()`);

async function waitForResult(previousBlob) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const state = await readState();
    if (state.failed) throw new Error(`the page reported an error: ${state.errorText}`);
    // Wait for the result blob to actually be replaced. The orientation picker re-encodes
    // without ever showing the working card, so "did we see a spinner" is not a usable
    // signal here.
    if (state.result && state.blob !== previousBlob) return state;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error('timed out waiting for the result card');
}

/* ------------------------------------------------------------------------ run */

await send('Page.navigate', { url });
await new Promise((resolve) => setTimeout(resolve, 2500));

const documentNode = await send('DOM.getDocument', { depth: 1 });
const input = await send('DOM.querySelector', {
  nodeId: documentNode.root.nodeId,
  selector: '#file',
});
if (!input.nodeId) throw new Error('the page has no #file input');

const started = Date.now();
await send('DOM.setFileInputFiles', { files: [photo], nodeId: input.nodeId });

let state = await waitForResult('');
const timeline = [{ step: 'as uploaded', size: state.size, ms: Date.now() - started }];

if (dragSpec) {
  for (const spec of dragSpec.split(';')) {
    if (!spec.trim()) continue;
    const [indexPart, fracPart] = spec.split(':');
    const corner = Number(indexPart);
    const [fx, fy] = fracPart.split(',').map(Number);

    // DispatchMouseEvent works in viewport coordinates, so the overlay has to be on screen.
    await evaluate(`document.getElementById('overlay').scrollIntoView({ block: 'center' })`);
    await new Promise((resolve) => setTimeout(resolve, 350));

    const geometry = await evaluate(`(() => {
      const hook = window.__paperscanDebug;
      const quad = hook.quad();
      const source = hook.source();
      const rect = document.getElementById('overlay').getBoundingClientRect();
      const i = ${corner} * 2;
      return {
        fromX: rect.left + (quad[i] / source.width) * rect.width,
        fromY: rect.top + (quad[i + 1] / source.height) * rect.height,
        toX: rect.left + ${fx} * rect.width,
        toY: rect.top + ${fy} * rect.height,
        rect: [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)],
        quad: quad.map((n) => Math.round(n)),
      };
    })()`);
    console.error(`  drag corner ${corner}: rect ${geometry.rect.join(',')} quad ${geometry.quad.join(',')}`);
    const before = await evaluate(`window.__paperscanDebug.pointerEvents()`);
    const roundStarted = Date.now();
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: geometry.fromX,
      y: geometry.fromY,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });

    for (let step = 1; step <= 8; step++) {
      const ratio = step / 8;
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: geometry.fromX + (geometry.toX - geometry.fromX) * ratio,
        y: geometry.fromY + (geometry.toY - geometry.fromY) * ratio,
        button: 'left',
        buttons: 1,
      });
      await new Promise((resolve) => setTimeout(resolve, 60));
    }

    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: geometry.toX,
      y: geometry.toY,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });

    const after = await evaluate(`window.__paperscanDebug.pointerEvents()`);
    const debug = await evaluate(`(() => {
      const h = window.__paperscanDebug;
      return { pointerEvents: h.pointerEvents(), drags: h.dragsStarted(), scans: h.scansStarted(), busy: h.busy() };
    })()`);
    console.error(
      `  pointerdown delivered ${after - before}; drags=${debug.drags} scans=${debug.scans} busy=${debug.busy}`,
    );
    if (after === before) {
      throw new Error('the drag never reached the overlay canvas');
    }

    state = await waitForResult(state.blob);
    timeline.push({ step: `dragged corner ${corner}`, size: state.size, ms: Date.now() - roundStarted });
  }
}

if (orientation >= 0) {
  const previous = state;
  const roundStarted = Date.now();
  const picked = await evaluate(`(() => {
    const options = document.querySelectorAll('.orient-option');
    if (options.length < 4) return 'only ' + options.length + ' orientation options rendered';
    options[${orientation}].click();
    return 'ok';
  })()`);
  if (picked !== 'ok') throw new Error(picked);
  await new Promise((resolve) => setTimeout(resolve, 600));
  state = await waitForResult(previous.blob);
  timeline.push({ step: `orientation ${orientation}`, size: state.size, ms: Date.now() - roundStarted });
}

// Let the last re-encode finish before reading the stats off the page.
await new Promise((resolve) => setTimeout(resolve, 700));

if (process.argv.includes('--detection')) {
  await evaluate(`(() => {
    const box = document.getElementById('showDetection');
    if (box) { box.checked = true; box.dispatchEvent(new Event('change')); }
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 600));
}

const stats = await evaluate(`(() => {
  const out = {};
  const list = document.getElementById('stats');
  const dts = [...list.querySelectorAll('dt')].map(n => n.textContent);
  const dds = [...list.querySelectorAll('dd')].map(n => n.textContent);
  dts.forEach((k, i) => { out[k] = dds[i]; });
  out['orientation options'] = String(document.querySelectorAll('.orient-option').length);
  out['selected orientation'] = String([...document.querySelectorAll('.orient-option')]
    .findIndex(n => n.getAttribute('aria-checked') === 'true'));
  return out;
})()`);

// Let the result <img> decode the blob before capturing.
await new Promise((resolve) => setTimeout(resolve, 900));
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });

mkdirSync(dirname(outPrefix), { recursive: true });
writeFileSync(`${outPrefix}.png`, Buffer.from(shot.data, 'base64'));

const report = {
  ok: exceptions.length === 0,
  timeline,
  stats,
  downloadName: state.downloadName,
  exceptions,
  consoleMessages,
};
writeFileSync(`${outPrefix}.json`, JSON.stringify(report, null, 2));

console.log(JSON.stringify(report, null, 2));

socket.close();
process.exit(report.ok ? 0 : 1);
