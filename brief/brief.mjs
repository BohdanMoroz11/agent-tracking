// Morning brief: an agent session per active repo reads the issues' stories and
// writes what matters today; the sections go out as one Telegram message, each
// with the session id, so the user can `claude --resume` it and carry on. The
// session runs the due verify and recheck checks itself, in auto mode.
// Runs on the devbox from the timer (HOW-IT-WORKS.md), not in GitHub Actions.
//
//   node brief/brief.mjs                 # print the brief, send nothing (default for now)
//   node brief/brief.mjs --send          # also send it to Telegram
//   node brief/brief.mjs --repo myapp    # only this repo (name or owner/name); repeatable
//   node brief/brief.mjs --force         # include repos even when nothing happened
//   node brief/brief.mjs --dry           # write each repo's prompt to its state dir, run no agent
//
// Repos come from ~/.config/agent-tracking/repos: `owner/name [checkout] [title]`
// per line, checkout defaulting to ~/projects/<name>. State (when each repo was
// last briefed, and past briefs) lives in ~/.local/state/agent-tracking/brief/.
// A repo takes part when something happened since its last brief, when a recheck
// or verify date came due since then, or on Monday when anything is overdue.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { labelsOf, localDate, parseVerify, parseWaiting, summarize } from '../digest/digest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOME = homedir();
const DAY = 24 * 60 * 60 * 1000;
const TZ = process.env.DIGEST_TZ || 'Europe/Kyiv';
const CONFIG = process.env.AGENT_TRACKING_REPOS || join(HOME, '.config/agent-tracking/repos');
const STATE = process.env.AGENT_TRACKING_STATE || join(HOME, '.local/state/agent-tracking/brief');
const PREVIOUS_BRIEFS = 3;
const MAX_STORIES = 25;
// The session runs like the user's own: their settings, in auto mode, so it can
// read production to run the checks. It never edits the checkout.
const PERMISSIONS = ['--permission-mode', 'auto', '--disallowedTools', 'Edit', 'Write', 'NotebookEdit'];

// ---------------------------------------------------------------- pure logic

export function parseRepos(text) {
  return text.split('\n').map(l => l.replace(/#.*/, '').trim()).filter(Boolean).map(l => {
    const [repo, checkout, ...title] = l.split(/\s+/);
    const name = repo.split('/')[1];
    return {
      repo, name,
      checkout: (checkout ?? `~/projects/${name}`).replace(/^~(?=\/)/, HOME),
      title: title.join(' ') || name,
    };
  });
}

const clip = (s, n) => (s && s.length > n ? `${s.slice(0, n)}…` : s ?? '');
const ago = (now, iso) => Math.floor((now - Date.parse(iso)) / DAY);

// Which repos speak today, and why. `since` is the last brief's time.
export function shouldBrief({ since, now, tz, activity, open, verify }) {
  const today = localDate(now, tz);
  const sinceDay = localDate(since, tz);
  const dates = [
    ...open.map(i => parseWaiting(i.body).recheck),
    ...verify.map(i => parseVerify(i.body).on),
  ].filter(Boolean);
  const reasons = [];
  if (activity) reasons.push('activity');
  if (dates.some(d => d > sinceDay && d <= today)) reasons.push('came due');
  const monday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(now) === 'Mon';
  if (monday && dates.some(d => d <= today)) reasons.push('Monday, overdue items');
  return reasons;
}

// The material handed to the agent: full stories for the issues that matter
// today, one line for the rest, and what moved in PRs and commits.
export function material({ now, since, open, closedSince, verify, comments, pulls, commits, facts }) {
  const out = [];
  const head = i => `#${i.number} ${i.title} [${labelsOf(i).join(', ') || 'no labels'}]`;
  const story = i => {
    const cs = comments.get(i.number) ?? [];
    return [
      `### ${head(i)}`,
      `${i.state === 'closed' ? `closed ${i.closed_at.slice(0, 10)}` : 'open'}, opened ${i.created_at.slice(0, 10)}, last update ${ago(now, i.updated_at)} days ago`,
      clip(i.body, 1500),
      ...(cs.length > 8 ? [`(${cs.length - 8} earlier comments not shown)`] : []),
      ...cs.slice(-8).map(c => `— comment ${c.created_at.slice(0, 16).replace('T', ' ')}:\n${clip(c.body, 1200)}`),
    ].join('\n');
  };
  const storied = new Set(comments.keys());
  out.push('## Facts from the labels and dates (complete; do not skip any of these)');
  const fact = (title, list, fmt) => list.length && out.push(`${title}:`, ...list.map(fmt));
  fact('Recheck due', facts.due, i => `- #${i.number} recheck ${i.recheck}, waiting on ${i.who ?? '?'}`);
  fact('Verify due', facts.verifyDue, i => `- #${i.number} verify on ${i.on}`);
  fact('`now` with no update for a week', facts.quiet, i => `- #${i.number} quiet ${i.days} days`);
  fact('p1 with no state', facts.p1NoState, i => `- #${i.number}`);
  fact('Label problems', facts.labelProblems, i => `- #${i.number} ${i.problem}`);
  out.push(`Open: ${open.length}. Closed since the last brief: ${closedSince.length}.`, '');

  out.push('## Issue stories (issues that moved since the last brief, are due, or are in progress)');
  for (const i of [...open, ...closedSince, ...verify]) if (storied.has(i.number)) { out.push(story(i), ''); storied.delete(i.number); }

  out.push('## Other open issues (one line each)');
  for (const i of open) if (!comments.has(i.number)) out.push(`- ${head(i)}, last update ${ago(now, i.updated_at)} days ago`);
  out.push('');

  out.push('## Pull requests updated since the last brief');
  if (!pulls.length) out.push('none');
  for (const p of pulls) {
    const state = p.merged_at ? `merged ${p.merged_at.slice(0, 16).replace('T', ' ')}` : p.state === 'open' ? (p.draft ? 'open, draft' : 'open') : 'closed unmerged';
    out.push(`- PR #${p.number} ${p.title} (${state}): ${clip((p.body ?? '').replace(/\s+/g, ' '), 300)}`);
  }
  out.push('', '## Commits on the default branch since the last brief');
  out.push(...(commits.length ? commits.map(c => `- ${c.sha.slice(0, 7)} ${c.commit.message.split('\n')[0]}`) : ['none']));
  return out.join('\n');
}

// Telegram HTML: escape, then link `#123` (GitHub redirects an issue URL to the
// PR when it is one) and keep the session line copyable.
export function toTelegram(sections) {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return sections.map(s => {
    const body = esc(s.text).replace(/(^|[\s([])#(\d+)\b/g, (_, pre, n) => `${pre}<a href="https://github.com/${s.repo}/issues/${n}">#${n}</a>`);
    const resume = s.sessionId ? `\n<code>cd ${esc(s.checkout.replace(HOME, '~'))} &amp;&amp; claude --resume ${s.sessionId}</code>` : '';
    return `<b>${esc(s.title)}</b>\n${body}${resume}`;
  }).join('\n\n');
}

// ---------------------------------------------------------------- I/O

function githubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const file = join(HOME, '.gh-token.txt');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
}

async function gh(token, path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (!res.ok) throw new Error(`GitHub GET ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function all(token, path) {
  const out = [];
  for (let page = 1; ; page++) {
    const batch = await gh(token, `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    out.push(...batch);
    if (batch.length < 100) return out;
  }
}

async function gather(token, { repo }, since, now) {
  const iso = since.toISOString();
  const noPR = list => list.filter(i => !i.pull_request);
  const [open, recent, verify, pulls, commits] = await Promise.all([
    all(token, `/repos/${repo}/issues?state=open`).then(noPR),
    all(token, `/repos/${repo}/issues?state=closed&since=${iso}`).then(noPR),
    all(token, `/repos/${repo}/issues?state=closed&labels=verify`).then(noPR),
    gh(token, `/repos/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=50`),
    gh(token, `/repos/${repo}/commits?since=${iso}&per_page=50`),
  ]);
  const closedSince = recent.filter(i => Date.parse(i.closed_at) >= since.getTime());
  const facts = summarize({ open, closed: closedSince, verify, now, tz: TZ });
  const moved = i => Date.parse(i.updated_at) >= since.getTime();
  const pick = [
    ...facts.due, ...facts.verifyDue, ...facts.quiet,
    ...open.filter(moved), ...closedSince, ...verify.filter(moved),
    ...open.filter(i => labelsOf(i).includes('now')),
  ].map(i => i.number);
  const storied = [...new Set(pick)].slice(0, MAX_STORIES);
  const comments = new Map(await Promise.all(storied.map(async n => [n, await all(token, `/repos/${repo}/issues/${n}/comments`)])));
  const recentPulls = pulls.filter(p => Date.parse(p.updated_at) >= since.getTime());
  const activity = open.some(moved) || closedSince.length > 0 || recentPulls.length > 0 || commits.length > 0;
  return { open, closedSince, verify, comments, pulls: recentPulls, commits, facts, activity };
}

function stateFor(name) {
  const dir = join(STATE, name);
  mkdirSync(join(dir, 'briefs'), { recursive: true });
  const lastFile = join(dir, 'last-run');
  const previous = readdirSync(join(dir, 'briefs')).sort().slice(-PREVIOUS_BRIEFS)
    .map(f => `### Brief of ${f.replace('.txt', '')}\n${readFileSync(join(dir, 'briefs', f), 'utf8')}`);
  return {
    since: existsSync(lastFile) ? new Date(readFileSync(lastFile, 'utf8').trim()) : null,
    previous,
    save(now, text) {
      writeFileSync(lastFile, now.toISOString());
      writeFileSync(join(dir, 'briefs', `${localDate(now, TZ)}.txt`), text);
    },
  };
}

function runAgent(cfg, prompt) {
  // So `git log origin/HEAD` in the session sees what was merged overnight.
  spawnSync('git', ['fetch', '-q', 'origin'], { cwd: cfg.checkout, timeout: 60 * 1000 });
  const sessionId = randomUUID();
  const r = spawnSync('claude', [
    '-p', '--session-id', sessionId, '--output-format', 'json',
    ...PERMISSIONS,
  ], { cwd: cfg.checkout, input: prompt, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 60 * 60 * 1000 });
  let out;
  try { out = JSON.parse(r.stdout); } catch { out = null; }
  if (r.status !== 0 || !out || out.is_error) {
    throw new Error(`claude failed (exit ${r.status}): ${clip(out?.result ?? r.stderr ?? r.error?.message ?? '', 300)}`);
  }
  return { sessionId, text: out.result.trim(), cost: out.total_cost_usd, turns: out.num_turns };
}

async function sendTelegram(text) {
  const env = Object.fromEntries(readFileSync(join(HOME, '.config/agent-tracking/telegram.env'), 'utf8')
    .split('\n').map(l => l.match(/^\s*([A-Z_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2].trim()]));
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true } }),
  });
  if (!res.ok) throw new Error(`Telegram sendMessage → ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

async function main() {
  const args = process.argv.slice(2);
  const send = args.includes('--send');
  const force = args.includes('--force');
  const dry = args.includes('--dry');
  const only = args.flatMap((a, i) => (a === '--repo' ? [args[i + 1]] : []));
  const now = new Date();
  const token = githubToken();
  const template = readFileSync(join(HERE, 'prompt.md'), 'utf8');
  const repos = parseRepos(readFileSync(CONFIG, 'utf8')).filter(r => !only.length || only.includes(r.name) || only.includes(r.repo));

  const sections = [];
  for (const cfg of repos) {
    const state = stateFor(cfg.name);
    const since = state.since ?? new Date(now.getTime() - DAY);
    let g;
    try {
      g = await gather(token, cfg, since, now);
    } catch (e) {
      // One repo's GitHub hiccup must not cost the others their brief.
      console.error(`${cfg.name}: could not read GitHub: ${e.message}${e.cause ? ` (${e.cause.code ?? e.cause.message})` : ''}`);
      sections.push({ ...cfg, text: `(could not read GitHub: ${e.message}; no brief for this repo today)` });
      continue;
    }
    const reasons = shouldBrief({ since, now, tz: TZ, activity: g.activity, open: g.open, verify: g.verify });
    if (!reasons.length && !force) { console.error(`${cfg.name}: quiet, skipped`); continue; }
    const prompt = template
      .replaceAll('{{REPO}}', cfg.repo).replace('{{TODAY}}', localDate(now, TZ))
      .replace('{{SINCE}}', state.since ? since.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'never (this is the first)')
      .replace('{{MATERIAL}}', `${material({ now, since, ...g })}\n\n## The previous briefs\n${state.previous.join('\n\n') || 'none'}`);
    if (dry) {
      const file = join(STATE, cfg.name, 'prompt.txt');
      writeFileSync(file, prompt);
      console.error(`${cfg.name}: would brief (${reasons.join(', ') || 'forced'}); prompt in ${file}`);
      continue;
    }
    console.error(`${cfg.name}: briefing (${reasons.join(', ') || 'forced'}), ${g.comments.size} stories, ${Math.round(prompt.length / 1000)}k chars of material`);
    try {
      const a = runAgent(cfg, prompt);
      console.error(`${cfg.name}: ${a.turns} turns, $${a.cost?.toFixed(2)}`);
      if (a.text === 'NOTHING') { state.save(now, '(nothing worth saying)'); continue; }
      sections.push({ ...cfg, ...a });
      if (send) state.save(now, a.text);
    } catch (e) {
      // Never silent: the label facts go out instead.
      const f = g.facts;
      const lines = [...f.due.map(i => `#${i.number} recheck ${i.recheck}`), ...f.verifyDue.map(i => `#${i.number} verify due ${i.on}`), ...f.quiet.map(i => `#${i.number} quiet ${i.days} days`)];
      sections.push({ ...cfg, text: `(the agent run failed: ${e.message})\n${lines.join('\n') || 'Nothing due.'}` });
    }
  }
  if (!sections.length) { console.error('nothing to brief'); return; }
  const html = `<b>${localDate(now, TZ)}</b>\n\n${toTelegram(sections)}`;
  console.log(html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
  if (send) {
    // One message when it fits, else one per repo.
    if (html.length <= 4000) await sendTelegram(html);
    else for (const s of sections) await sendTelegram(toTelegram([s]).slice(0, 4000));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error(e.message); process.exit(1); });
}
