#!/usr/bin/env node
// Install or update agent-tracking in a project (see RUNBOOK.md).
//
//   node install.mjs <path-to-project>
//
// Copies the two workflows into .github/workflows/, and writes the shared
// Work tracking rules into AGENTS.md between the agent-tracking markers. The
// project's own section ("Work tracking in this repo") is added once from a
// stub and never touched again. Safe to re-run: that is how an update lands.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT = dirname(fileURLToPath(import.meta.url));
const START = '<!-- agent-tracking:start';
const END = '<!-- agent-tracking:end -->';
export const PROJECT_HEADING = '## Work tracking in this repo';

// Returns AGENTS.md with the managed block in place: replaced if the markers
// exist, otherwise inserted before the first `## ` section (after the title
// and intro), followed by the project stub if the project has none yet.
export function applyBlock(text, block, stub) {
  block = block.trimEnd();
  const s = text.indexOf(START);
  const e = text.indexOf(END);
  if (s >= 0 && e > s) {
    return text.slice(0, s) + block + text.slice(e + END.length);
  }
  const insert = `${block}\n\n${text.includes(PROJECT_HEADING) ? '' : `${stub.trimEnd()}\n\n`}`;
  const at = text.search(/^## /m);
  if (at < 0) return `${text.trimEnd()}\n\n${insert.trimEnd()}\n`;
  return text.slice(0, at) + insert + text.slice(at);
}

function main() {
  const target = process.argv[2];
  if (!target || !existsSync(target)) throw new Error('usage: node install.mjs <path-to-project>');

  const wfDir = join(target, '.github', 'workflows');
  mkdirSync(wfDir, { recursive: true });
  for (const f of readdirSync(join(KIT, 'templates', 'workflows'))) {
    copyFileSync(join(KIT, 'templates', 'workflows', f), join(wfDir, f));
    console.log(`wrote .github/workflows/${f}`);
  }

  // AGENTS.md is often the real file behind a CLAUDE.md symlink; resolve it so
  // the symlink survives.
  let agents = join(target, 'AGENTS.md');
  agents = existsSync(agents) ? realpathSync(agents) : agents;
  const before = existsSync(agents) ? readFileSync(agents, 'utf8') : '# AGENTS.md\n';
  const after = applyBlock(
    before,
    readFileSync(join(KIT, 'templates', 'agents-block.md'), 'utf8'),
    readFileSync(join(KIT, 'templates', 'agents-project.md'), 'utf8'),
  );
  writeFileSync(agents, after);
  console.log(`${before === after ? 'unchanged' : 'updated'} ${relative(target, agents) || 'AGENTS.md'}`);
  if (after.includes('TODO-KEY') || /`p[12]`: TODO/.test(after)) {
    console.log(`\nfill in "${PROJECT_HEADING}" in AGENTS.md: the Jira key and the p1/p2 wording`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
