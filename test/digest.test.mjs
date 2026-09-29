import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseWaiting, render, shouldRun, summarize, TELEGRAM_LIMIT, toPlain } from '../digest/digest.mjs';

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

test('only the cron that lands on the local hour runs', () => {
  const summer = new Date('2026-07-01T05:03:00Z');
  const winter = new Date('2026-01-15T06:20:00Z');
  const run = (schedule, at) => shouldRun({ eventName: 'schedule', schedule, now: at, tz: TZ, hour: 8 });
  assert.equal(run('0 5 * * *', summer), true);
  assert.equal(run('0 6 * * *', summer), false);
  assert.equal(run('0 5 * * *', winter), false);
  assert.equal(run('0 6 * * *', winter), true);
  // A late start still counts: the cron decides, not the clock.
  assert.equal(run('0 5 * * *', new Date('2026-07-01T06:40:00Z')), true);
  assert.equal(shouldRun({ eventName: 'workflow_dispatch', now: summer, tz: TZ, hour: 8 }), true);
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
