'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'bridge.js'), 'utf8');
const TOKEN = 'a'.repeat(64);
const FEED = 'https://f1tv.formula1.com/2.0/R/ENG/WEB_DASH/ALL/MENU/PRO/2';
const PROXY_PREFIX = 'http://127.0.0.1:18741/f1tv.formula1.com/';

// Loads bridge.js as a webOS 22 page would, with a fake clock, a fake Luna
// bus (start calls stay pending until the test answers them) and a fetch that
// records the URL each F1 request was finally sent to.
function loadBridge() {
  let now = 1000000;
  let timers = [];
  const starts = [];
  const sent = [];
  class PalmServiceBridge {
    call(uri) {
      if (uri.endsWith('/start')) starts.push((payload) => this.onservicecallback(JSON.stringify(payload)));
    }
  }
  const window = {
    PalmServiceBridge,
    fetch: (url) => { sent.push(String(url)); return Promise.resolve({ ok: true }); },
    addEventListener() {},
  };
  const context = vm.createContext({
    window,
    navigator: { userAgent: 'Mozilla/5.0 (Web0S; Linux/SmartTV) Chrome/87.0.4280.88 Safari/537.36' },
    document: { addEventListener() {} },
    URL,
    Promise,
    Date: { now: () => now },
    setTimeout: (fn, ms) => { timers.push({ at: now + ms, fn }); },
  });
  vm.runInContext(SOURCE, context);

  const flush = () => new Promise((resolve) => setImmediate(resolve));
  return {
    starts,
    sent,
    fetch: (url) => window.fetch(url),
    async advance(ms) {
      now += ms;
      const due = timers.filter((t) => t.at <= now);
      timers = timers.filter((t) => t.at > now);
      due.forEach((t) => t.fn());
      await flush();
    },
    async answerStart(index, payload) { starts[index](payload); await flush(); },
    flush,
  };
}

const OK = { started: true, listening: true, port: 18741, token: TOKEN };
const FAILED = { returnValue: false, errorText: 'Service does not exist' };

test('slow cold start: F1 requests wait for the service instead of going direct', async () => {
  const tv = loadBridge();
  const request = tv.fetch(FEED);
  await tv.advance(8000); // longer than the old 4 s timeout
  await tv.answerStart(0, OK);
  await request;
  assert.equal(tv.starts.length, 1);
  assert.ok(tv.sent[0].startsWith(PROXY_PREFIX), tv.sent[0]);
  assert.ok(tv.sent[0].includes('__rwv_session=' + TOKEN));
});

test('a start that answers after the wait still switches the proxy on', async () => {
  const tv = loadBridge();
  const first = tv.fetch(FEED);
  await tv.advance(20000);
  await first;
  assert.equal(tv.sent[0], FEED); // gave up waiting, went direct

  await tv.answerStart(0, OK); // late answer
  await tv.fetch(FEED); // "Try again"
  assert.equal(tv.starts.length, 1, 'no second start while the first was pending');
  assert.ok(tv.sent[1].startsWith(PROXY_PREFIX), tv.sent[1]);
});

test('requests made after the deadline do not wait again for the same start', async () => {
  const tv = loadBridge();
  await tv.advance(25000);
  await tv.fetch(FEED);
  assert.equal(tv.sent[0], FEED);
  assert.equal(tv.starts.length, 1);
});

test('a failed start is retried by a later request (after a short cooldown)', async () => {
  const tv = loadBridge();
  await tv.answerStart(0, FAILED);
  await tv.fetch(FEED);
  assert.equal(tv.sent[0], FEED);
  assert.equal(tv.starts.length, 1, 'no immediate retry storm');

  await tv.advance(3000);
  const retry = tv.fetch(FEED);
  await tv.flush();
  assert.equal(tv.starts.length, 2, 'retried the start');
  await tv.answerStart(1, OK);
  await retry;
  assert.ok(tv.sent[1].startsWith(PROXY_PREFIX), tv.sent[1]);
});

test('requests waiting on a start that fails fall back to direct at once', async () => {
  const tv = loadBridge();
  const request = tv.fetch(FEED);
  await tv.answerStart(0, FAILED);
  await request;
  assert.equal(tv.sent[0], FEED);
});

test('non-F1 requests are never delayed', async () => {
  const tv = loadBridge();
  await tv.fetch('https://example.com/a.json');
  assert.deepEqual(tv.sent, ['https://example.com/a.json']);
});
