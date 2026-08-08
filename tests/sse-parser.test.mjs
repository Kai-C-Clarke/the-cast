// The SSE frame parser used to read the Anthropic streaming response.
//
// makeSseParser is deliberately split out from the HTTPS plumbing in
// anthropicStream so it can be driven directly with hostile input. Network
// chunks split mid-frame, mid-line and mid-JSON as a matter of routine, and a
// parser that only works on tidy input is precisely the silent-failure shape
// this system spent 6/8/26 eliminating (fetchRawUrl dropping query strings,
// scraped corpus files arriving as navigation garbage, three decade indexes
// dead for weeks). A truncated answer here would look like a short answer,
// not like an error.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSseParser } from '../netlify/functions/archivist.mjs';
import { sseFrames, textDelta } from './fixtures.mjs';

const EXPECTED = 'Spruce repairs need a 1:15 scarf.';
const FRAMES = [
  { type: 'message_start', message: { usage: { input_tokens: 1200 } } },
  textDelta('Spruce '),
  textDelta('repairs '),
  textDelta('need a 1:15 scarf.'),
  { type: 'ping' },
  { type: 'message_delta', usage: { output_tokens: 412 } },
  { type: 'message_stop' }
];
const WIRE = sseFrames(FRAMES);

test('assembles text and merges usage from both message_start and message_delta', () => {
  const parser = makeSseParser(() => {});
  parser.feed(WIRE);
  const result = parser.result();
  assert.equal(result.text, EXPECTED);
  assert.equal(result.usage.input_tokens, 1200);
  assert.equal(result.usage.output_tokens, 412);
  assert.equal(result.error, null);
});

test('onText fires incrementally rather than at the end', () => {
  // This is the entire point of the refactor: if deltas only surfaced once the
  // stream closed we would be back to a buffered response wearing a costume.
  const seen = [];
  const parser = makeSseParser(d => seen.push(d));
  parser.feed(sseFrames([textDelta('Spruce ')]));
  assert.deepEqual(seen, ['Spruce ']);
});

test('survives one-byte-at-a-time delivery', () => {
  const parser = makeSseParser(() => {});
  for (const ch of WIRE) parser.feed(ch);
  assert.equal(parser.result().text, EXPECTED);
});

test('survives 200 randomised chunk boundaries', () => {
  for (let run = 0; run < 200; run++) {
    const parser = makeSseParser(() => {});
    let i = 0;
    while (i < WIRE.length) {
      const len = 1 + Math.floor(Math.random() * 40);
      parser.feed(WIRE.slice(i, i + len));
      i += len;
    }
    assert.equal(parser.result().text, EXPECTED, `failed on run ${run}`);
  }
});

test('survives a split in the middle of a JSON string value', () => {
  const parser = makeSseParser(() => {});
  const mid = WIRE.indexOf('"text":"repairs ') + 8;
  parser.feed(WIRE.slice(0, mid));
  parser.feed(WIRE.slice(mid));
  assert.equal(parser.result().text, EXPECTED);
});

test('an error event surfaces as an error, not a silent truncation', () => {
  const parser = makeSseParser(() => {});
  parser.feed(sseFrames([textDelta('Spruce ')]));
  parser.feed(sseFrames([{ type: 'error', error: { type: 'overloaded_error' } }]));
  const result = parser.result();
  assert.ok(result.error instanceof Error);
  assert.match(result.error.message, /overloaded/);
});

test('a stream ending without a trailing blank line still yields its last frame', () => {
  const parser = makeSseParser(() => {});
  parser.feed('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"tail"}}');
  assert.equal(parser.result().text, 'tail');
});

test('a malformed frame is skipped rather than being fatal', () => {
  const parser = makeSseParser(() => {});
  parser.feed('data: {not json\n\n');
  parser.feed(sseFrames([textDelta('Spruce ')]));
  const result = parser.result();
  assert.equal(result.text, 'Spruce ');
  assert.equal(result.error, null);
});

test('a throwing onText handler does not kill the stream', () => {
  // The handler is the gated writer, which touches the wk- gate. If it threw on
  // one paragraph we still want the rest of the answer and the usage figures.
  const parser = makeSseParser(() => { throw new Error('handler blew up'); });
  parser.feed(WIRE);
  assert.equal(parser.result().text, EXPECTED);
});
