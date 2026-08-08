// Guards for failure modes that only appear at DEPLOY time.
//
// The streaming refactor's first deploy failed with "Identifier '__dirname' has
// already been declared". Netlify's esbuild bundler INJECTS its own __dirname /
// __filename / require shims into ESM functions, so declaring one collides at
// bundle time even though the source is perfectly valid JavaScript. `node
// --check` passes clean; nothing local catches it.
//
// These are deliberately narrow static checks rather than an attempt to
// reproduce the bundler. They encode the specific lesson so it cannot come back
// silently, and they cost nothing to run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FN = path.join(HERE, '..', 'netlify', 'functions', 'archivist.mjs');
const SRC = fs.readFileSync(FN, 'utf8');

// Strip comments only, so the checks look at real code rather than at the
// explanatory comments that discuss these very identifiers. Deliberately NOT
// stripping string literals too: a literal-stripping regex is easy to get
// subtly wrong on a file full of template literals, and getting it wrong here
// would silently disable every check below.
const CODE = SRC
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

for (const shim of ['__dirname', '__filename', 'require']) {
  test(`does not declare ${shim} (Netlify's ESM bundler injects its own)`, () => {
    const re = new RegExp(`\\b(?:const|let|var|function)\\s+${shim}\\b`);
    assert.doesNotMatch(CODE, re,
      `Declaring ${shim} collides with the bundler's injected shim and fails the deploy, ` +
      `not the local syntax check. Use a differently named constant (see FUNCTION_DIR).`);
  });
}

test('uses a default export, which is what makes it a v2 streaming function', () => {
  assert.match(CODE, /export\s+default\s+async\s+function\s+handler/);
});

test('does not use the v1 handler shape', () => {
  assert.doesNotMatch(CODE, /exports\.handler\s*=/);
  assert.doesNotMatch(CODE, /module\.exports/);
});

test('uses ESM imports, not require()', () => {
  assert.match(CODE, /^import\s+https\s+from\s+/m);
  assert.doesNotMatch(CODE, /=\s*require\(/);
});

test('the function file is .mjs, not .js', () => {
  // A root package.json with "type": "module" would achieve the same thing but
  // would change how the four remaining v1 CommonJS functions in this directory
  // (chat, tomita, confucius, tts) are bundled. The extension scopes it.
  assert.ok(fs.existsSync(FN), 'archivist.mjs must exist');
  assert.ok(!fs.existsSync(FN.replace(/\.mjs$/, '.js')),
    'archivist.js must not co-exist with archivist.mjs — two functions of the same name collide');
});

test('the wk- gate is still wired into the streaming path', () => {
  // A refactor that quietly dropped this call would remove the enforcement of
  // the Wally Kahn / BGA eBook Collection permission without any test in
  // gated-writer.test.mjs going red, because that file tests the writer in
  // isolation. This checks it is actually reached from the handler.
  assert.match(CODE, /makeGatedWriter\(wkResults/,
    'the handler must route model output through the gated writer');
});

test('no API keys or tokens are hardcoded', () => {
  // This repo is public.
  assert.doesNotMatch(SRC, /sk-ant-[A-Za-z0-9_-]{10}/);
  assert.doesNotMatch(SRC, /\bghp_[A-Za-z0-9]{20}/);
  assert.match(CODE, /process\.env\.ANTHROPIC_API_KEY/);
  assert.match(CODE, /process\.env\.GITHUB_TOKEN/);
});
