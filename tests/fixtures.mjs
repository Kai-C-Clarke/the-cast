// SYNTHETIC FIXTURES ONLY.
//
// This repo is PUBLIC. The Wally Kahn / BGA eBook Collection is held under a
// restricted-use permission granted by Pete Stratten — private store, never
// rehosted, never committed here (see .gitignore). So the wk- fixtures below
// are entirely invented: a made-up slug that matches no real book, and a
// sentence written for this test file. Nothing here comes from the collection.
//
// If you extend these tests, keep it that way. The gate's behaviour does not
// depend on the text being real — only on whether a quote can be found in the
// window text it is checked against.
export const FIXTURE_BOOK = [{
  slug: 'wk-b00-synthetic-test-fixture',
  pdf_page: 214,
  window_text: 'The launch failed and the cable broke clean away from the hook without warning that morning over the ridge.'
}];

export const VERIFIABLE_QUOTE = 'the cable broke clean away from the hook';
export const FABRICATED_QUOTE = 'the wing spar was replaced with steel tubing in 1938';

// Builds an SSE wire fragment the way the Anthropic messages endpoint does.
export function sseFrames(objs) {
  return objs.map(o => `data: ${JSON.stringify(o)}\n\n`).join('');
}

export function textDelta(text) {
  return { type: 'content_block_delta', delta: { type: 'text_delta', text } };
}
