import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyBlock, PROJECT_HEADING } from '../install.mjs';

const block = '<!-- agent-tracking:start — x -->\n## Work tracking\nv1\n<!-- agent-tracking:end -->\n';
const stub = `${PROJECT_HEADING}\n\nstub\n`;
const doc = '# Project\n\nIntro.\n\n## Layout\n\nstuff\n';

test('first install puts the block and the stub before the first section', () => {
  const out = applyBlock(doc, block, stub);
  assert.equal(out, `# Project\n\nIntro.\n\n${block.trimEnd()}\n\n${stub.trimEnd()}\n\n## Layout\n\nstuff\n`);
});

test('re-install replaces only the block and keeps the project section', () => {
  const first = applyBlock(doc, block, stub).replace('stub', 'our priorities');
  const out = applyBlock(first, block.replace('v1', 'v2'), stub);
  assert.match(out, /v2/);
  assert.doesNotMatch(out, /v1/);
  assert.match(out, /our priorities/);
  assert.equal(out.split(PROJECT_HEADING).length, 2);
  assert.equal(applyBlock(out, block.replace('v1', 'v2'), stub), out);
});

test('a file with no sections gets the block appended', () => {
  assert.match(applyBlock('# AGENTS.md\n', block, stub), /^# AGENTS\.md\n\n<!-- agent-tracking:start/);
});
