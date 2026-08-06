# Alf Archivist — V2 Design Plan

Origin: external design critique (Grok, 6/8/26) of thecast.chat/archivist.html,
sorted against the system's actual constraints by Claude the same day. The critique
saw the presentation, not the plumbing — several proposals collide with permission
boundaries and the launch-gate feature freeze, hence this sort.

**Status: HELD until launch gates close** (wk- smoke tests + Jon's AMP corpus
decision). None of this touches archivist.js — it is all archivist.html territory —
but it queues behind the gates rather than jumping them. The engine was stabilised
6/8/26 (root-cause fetch fix, corpus guard, automated golden set); the page must
not become a new source of churn while that settles.

---

## Tier 1 — Quick wins (~2 hours total, no engine contact)

Can be done immediately after the gates close, or before if Jon wants — none of
these can break retrieval.

1. **Kill the "Loading archive contents…" placeholder.** A half-loaded state is
   the worst possible first impression for a trust-critical tool. Replace with
   either a static catalogue of what Alf can consult or nothing at all.
2. **Starter question chips** on empty chat. Cheap, high-value, and they soften
   the known latency profile (~12–17s typical): a user who tapped a suggested
   question forgives a wait better than one staring at a blank box. Use questions
   the golden set proves Alf answers well — e.g. spruce spar scarf ratios, fabric
   patch overlap, turnbuckle safety wiring, Aerodux current position. Do NOT
   suggest questions in known-weak areas (AMP topics with no healthy source until
   the corpus decision is made).
3. **Disclaimer as a persistent slim strip** at the chat boundary — current strong
   wording, cleaner presentation, always visible. "Alf assists research only. You
   or your inspector must verify every procedure, specification and requirement
   against current authoritative sources. Nothing here is approved maintenance
   data."

## Tier 2 — V2 proper (schedule after Pete has seen the launch version)

4. **Character progress state instead of a spinner.** The single best idea in the
   critique: while retrieval + generation runs, show Alf "rifling through the
   drawings" / "fetching the book down off the shelf" — turns the latency
   weakness into character. Text-based rotating status lines are the cheap
   version; a small animation is the nice version.
5. **Workshop-authentic visual redesign.** Warm oak/spruce palette, paper-texture
   message styling for Alf, off-white/deep green/brass accents, dark "evening
   workshop" mode. Real design work — do it once, properly, with the mockup →
   render-check → ship discipline used for the BGA header (wkhtmltoimage at 900px
   and 390px before pushing).
6. **Alf portrait.** Illustration or render: older Yorkshire engineer, oiled
   overalls, organised-cluttered bench, wing in background. A commissioned or
   carefully generated piece, not a checkbox. Shrinks to compact avatar on mobile.
7. **Archive CATALOGUE panel (not a reading room).** Browsable list of what Alf
   can consult: title, one-line description, category filters (Wood / Fabric /
   Adhesives / Airworthiness / Types), and an "Ask Alf about this" button that
   pre-loads the chat. HARD BOUNDARY: titles and descriptions only — no full-text
   browsing, no page images. The catalogue can be generated from FILE_INDEX
   labels + the wk- index slugs, which keeps it truthful about actual coverage.
8. **Topic primers.** Short Alf-narrated overviews of common subjects as
   expandable cards. Write them from golden-set-verified material only; each
   primer is effectively a cached answer, so it must meet the same sourcing bar
   as a live one.
9. **Export chat / new conversation buttons.** Straightforward, useful for
   someone saving research against a restoration job.

## Declined — permanently, with reasons (do not resurrect without re-reading this)

10. **"Show me the drawing" — inline scanned pages/figures in chat. NO.**
    The Wally Kahn / BGA eBook Collection is snippet-only by explicit agreement
    with Pete Stratten (1/8/26): paraphrase-first, at most one short attributed
    quote, hard checksum gate, private grounding store NOT for reproduction.
    Surfacing scanned pages inline is precisely what the permission excludes.
    There was already one near-miss (5/8/26) where wk- texts almost got published
    through the public repo — this feature would make that exposure a designed-in
    behaviour. The same caution applies to original type drawings until their
    copyright position is individually established. If a user needs the page,
    Alf gives the source link — that is the designed behaviour and it stays.
11. **Multilingual (EN/DE/FR/ES). Deferred indefinitely.** The audience is
    overwhelmingly English-speaking VGC/BGA members; every language multiplies
    the golden-set testing surface and the character-voice maintenance for
    near-zero reach. Revisit only on demonstrated demand.

## Notes

- The "citation line under every answer" the critique asks for already exists —
  the sources panel with provenance cards (built 5/8/26 era). V2 may restyle it;
  it does not need inventing.
- Everything above is archivist.html / front-end. Any item that turns out to need
  archivist.js changes goes back through the golden set before shipping — no
  exceptions, that is the whole point of having it.
