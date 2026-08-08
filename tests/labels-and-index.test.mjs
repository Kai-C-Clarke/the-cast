// Source labels and FILE_INDEX hygiene.
//
// Two problems, one theme: what the reader is told a claim came from, and
// whether Alf gets two distinct documents or the same one twice.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wkCleanTitle, wkTitleCase, selectDocuments, FILE_INDEX }
  from '../netlify/functions/archivist.mjs';

// ── wk- book titles ───────────────────────────────────────────────────────────
// The sources panel used to derive a book's name from its slug, giving bare
// lowercase strings in a panel whose entire job is to say which book a claim
// came from. Titles now come from the collection manifest's published filename.

test('an ALL CAPS filename is title-cased', () => {
  assert.equal(wkCleanTitle('SAILS IN THE SKY.pdf'), 'Sails in the Sky');
  assert.equal(wkCleanTitle('THE ART OF SOARING FLIGHT.pdf'), 'The Art of Soaring Flight');
});

test('an already-cased title is left exactly as published', () => {
  // 128 of the 155 arrive correctly cased. Re-casing them would quietly
  // "correct" the publisher — note the lowercase "world" here, which is how the
  // book is actually named.
  assert.equal(wkCleanTitle('Gliders and Sailplanes of the world.pdf'),
    'Gliders and Sailplanes of the world');
  assert.equal(wkCleanTitle('Dying High.pdf'), 'Dying High');
});

test('small words stay lowercase mid-title but not at the ends', () => {
  assert.equal(wkTitleCase('BIRDFLIGHT AS THE BASIS OF AVIATION'), 'Birdflight as the Basis of Aviation');
  assert.equal(wkTitleCase('THE ROAD TO'), 'The Road To');
});

test('"Take Up Slack" keeps its capital U', () => {
  // "up" is deliberately absent from the small-word set: this is a launch
  // command, not a phrasal verb to be tidied away.
  assert.equal(wkCleanTitle("'TAKE UP SLACK'.pdf"), 'Take Up Slack');
});

test('quotes, doubled spaces and the extension are stripped', () => {
  assert.equal(wkCleanTitle('BRITISH  SOARING  YEARBOOK 1981.pdf'), 'British Soaring Yearbook 1981');
  assert.equal(wkCleanTitle("'AIRCRAFT'.pdf"), 'Aircraft');
});

test('hyphenated words are cased on both sides', () => {
  assert.equal(wkCleanTitle('GLIDING AND SAIL-PLANING.pdf'), 'Gliding and Sail-Planing');
});

test('known acronyms are not sentence-cased', () => {
  assert.equal(wkTitleCase('THE BGA JOURNAL'), 'The BGA Journal');
});

// ── FILE_INDEX hygiene ────────────────────────────────────────────────────────

test('no two FILE_INDEX entries share a label', () => {
  // selectDocuments returns only TWO documents, so a duplicated label spends
  // both slots on the same document and crowds out the second-best distinct
  // source. Nine AMP topics were doing exactly this until 8/8/26.
  const seen = new Map();
  const dupes = [];
  for (const entry of FILE_INDEX) {
    if (seen.has(entry.label)) dupes.push(`${entry.label}  (${seen.get(entry.label)} / ${entry.path})`);
    seen.set(entry.label, entry.path);
  }
  assert.deepEqual(dupes, [], 'duplicate labels waste a document slot');
});

test('no two FILE_INDEX entries share a path', () => {
  const paths = FILE_INDEX.map(e => e.path);
  assert.equal(new Set(paths).size, paths.length);
});

test('every entry has keywords, a path and a label', () => {
  for (const entry of FILE_INDEX) {
    assert.ok(Array.isArray(entry.keywords) && entry.keywords.length > 0, `keywords missing: ${entry.path}`);
    assert.ok(entry.path && entry.label, 'path and label are required');
    assert.ok(entry.keywords.every(k => k === k.toLowerCase()),
      `keywords must be lowercase — they are matched against a lowercased query: ${entry.path}`);
  }
});

test('selectDocuments never returns the same document twice', () => {
  // The guard behind the pruning: a future duplicate should degrade to "one
  // entry ignored", not to "Alf reads one document twice".
  const queries = ['seat harness inspection', 'complex maintenance rules', 'how do I renew a NARC',
                   'inspector authorisation rating', 'a conditions flight permit',
                   'acceptable materials and parts', 'spruce scarf repair', 'wing covering'];
  for (const q of queries) {
    const picked = selectDocuments(q);
    const labels = picked.map(p => p.label);
    assert.equal(new Set(labels).size, labels.length, `duplicate document selected for "${q}"`);
    const paths = picked.map(p => p.path);
    assert.equal(new Set(paths).size, paths.length, `duplicate path selected for "${q}"`);
  }
});

test('the pruned AMP topics now return a second, distinct source', () => {
  for (const q of ['seat harness inspection', 'complex maintenance rules', 'acceptable materials and parts']) {
    const picked = selectDocuments(q);
    assert.equal(picked.length, 2, `"${q}" should still fill both document slots`);
  }
});
