// The browser end of the stream, driven against the real archivist.html in jsdom.
//
// The behaviour that most needs guarding here is the RETRY RULE. Before
// streaming, a failed request had shown the reader nothing, so retrying blindly
// was safe and was what the front end did. Under streaming a retry after text
// has appeared would print the answer twice. The rule is now: retry only if
// nothing has been shown; if Alf has already started speaking, keep the partial
// answer and label it honestly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sseFrames } from './fixtures.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HTML = fs.readFileSync(path.join(HERE, '..', 'archivist.html'), 'utf8');

// Server-sent events as archivist.mjs emits them (its own envelope, not the
// Anthropic one).
const ev = objs => sseFrames(objs);

function streamResponse(chunks) {
  const enc = new TextEncoder();
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        let i = 0;
        return {
          async read() {
            if (i >= chunks.length) return { done: true };
            return { done: false, value: enc.encode(chunks[i++]) };
          }
        };
      }
    }
  };
}

// Loads the page, stubs fetch with the given per-attempt scenario, and runs one
// send. Returns the window plus how many requests were made.
async function send(scenario, question = 'spruce repair') {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://thecast.chat/archivist.html'
  });
  const win = dom.window;
  await new Promise(r => win.addEventListener('load', r));
  win.HTMLElement.prototype.scrollIntoView = () => {};
  // jsdom does not expose TextDecoder on window under the test runner. This is
  // a gap in the test environment, not in the browser: TextDecoder has shipped
  // in every major browser since 2017 and the page relies on it to read the
  // stream. Polyfilling here rather than changing the page, so the tests
  // exercise the code that actually ships.
  win.TextDecoder = TextDecoder;
  win.TextEncoder = TextEncoder;
  win.navigator.clipboard = { writeText() {} };
  win.URL.createObjectURL = () => 'blob:test';
  win.URL.revokeObjectURL = () => {};

  let calls = 0;
  win.fetch = async () => { calls++; return scenario(calls); };

  const input = win.document.querySelector('textarea');
  input.value = question;
  await win.eval('sendMessage()');
  await new Promise(r => setTimeout(r, 50));

  return { win, calls, messages: win.document.getElementById('messages') };
}

test('happy path: fragments assemble, sources render, buttons wired once', async () => {
  const { win, calls, messages } = await send(() => streamResponse([
    ev([{ type: 'status', stage: 'retrieving' }]),
    ev([{ type: 'sources', sources: ['BGA Standard Repairs'],
          sourceDetails: [{ label: 'BGA Standard Repairs', kind: 'document',
                            url: 'https://example.org', urlName: 'authoritative copy' }] }]),
    ev([{ type: 'text', delta: 'A 1:15 scarf ' }]),
    ev([{ type: 'text', delta: 'is the rule for spruce.' }]),
    ev([{ type: 'done' }])
  ]));
  const bubble = messages.querySelector('.message.assistant');
  assert.equal(calls, 1);
  assert.equal(bubble.querySelector('.message-body').textContent, 'A 1:15 scarf is the rule for spruce.');
  assert.match(bubble.querySelector('.source-line').textContent, /BGA Standard Repairs/);
  assert.equal(bubble.querySelectorAll('.message-actions').length, 1,
    'decoration must be applied once, at the end');
  assert.equal(win.eval('conversationHistory[conversationHistory.length-1].content'),
    'A 1:15 scarf is the rule for spruce.');
});

test('failure before any text: retries once and recovers', async () => {
  const { calls, messages } = await send(n => n === 1
    ? { ok: false, status: 502, body: null }
    : streamResponse([ev([{ type: 'text', delta: 'Second attempt worked.' }]), ev([{ type: 'done' }])]));
  assert.equal(calls, 2);
  const bodies = [...messages.querySelectorAll('.message.assistant .message-body')].map(e => e.textContent);
  assert.deepEqual(bodies, ['Second attempt worked.']);
});

test('failure AFTER visible text: must not retry, must not duplicate', async () => {
  const { calls, messages } = await send(n => n === 1
    ? streamResponse([ev([{ type: 'text', delta: 'Partial answer so far' }])])  // no done event
    : streamResponse([ev([{ type: 'text', delta: 'DUPLICATE' }]), ev([{ type: 'done' }])]));
  assert.equal(calls, 1, 'a retry here would print the answer twice');
  const text = messages.textContent;
  assert.match(text, /Partial answer so far/, 'text the reader has seen must not be discarded');
  assert.doesNotMatch(text, /DUPLICATE/);
  assert.match(text, /stopped short of the end/, 'the truncation must be stated plainly');
});

test('server error event before any text: retries, then shows an error bubble', async () => {
  const { calls, messages } = await send(() => streamResponse([ev([{ type: 'error', message: 'boom' }])]));
  assert.equal(calls, 2);
  assert.ok(messages.querySelector('.message.assistant.error'));
});

test('survives a chunk boundary falling mid-frame', async () => {
  const wire = ev([{ type: 'text', delta: 'Half ' }, { type: 'text', delta: 'and half.' }, { type: 'done' }]);
  const mid = Math.floor(wire.length / 2);
  const { messages } = await send(() => streamResponse([wire.slice(0, mid), wire.slice(mid)]));
  assert.equal(messages.querySelector('.message-body').textContent, 'Half and half.');
});

test('sources arriving before any text still attach at the end', async () => {
  const { messages } = await send(() => streamResponse([
    ev([{ type: 'sources', sources: ['Wally Kahn / BGA eBook Collection'],
          sourceDetails: [{ label: 'Wally Kahn / BGA eBook Collection', kind: 'wk-collection',
                            url: 'https://example.org', urlName: 'collection' }] }]),
    ev([{ type: 'text', delta: 'From the books.' }]),
    ev([{ type: 'done' }])
  ]));
  assert.match(messages.querySelector('.source-line').textContent, /Wally Kahn/);
});

test('the front end appends only — it never rewrites what the server sent', async () => {
  // The server gates wk- material BEFORE emitting it. If this end ever tried to
  // reassemble or "tidy" the text it could reintroduce something the gate had
  // deliberately removed.
  const { messages } = await send(() => streamResponse([
    ev([{ type: 'text', delta: 'One. ' }, { type: 'text', delta: 'Two. ' }, { type: 'text', delta: 'Three.' }]),
    ev([{ type: 'done' }])
  ]));
  assert.equal(messages.querySelector('.message-body').textContent, 'One. Two. Three.');
});

// ── Links ────────────────────────────────────────────────────────────────────

test('no anchor points at an in-page id: this layout cannot scroll', async () => {
  // body is height:100dvh with overflow:hidden — a fixed app shell. An
  // href="#some-id" has nowhere to jump to and produces no visible change when
  // clicked. "About & sources" pointed at the footer, which is permanently on
  // screen anyway, so the click did nothing at all; removed 8/8/26. If an About
  // panel is wanted later it needs the slide-over mechanism the archive drawer
  // already uses, not an anchor.
  //
  // Bare href="#" is deliberately NOT caught here: the Download and Copy
  // actions are anchors styled as buttons, with click handlers that
  // preventDefault. Slightly old-fashioned, but they work.
  const { win } = await send(() => streamResponse([
    ev([{ type: 'text', delta: 'x' }]), ev([{ type: 'done' }])
  ]));
  const targeted = [...win.document.querySelectorAll('a[href^="#"]')]
    .filter(a => (a.getAttribute('href') || '').length > 1)
    .map(a => `${a.getAttribute('href')} ("${a.textContent.trim()}")`);
  assert.deepEqual(targeted, [], 'in-page anchors cannot work in a non-scrolling layout');
});

test('every external link has a real destination', async () => {
  const { win } = await send(() => streamResponse([
    ev([{ type: 'text', delta: 'x' }]), ev([{ type: 'done' }])
  ]));
  const external = [...win.document.querySelectorAll('a')]
    .filter(a => !a.classList.contains('action-btn'));
  for (const a of external) {
    const href = (a.getAttribute('href') || '').trim();
    assert.ok(href && href !== '#', `empty or placeholder href on "${a.textContent.trim()}"`);
  }
});
