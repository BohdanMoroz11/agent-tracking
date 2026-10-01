// Daily digest of a repo's issues, sent to Telegram (see ../RUNBOOK.md).
// It reads the labels and the Waiting line the tracking rules define, and
// reports what needs the user, what is in flight, and the last 24 hours.
// It stores nothing, so it cannot go stale.
//
//   node digest.mjs                                  # in Actions: $GITHUB_REPOSITORY → Telegram
//                                                    # (started at 08:00 Kyiv by the devbox timer, HOW-IT-WORKS.md)
//   node digest.mjs --print --repo owner/a --repo owner/b   # locally: print, send nothing
//
// Env (Actions): GITHUB_TOKEN, GITHUB_REPOSITORY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
//                DIGEST_TZ (default Europe/Kyiv, for the date), DIGEST_TITLE (optional).
// Locally the GitHub token comes from GITHUB_TOKEN or `gh auth token`.
import { execSync } from 'node:child_process';

const DAY = 24 * 60 * 60 * 1000;
export const QUIET_DAYS = 7;
const NEXT_SHOWN = 5;
const STATES = ['now', 'next', 'blocked'];
const TYPES = ['bug', 'feature', 'refactor', 'ops', 'investigation'];

// ---------------------------------------------------------------- pure logic

export const labelsOf = issue => issue.labels.map(l => (typeof l === 'string' ? l : l.name));

// `**Waiting on:** <who> · **Recheck:** YYYY-MM-DD`, at the top of the body.
export function parseWaiting(body) {
  const who = body?.match(/\*\*Waiting on:\*\*\s*(.+?)\s*(?:·|$)/m)?.[1]?.trim() ?? null;
  const recheck = body?.match(/\*\*Recheck:\*\*\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
  return { who, recheck };
}

// `**Verify:** <what to measure, expected result> · **On:** YYYY-MM-DD`, on a
// closed issue labelled `verify`: a shipped fix whose proof needs time or data.
export function parseVerify(body) {
  const what = body?.match(/\*\*Verify:\*\*\s*(.+?)\s*(?:·|$)/m)?.[1]?.trim() ?? null;
  const on = body?.match(/\*\*On:\*\*\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
  return { what, on };
}

export function localDate(now, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const prioOf = labels => labels.find(l => /^p[1-3]$/.test(l)) ?? null;
const byPriority = (a, b) => (a.prio ?? 'p9').localeCompare(b.prio ?? 'p9') || a.number - b.number;

export function summarize({ open, closed, verify = [], now, tz }) {
  const today = localDate(now, tz);
  const since = now.getTime() - DAY;
  const quietBefore = now.getTime() - QUIET_DAYS * DAY;
  const items = open.map(i => {
    const labels = labelsOf(i);
    const states = STATES.filter(s => labels.includes(s));
    return {
      number: i.number, title: i.title, url: i.html_url, labels, states,
      prio: prioOf(labels), ...parseWaiting(i.body),
      updated: Date.parse(i.updated_at), created: Date.parse(i.created_at),
    };
  });
  const has = (i, l) => i.labels.includes(l);
  const labelProblems = [];
  for (const i of items) {
    const p = [];
    if (!i.prio) p.push('no priority');
    if (!TYPES.some(t => has(i, t))) p.push('no type');
    if (i.states.length > 1) p.push(`${i.states.length} state labels`);
    if (has(i, 'blocked') && !i.recheck) p.push('blocked with no Recheck date');
    if (has(i, 'verify')) p.push('`verify` on an open issue: it belongs on the closed fix');
    if (p.length) labelProblems.push({ ...i, problem: p.join(', ') });
  }
  const backlog = items.filter(i => i.prio === 'p3' && !i.states.length);
  const verifying = verify.filter(i => !i.pull_request).map(i => ({
    number: i.number, title: i.title, url: i.html_url, prio: prioOf(labelsOf(i)), ...parseVerify(i.body),
  }));
  for (const v of verifying) if (!v.on) labelProblems.push({ ...v, problem: '`verify` with no **Verify:** … **On:** date line' });
  return {
    today,
    due: items.filter(i => (has(i, 'now') || has(i, 'blocked')) && i.recheck && i.recheck <= today).sort(byPriority),
    p1NoState: items.filter(i => i.prio === 'p1' && !i.states.length),
    quiet: items.filter(i => has(i, 'now') && i.updated < quietBefore)
      .map(i => ({ ...i, days: Math.floor((now.getTime() - i.updated) / DAY) })).sort(byPriority),
    labelProblems,
    verifyDue: verifying.filter(v => v.on && v.on <= today).sort((a, b) => a.on.localeCompare(b.on)),
    verifyLater: verifying.filter(v => v.on && v.on > today).sort((a, b) => a.on.localeCompare(b.on)),
    now: items.filter(i => has(i, 'now')).sort(byPriority),
    blocked: items.filter(i => has(i, 'blocked')).sort((a, b) => (a.recheck ?? '9').localeCompare(b.recheck ?? '9')),
    next: items.filter(i => has(i, 'next')).sort(byPriority),
    backlog: backlog.length,
    later: items.filter(i => !i.states.length).length - backlog.length,
    closed: closed.filter(i => Date.parse(i.closed_at) >= since && !i.pull_request)
      .map(i => ({ number: i.number, title: i.title, url: i.html_url, notPlanned: i.state_reason === 'not_planned' })),
    opened: items.filter(i => i.created >= since),
  };
}

// ---------------------------------------------------------------- rendering (Telegram HTML)

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const clip = (s, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const ref = i => `<a href="${esc(i.url)}">#${i.number}</a>`;
const line = (i, extra = '') => `• ${i.prio ? `${i.prio} ` : ''}${ref(i)} ${esc(clip(i.title))}${extra}`;
export const TELEGRAM_LIMIT = 4096;
const RECENT_SHOWN = 10;
const capped = (list, fmt) =>
  [...list.slice(0, RECENT_SHOWN).map(fmt), ...(list.length > RECENT_SHOWN ? [`  …and ${list.length - RECENT_SHOWN} more`] : [])];

export function render(title, s) {
  const out = [`<b>${esc(title)}</b> · ${s.today}`, ''];
  const needs = [
    ...s.due.map(i => line(i, ` — recheck ${i.recheck}${i.who ? `, waiting on ${esc(i.who)}` : ''}`)),
    ...s.verifyDue.map(i => line(i, ` — verify${i.what ? `: ${esc(i.what)}` : ''} (due ${i.on})`)),
    ...s.p1NoState.map(i => line(i, ' — p1 with no state')),
    ...s.quiet.map(i => line(i, ` — <code>now</code>, quiet ${i.days} days`)),
    ...s.labelProblems.map(i => line(i, ` — ${esc(i.problem)}`)),
  ];
  out.push('<b>Needs you</b>', ...(needs.length ? needs : ['Nothing.']), '');
  if (s.now.length) out.push(`<b>Now</b> (${s.now.length})`, ...s.now.map(i => line(i, i.who ? ` — waiting on ${esc(i.who)}` : '')), '');
  if (s.blocked.length) {
    out.push(`<b>Blocked</b> (${s.blocked.length})`,
      ...s.blocked.map(i => line(i, ` — ${esc(i.who ?? '?')}${i.recheck ? `, recheck ${i.recheck}` : ''}`)), '');
  }
  if (s.verifyLater.length) {
    out.push(`<b>Verifying</b> (${s.verifyLater.length})`, ...s.verifyLater.map(i => line(i, ` — on ${i.on}`)), '');
  }
  if (s.next.length) {
    out.push(`<b>Next</b> (${s.next.length})`, ...s.next.slice(0, NEXT_SHOWN).map(i => line(i)));
    if (s.next.length > NEXT_SHOWN) out.push(`  …and ${s.next.length - NEXT_SHOWN} more`);
    out.push('');
  }
  out.push(`<b>Last 24h</b>: ${s.closed.length} closed, ${s.opened.length} opened`,
    ...capped(s.closed, i => `• ${i.notPlanned ? '✗' : '✓'} ${ref(i)} ${esc(clip(i.title))}`),
    ...capped(s.opened, i => line(i, ' — new')), '');
  out.push(`Later: ${s.later} · Backlog: ${s.backlog}`);
  return fit(out);
}

// Telegram rejects a message over 4096 characters; drop list lines from the
// end until it fits, rather than cutting through an HTML tag.
function fit(lines) {
  let text = lines.join('\n');
  const kept = [...lines];
  while (text.length > TELEGRAM_LIMIT - 40) {
    const idx = kept.findLastIndex(l => l.startsWith('•'));
    if (idx < 0) break;
    kept.splice(idx, 1);
    text = `${kept.join('\n')}\n(truncated: see the issues list)`;
  }
  return text;
}

export const toPlain = html =>
  html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// ---------------------------------------------------------------- I/O

async function github(token, path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (!res.ok) throw new Error(`GitHub GET ${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function issues(token, repo, query) {
  const out = [];
  for (let page = 1; ; page++) {
    const batch = await github(token, `/repos/${repo}/issues?${query}&per_page=100&page=${page}`);
    out.push(...batch.filter(i => !i.pull_request));
    if (batch.length < 100) return out;
  }
}

async function digestFor(token, repo, now, tz, title) {
  const since = new Date(now.getTime() - DAY).toISOString();
  const [open, closed, verify] = await Promise.all([
    issues(token, repo, 'state=open'),
    issues(token, repo, `state=closed&since=${since}`),
    issues(token, repo, 'state=closed&labels=verify'),
  ]);
  return render(title ?? repo.split('/')[1], summarize({ open, closed, verify, now, tz }));
}

async function sendTelegram(text) {
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true } }),
  });
  if (!res.ok) throw new Error(`Telegram sendMessage → ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

async function main() {
  const args = process.argv.slice(2);
  const tz = process.env.DIGEST_TZ || 'Europe/Kyiv';
  const now = new Date();

  if (args.includes('--print')) {
    const repos = args.flatMap((a, i) => (a === '--repo' ? [args[i + 1]] : []));
    if (!repos.length) throw new Error('usage: digest.mjs --print --repo owner/name [--repo …]');
    const token = process.env.GITHUB_TOKEN || execSync('gh auth token', { encoding: 'utf8' }).trim();
    for (const repo of repos) console.log(`${toPlain(await digestFor(token, repo, now, tz))}\n`);
    return;
  }

  for (const name of ['GITHUB_TOKEN', 'GITHUB_REPOSITORY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID']) {
    if (!process.env[name]) throw new Error(`${name} is not set`);
  }
  const text = await digestFor(process.env.GITHUB_TOKEN, process.env.GITHUB_REPOSITORY, now, tz, process.env.DIGEST_TITLE || undefined);
  console.log(toPlain(text));
  await sendTelegram(text);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => {
    console.error(e.message);
    process.exit(1);
  });
}
