# Alf tests

Fast unit tests for the Alf Kirby archivist function and its front end. No
network, no API keys, no model calls — they run in a couple of seconds and are
safe to run on every push.

```bash
cd tests
npm install
npm test
```

## What is here

| File | Guards |
|---|---|
| `gated-writer.test.mjs` | The wk- checksum gate under streaming |
| `sse-parser.test.mjs` | The Anthropic SSE frame parser |
| `frontend-stream.test.mjs` | The browser end, in jsdom against the real `archivist.html` |
| `bundle-guards.test.mjs` | Failure modes that only appear at deploy time |

## The one that matters most

`gated-writer.test.mjs` asserts that a fabricated quotation is **never emitted**.

The wk- checksum gate does not merely flag suspect quotations — it excises the
sentences containing them. That is the structural enforcement of the
restricted-use permission granted for the Wally Kahn / BGA eBook Collection: at
most one quotation, 25 words, with a `scan page N` citation that can actually be
verified against the source text. Before the streaming refactor (8 Aug 2026) the
gate ran once over a completed reply. It now runs per paragraph, *before* each
paragraph is emitted, because streaming raw tokens would put unverified
quotations in front of the reader before any gate could act.

If that assertion ever goes red, stop and fix it before shipping anything else.

## Fixtures are synthetic, and must stay that way

This repo is public. The Wally Kahn / BGA eBook Collection is held under a
restricted-use permission — private store, never rehosted, never committed here
(see `.gitignore`). Everything in `fixtures.mjs` is invented for these tests: a
slug that matches no real book, and a sentence written for the purpose.

The gate's behaviour does not depend on the text being real, only on whether a
quotation can be found in the window text it is checked against. Keep it that
way when extending these tests.

## What these tests do *not* cover

They are unit tests. They do not talk to the live site, the model, or the
Archive. The three existing suites that do — `run_golden_set.py`,
`wk_smoke_tests.py` and `verify_corpus.py` in the private `glider-workshop`
repo — remain the check on answer *quality* and corpus health. Those cost real
model calls and need credentials for private repos, so they are not wired into
this workflow; they are run deliberately, not on every push.

The split is intentional: this workflow answers "is the machinery sound?", the
Python suites answer "are the answers right?". Both are needed.
