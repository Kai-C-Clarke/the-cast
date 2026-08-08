// The wk- checksum gate under streaming.
//
// WHY THIS FILE MATTERS MORE THAN THE OTHERS: wkApplyChecksumGate does not
// merely flag suspect quotations — it EXCISES the sentences containing them.
// That is the structural enforcement of the restricted-use permission granted
// for the Wally Kahn / BGA eBook Collection: at most one quotation, 25 words,
// with a "scan page N" citation that can actually be verified against the
// source text. Before the 8/8/26 streaming refactor the gate ran once over a
// completed reply. It now runs per paragraph, BEFORE each paragraph is emitted,
// because streaming raw tokens would put unverified quotations in front of the
// reader before any gate could act.
//
// The single most important assertion in this repo is "fabricated quote is
// never emitted". If that ever goes red, stop and fix it before shipping.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGatedWriter, wkApplyChecksumGate } from '../netlify/functions/archivist.mjs';
import { FIXTURE_BOOK, VERIFIABLE_QUOTE, FABRICATED_QUOTE } from './fixtures.mjs';

// Collects everything the writer actually put in front of the reader.
function harness(wkResults) {
  const emitted = [];
  const writer = makeGatedWriter(wkResults, chunk => emitted.push(chunk));
  return { writer, emitted, seen: () => emitted.join('') };
}

test('ungated: no wk- results means immediate passthrough, text unaltered', () => {
  const { writer, emitted, seen } = harness([]);
  assert.equal(writer.gated, false);
  'Hello there, this is a plain answer.'.split(' ').forEach(w => writer.push(w + ' '));
  assert.equal(emitted.length, 7, 'each fragment should go straight out');
  assert.equal(writer.finish().text.trim(), 'Hello there, this is a plain answer.');
});

test('gated: nothing is emitted until a paragraph completes', () => {
  const { writer, emitted } = harness(FIXTURE_BOOK);
  assert.equal(writer.gated, true);
  writer.push('Alf begins his answer here');
  assert.equal(emitted.length, 0, 'mid-paragraph text must be held back');
  writer.push(' and finishes the thought.\n\n');
  assert.equal(emitted.length, 1);
  assert.match(emitted[0], /finishes the thought/);
});

test('gated: a verifiable quote with a correct scan page survives', () => {
  const { writer, seen } = harness(FIXTURE_BOOK);
  writer.push(`The book records that "${VERIFIABLE_QUOTE}" — see scan page 214.\n\n`);
  const result = writer.finish();
  assert.match(seen(), /cable broke clean away/);
  assert.equal(result.flagged.length, 0);
});

test('gated: a FABRICATED quote never reaches the reader', () => {
  const { writer, seen } = harness(FIXTURE_BOOK);
  writer.push('Alf opens with a sound paragraph of context.\n\n');
  writer.push(`The book states that "${FABRICATED_QUOTE}" — see scan page 214.\n\n`);
  const result = writer.finish();
  assert.doesNotMatch(seen(), /steel tubing/, 'unverifiable quotation must be excised before emission');
  assert.equal(result.flagged.length, 1);
  assert.equal(result.flagged[0].reason, 'unverified');
  assert.match(seen(), /sound paragraph of context/, 'the good paragraph must still be delivered');
});

test('gated: a quote over the 25-word permission cap is stripped', () => {
  const long = Array.from({ length: 30 }, (_, i) => 'word' + i).join(' ');
  const { writer, seen } = harness(FIXTURE_BOOK);
  writer.push(`He wrote "${long}" in the memoir — see scan page 214.\n\n`);
  const result = writer.finish();
  assert.doesNotMatch(seen(), /word29/);
  assert.equal(result.flagged[0].reason, 'over-length (>25 words)');
});

test('gated: quote and citation split across sentences still verifies', () => {
  // This is exactly why release happens at PARAGRAPH and not sentence
  // boundaries. wkFindNearbyPageCitation searches a +/-120 char window, and
  // natural phrasing routinely puts the citation in the following sentence.
  // Sentence-level release would strip a perfectly good quotation whose
  // citation had not yet arrived.
  const { writer, seen } = harness(FIXTURE_BOOK);
  writer.push(`As the book has it, "${VERIFIABLE_QUOTE}". See scan page 214 for the passage.\n\n`);
  const result = writer.finish();
  assert.equal(result.flagged.length, 0);
  assert.match(seen(), /cable broke clean away/);
});

test('gated: finish() flushes an unterminated final paragraph', () => {
  const { writer, emitted, seen } = harness(FIXTURE_BOOK);
  writer.push('A closing thought with no trailing blank line');
  assert.equal(emitted.length, 0);
  writer.finish();
  assert.match(seen(), /closing thought/);
});

test('gated: the "nothing left" fallback fires once, not per paragraph', () => {
  const { writer, seen } = harness(FIXTURE_BOOK);
  writer.push(`He said "${FABRICATED_QUOTE}" — scan page 214.\n\n`);
  writer.push('He added "the fuselage was aluminium throughout the war years" — scan page 214.\n\n');
  const result = writer.finish();
  const occurrences = (seen().match(/couldn't verify the specific claim/g) || []).length;
  assert.equal(occurrences, 1, 'the apology must not repeat after every stripped paragraph');
  assert.equal(result.flagged.length, 2);
});

test('gated: short but sound paragraphs do not trigger the fallback', () => {
  const { writer, seen } = harness(FIXTURE_BOOK);
  writer.push('Aye.\n\n');
  writer.push('That is the long and short of it, and nowt more to add.\n\n');
  writer.finish();
  assert.doesNotMatch(seen(), /couldn't verify/);
});

test('regression: the buffered gate is unchanged for non-streaming callers', () => {
  // allowFallback defaults to true, so any code still calling the gate over a
  // complete reply behaves exactly as it did before the refactor.
  const out = wkApplyChecksumGate(
    `He said "${FABRICATED_QUOTE}" — scan page 214.`, FIXTURE_BOOK);
  assert.match(out.reply, /couldn't verify/);
  assert.equal(out.flagged.length, 1);
});

test('what is returned is what was shown, not what the model generated', () => {
  // The conversation log and the client's own history both record finish().text.
  // If that ever diverged from the emitted stream, the log would claim Alf said
  // something the reader never saw — or worse, the reverse.
  const { writer, seen } = harness(FIXTURE_BOOK);
  writer.push('Good opening paragraph here.\n\n');
  writer.push(`Then "${FABRICATED_QUOTE}" — scan page 214.\n\n`);
  const result = writer.finish();
  assert.equal(result.text, seen());
});
