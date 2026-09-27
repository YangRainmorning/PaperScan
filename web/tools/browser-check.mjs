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

const rotateIndex = process.argv.indexOf('--rotate');
const rotations = rotateIndex >= 0 ? Number(process.argv[rotateIndex + 1] ?? 1) : 0;
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
  let sawWorking = false;

  while (Date.now() < deadline) {
    const state = await readState();
    if (state.working) sawWorking = true;
    if (state.failed) throw new Error(`the page reported an error: ${state.errorText}`);
    if (state.result && (!sawWorking || state.blob !== previousBlob)) return state;
    await new Promise((resolve) => setTimeout(resolve, 300));
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

for (let i = 0; i < rotations; i++) {
  const previous = state;
  const roundStarted = Date.now();
  await evaluate(`document.getElementById('rotate').click()`);
  await new Promise((resolve) => setTimeout(resolve, 600));
  state = await waitForResult(previous.blob);
  timeline.push({ step: `after rotate ${i + 1}`, size: state.size, ms: Date.now() - roundStarted });
}

const stats = await evaluate(`(() => {
  const out = {};
  const list = document.getElementById('stats');
  const dts = [...list.querySelectorAll('dt')].map(n => n.textContent);
  const dds = [...list.querySelectorAll('dd')].map(n => n.textContent);
  dts.forEach((k, i) => { out[k] = dds[i]; });
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
