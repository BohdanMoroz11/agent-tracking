import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseVerify, parseWaiting, render, summarize, TELEGRAM_LIMIT, toPlain } from '../digest/digest.mjs';

const TZ = 'Europe/Kyiv';
const now = new Date('2026-09-30T05:10:00Z'); // 08:10 in Kyiv
const ago = days => new Date(now.getTime() - days * 864e5).toISOString();
let n = 0;
const issue = (labels, over = {}) => ({
  number: ++n, title: `issue ${n}`, html_url: `https://gh/${n}`, body: '', labels: labels.map(name => ({ name })),
  created_at: ago(30), updated_at: ago(1), ...over,
});

test('the Waiting line is parsed', () => {
  assert.deepEqual(parseWaiting('**Waiting on:** Twilio support · **Recheck:** 2026-10-01\n\n## What'), {
    who: 'Twilio support', recheck: '2026-10-01',
  });
  assert.deepEqual(parseWaiting('## What\nnothing'), { who: null, recheck: null });
  assert.deepEqual(parseWaiting(null), { who: null, recheck: null });
});

test('the digest sorts issues into what needs the user and what is in flight', () => {
  const due = issue(['ops', 'blocked', 'p2'], { body: '**Waiting on:** TLS · **Recheck:** 2026-09-29' });
  const notYet = issue(['ops', 'blocked', 'p3'], { body: '**Waiting on:** AWS · **Recheck:** 2026-10-12' });
  const p1Idle = issue(['bug', 'p1']);
  const quiet = issue(['bug', 'now', 'p2'], { updated_at: ago(9) });
  const busy = issue(['feature', 'now', 'p1']);
  const messy = issue(['next', 'now']);
  const nextA = issue(['bug', 'next', 'p2']);
  const nextB = issue(['bug', 'next', 'p1']);
  const backlog = issue(['feature', 'p3']);
  const later = issue(['feature', 'p2']);
  const fresh = issue(['bug', 'p2'], { created_at: ago(0.5) });
  const closed = [
    { number: 90, title: 'done', html_url: 'u', closed_at: ago(0.2), state_reason: 'completed' },
    { number: 91, title: 'dropped', html_url: 'u', closed_at: ago(0.3), state_reason: 'not_planned' },
    { number: 92, title: 'old', html_url: 'u', closed_at: ago(3), state_reason: 'completed' },
  ];
  const s = summarize({ open: [due, notYet, p1Idle, quiet, busy, messy, nextA, nextB, backlog, later, fresh], closed, now, tz: TZ });

  assert.equal(s.today, '2026-09-30');
  assert.deepEqual(s.due.map(i => i.number), [due.number]);
  assert.deepEqual(s.p1NoState.map(i => i.number), [p1Idle.number]);
  assert.deepEqual(s.quiet.map(i => [i.number, i.days]), [[quiet.number, 9]]);
  assert.deepEqual(s.labelProblems.map(i => [i.number, i.problem]), [[messy.number, 'no priority, no type, 2 state labels']]);
  assert.deepEqual(s.next.map(i => i.number), [nextB.number, nextA.number, messy.number]);
  assert.deepEqual(s.blocked.map(i => i.number), [due.number, notYet.number]);
  assert.equal(s.backlog, 1);
  assert.equal(s.later, 3); // p1Idle, later, fresh
  assert.deepEqual(s.closed.map(i => [i.number, i.notPlanned]), [[90, false], [91, true]]);
  assert.deepEqual(s.opened.map(i => i.number), [fresh.number]);

  const text = render('cargo-finance', s);
  assert.match(text, /<b>cargo-finance<\/b> · 2026-09-30/);
  assert.match(toPlain(text), /recheck 2026-09-29, waiting on TLS/);
  assert.match(toPlain(text), /✗ #91 dropped/);
});

test('blocked with no Recheck date is a label problem', () => {
  const s = summarize({ open: [issue(['ops', 'blocked', 'p2'])], closed: [], now, tz: TZ });
  assert.match(s.labelProblems[0].problem, /no Recheck/);
});

test('titles are escaped and a long digest fits in one Telegram message', () => {
  const open = Array.from({ length: 200 }, () => issue(['bug', 'next', 'p2'], { title: 'a <b> & c '.repeat(10) }));
  const s = summarize({ open: open.map(i => ({ ...i, labels: [{ name: 'feature' }, { name: 'now' }, { name: 'p2' }] })), closed: [], now, tz: TZ });
  const text = render('r', s);
  assert.ok(text.length <= TELEGRAM_LIMIT);
  assert.doesNotMatch(text, /<b> &/);
  assert.match(text, /truncated/);
});

test('an empty repo says nothing needs the user', () => {
  assert.match(toPlain(render('r', summarize({ open: [], closed: [], now, tz: TZ }))), /Needs you\nNothing\./);
});

test('the Verify line is parsed', () => {
  assert.deepEqual(parseVerify('**Verify:** handoff line once, expected near zero · **On:** 2026-10-06\n\n## What'), {
    what: 'handoff line once, expected near zero', on: '2026-10-06',
  });
  assert.deepEqual(parseVerify('nothing'), { what: null, on: null });
});

test('closed fixes labelled verify come back on their date, and wait until then', () => {
  const closedFix = (on, over = {}) => ({
    number: ++n, title: `fix ${n}`, html_url: `https://gh/${n}`, labels: [{ name: 'verify' }, { name: 'p2' }],
    body: on ? `**Verify:** limit_hit near zero · **On:** ${on}` : 'no line', ...over,
  });
  const due = closedFix('2026-09-30');
  const later = closedFix('2026-10-06');
  const undated = closedFix(null);
  const openWithVerify = issue(['bug', 'p2', 'verify']);
  const s = summarize({ open: [openWithVerify], closed: [], verify: [later, due, undated], now, tz: TZ });

  assert.deepEqual(s.verifyDue.map(i => i.number), [due.number]);
  assert.deepEqual(s.verifyLater.map(i => [i.number, i.on]), [[later.number, '2026-10-06']]);
  assert.deepEqual(s.labelProblems.map(i => i.number).sort(), [openWithVerify.number, undated.number].sort());

  const text = toPlain(render('r', s));
  assert.match(text, new RegExp(`#${due.number} fix ${due.number} — verify: limit_hit near zero \\(due 2026-09-30\\)`));
  assert.match(text, new RegExp(`Verifying \\(1\\)\\n• p2 #${later.number} fix ${later.number} — on 2026-10-06`));
});
