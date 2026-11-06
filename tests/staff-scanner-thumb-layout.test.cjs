'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'staff', 'index.html'), 'utf8');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function between(start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `missing Staff source segment: ${start}`);
  return source.slice(a, b);
}

const overlay = between('<div id="staff-scan-overlay"', '<script src="../barinv-public-config.js"');
const css = between('<style>', '</style>').replace(/@import[^;]+;/g, '');

test('one scanner, one Next handler, and thumb controls follow the camera', () => {
  for (const id of ['staff-scan-overlay', 'staff-scan-reader', 'staff-scan-next-button', 'staff-scan-camera-button']) {
    assert.equal((overlay.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, id);
  }
  assert.equal((overlay.match(/onclick="staffScannerNextCameraScan\(\)"/g) || []).length, 1);
  assert.equal((source.match(/function staffScannerNextCameraScan\(\)/g) || []).length, 1);
  assert.match(css, /\.staff-scan-button-row\s*\{[^}]*safe-area-inset-bottom/,
    'bottom controls must account for the iPhone safe area');
  assert.ok(overlay.indexOf('id="staff-scan-reader"') < overlay.indexOf('id="staff-scan-next-button"'),
    'NEXT SCAN must follow the camera in DOM order');
});

test('Next control has a stable slot and is enabled only after an accepted camera scan', () => {
  const fn = between('function staffScannerRender() {', 'function staffScannerFocusExistingAction(');
  const ids = new Map();
  const get = id => {
    if (!ids.has(id)) ids.set(id, {
      id, disabled: false, style: {}, classList: { toggle() {} },
      setAttribute(name, value) { this[name] = value; }
    });
    return ids.get(id);
  };
  const state = {
    active: true, modalVisible: true, mode: 'taking', actionMode: 'FAST_ONE',
    cameraRunning: true, cameraScanGate: 'ARMED', feedback: 'READY',
    feedbackTone: '', result: null, summary: {}
  };
  const context = {
    STAFF_SCANNER: state, document: { getElementById: get }, Object,
    staffScannerResultMarkup: () => '', staffScanDebugRender: () => {}
  };
  vm.runInNewContext(`${fn}\nthis.render = staffScannerRender;`, context);
  context.render();
  const next = get('staff-scan-next-button');
  assert.equal(next.disabled, true);
  assert.equal(next['aria-disabled'], 'true');
  state.cameraScanGate = 'LOCKED_AFTER_ACCEPT';
  context.render();
  assert.equal(next.disabled, false);
  assert.equal(next['aria-disabled'], 'false');
  state.cameraRunning = false;
  context.render();
  assert.equal(next.disabled, true);
  assert.equal(next['aria-disabled'], 'true');
  assert.notEqual(next.style.display, 'none', 'reserve the control slot to prevent camera jump');
});

test('Next Scan only rearms a locked active scanner; it does not restart the camera', () => {
  const fn = between('function staffScannerNextCameraScan() {', 'function staffScannerResultMarkup(');
  const state = {
    active: true, cameraRunning: true, cameraScanGate: 'LOCKED_AFTER_ACCEPT',
    camera: { stream: 'same-stream' }, lockedCallbackCount: 7,
    lastCameraCode: 'masked', lastCameraAt: 42
  };
  let resets = 0;
  let renders = 0;
  const context = {
    STAFF_SCANNER: state,
    staffScannerSetCameraGate: value => { state.cameraScanGate = value; },
    staffCameraPresenceReset: () => { resets++; },
    staffScannerRender: () => { renders++; }
  };
  vm.runInNewContext(`${fn}\nthis.next = staffScannerNextCameraScan;`, context);
  assert.equal(context.next(), true);
  assert.equal(state.cameraScanGate, 'ARMED');
  assert.equal(state.cameraRunning, true);
  assert.equal(state.camera.stream, 'same-stream');
  assert.equal(state.lockedCallbackCount, 0);
  assert.equal(resets, 1);
  assert.equal(renders, 1);
  assert.equal(context.next(), false);
  state.active = false;
  state.cameraScanGate = 'LOCKED_AFTER_ACCEPT';
  assert.equal(context.next(), false);
  assert.equal(resets, 1);
});

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    }).on('error', reject);
  });
}

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function chromeSession() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'barinv-scanner-thumb-'));
  const port = await freePort();
  const child = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--remote-allow-origins=*',
    `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, 'about:blank'
  ], { stdio: 'ignore' });
  try {
    let target;
    for (let i = 0; i < 80; i++) {
      try {
        target = (await getJson(`http://127.0.0.1:${port}/json/list`)).find(tab => tab.type === 'page');
        if (target) break;
      } catch { /* Chrome is starting. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(target?.webSocketDebuggerUrl, 'local Chrome DevTools page did not start');
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    let nextId = 0;
    const pending = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (!message.id || !pending.has(message.id)) return;
      const pair = pending.get(message.id);
      pending.delete(message.id);
      message.error ? pair.reject(new Error(message.error.message)) : pair.resolve(message.result);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
    return {
      send,
      async close() {
        socket.close();
        child.kill();
        if (child.exitCode === null) await Promise.race([
          new Promise(resolve => child.once('exit', resolve)),
          new Promise(resolve => setTimeout(resolve, 1500))
        ]);
        fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    };
  } catch (error) {
    child.kill();
    fs.rmSync(profile, { recursive: true, force: true });
    throw error;
  }
}

function geometryExpression(nextEnabled) {
  return `(() => {
    const next = document.getElementById('staff-scan-next-button');
    next.disabled = ${nextEnabled ? 'false' : 'true'};
    next.setAttribute('aria-disabled', next.disabled ? 'true' : 'false');
    const reader = document.getElementById('staff-scan-reader');
    const panel = document.querySelector('.staff-scan-panel');
    const r = element => { const b=element.getBoundingClientRect(); return {x:b.x,y:b.y,width:b.width,height:b.height,top:b.top,bottom:b.bottom,right:b.right}; };
    return {width:innerWidth,height:innerHeight,reader:r(reader),next:r(next),panel:r(panel),
      documentWidth:document.documentElement.scrollWidth,
      readerVisible:Math.max(0,Math.min(r(reader).bottom,innerHeight)-Math.max(r(reader).top,0))};
  })()`;
}

function browserFixture(inputSource) {
  const a = inputSource.indexOf('<style>');
  const b = inputSource.indexOf('</style>', a);
  const c = inputSource.indexOf('<div id="staff-scan-overlay"');
  const d = inputSource.indexOf('<script src="../barinv-public-config.js"', c);
  assert.ok(a >= 0 && b > a && c >= 0 && d > c);
  const style = inputSource.slice(a + 7, b).replace(/@import[^;]+;/g, '');
  const modal = inputSource.slice(c, d);
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${style}\n#staff-dashboard{display:block!important}.mock-camera{height:190px;background:#333}</style><div id="staff-dashboard">${modal}</div><script>document.getElementById('staff-scan-overlay').classList.add('is-open');document.getElementById('staff-scan-reader').innerHTML='<div class="mock-camera"></div>';</script>`;
}

test('iPhone scanner camera stays stable and Next Scan remains in the thumb zone',
  { skip: !fs.existsSync(chromePath) ? 'local Chrome unavailable' : false, timeout: 30000 }, async t => {
    const browser = await chromeSession();
    try {
      const fixture = browserFixture(source);
      for (const [width, height] of [[320, 568], [390, 844], [844, 390]]) {
        await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
        await browser.send('Page.navigate', { url: `data:text/html;base64,${Buffer.from(fixture).toString('base64')}` });
        let ready = false;
        for (let i = 0; i < 40; i++) {
          const probe = await browser.send('Runtime.evaluate', { expression: '!!document.getElementById("staff-scan-reader")', returnByValue: true });
          if (probe.result?.value) { ready = true; break; }
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        assert.ok(ready, 'scanner fixture did not load');
        const evaluate = async expression => {
          const value = await browser.send('Runtime.evaluate', { expression, returnByValue: true });
          if (value.exceptionDetails) throw new Error(value.exceptionDetails.text);
          return value.result.value;
        };
        const before = await evaluate(geometryExpression(false));
        const after = await evaluate(geometryExpression(true));
        t.diagnostic(`${width}x${height} reader=${JSON.stringify(after.reader)} next=${JSON.stringify(after.next)} panel=${JSON.stringify(after.panel)} visible=${after.readerVisible}`);
        assert.equal(after.width, width, 'device width must be emulated exactly');
        assert.equal(after.documentWidth, width, `${width}px: no horizontal overflow`);
        assert.ok(Math.abs(after.reader.top - before.reader.top) <= 1, `${width}px: camera top moved when Next appeared`);
        assert.ok(Math.abs(after.reader.height - before.reader.height) <= 1, `${width}px: camera height changed when Next appeared`);
        assert.ok(after.readerVisible >= 130, `${width}px: too little camera remains visible`);
        assert.ok(after.next.width >= 44 && after.next.height >= 44, `${width}px: Next touch target too small`);
        assert.ok(after.next.top >= after.reader.bottom - 1, `${width}px: Next overlaps the camera`);
        assert.ok(after.next.bottom <= height - 8, `${width}px: Next intrudes into the bottom edge`);
        assert.ok(after.next.bottom >= height - 190, `${width}px: Next is not in the lower thumb zone`);
        assert.ok(after.panel.right <= width + 1, `${width}px: panel clips horizontally`);
      }
    } finally {
      await browser.close();
    }
  });

test('optional matching-viewport before/after synthetic previews',
  { skip: process.env.BARINV_SCANNER_SCREENSHOTS !== '1' ? 'set BARINV_SCANNER_SCREENSHOTS=1 to capture' : false, timeout: 30000 }, async t => {
    const baseline = execFileSync('git', ['show', '325dbc29fc099bcdd32c27e597c97f5fb97c8a0d:staff/index.html'],
      { cwd: path.join(__dirname, '..'), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    const browser = await chromeSession();
    const out = path.join(__dirname, '..', 'evidence');
    fs.mkdirSync(out, { recursive: true });
    try {
      await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      for (const [label, inputSource] of [['before-325dbc29', baseline], ['after-candidate', source]]) {
        const fixture = browserFixture(inputSource);
        await browser.send('Page.navigate', { url: `data:text/html;base64,${Buffer.from(fixture).toString('base64')}` });
        for (let i = 0; i < 40; i++) {
          const probe = await browser.send('Runtime.evaluate', { expression: '!!document.getElementById("staff-scan-reader")', returnByValue: true });
          if (probe.result?.value) break;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        const result = await browser.send('Runtime.evaluate', {
          expression: `(() => { const next=document.getElementById('staff-scan-next-button'); next.style.display=''; next.disabled=false; next.setAttribute('aria-disabled','false'); return ${geometryExpression(true)}; })()`,
          returnByValue: true
        });
        assert.ok(result.result?.value, `${label} geometry unavailable`);
        const capture = await browser.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
        const dest = path.join(out, `staff-scanner-thumb-390x844-${label}.png`);
        fs.writeFileSync(dest, Buffer.from(capture.data, 'base64'));
        t.diagnostic(`${label}: ${dest}; reader=${JSON.stringify(result.result.value.reader)}; Next=${JSON.stringify(result.result.value.next)}`);
      }
    } finally {
      await browser.close();
    }
  });
