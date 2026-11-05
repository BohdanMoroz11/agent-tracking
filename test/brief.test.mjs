import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRepos, shouldBrief, toTelegram } from '../brief/brief.mjs';

const TZ = 'Europe/Kyiv';
const at = s => new Date(`${s}T06:00:00Z`);
const issue = body => ({ body, labels: [] });

test('repos file: checkout and title are optional', () => {
  const [a, b] = parseRepos('# comment\nAltekLLC/hr-ai\nBohdanMoroz11/shipper-portal ~/w/sp CargoHub Portal  # note\n\n');
  assert.equal(a.name, 'hr-ai');
  assert.match(a.checkout, /\/projects\/hr-ai$/);
  assert.equal(a.title, 'hr-ai');
  assert.match(b.checkout, /\/w\/sp$/);
  assert.ok(!b.checkout.startsWith('~'));
  assert.equal(b.title, 'CargoHub Portal');
});

test('a quiet repo speaks only when a date comes due, or on Monday if anything is overdue', () => {
  const open = [issue('**Waiting on:** Meta · **Recheck:** 2026-11-03')];
  const verify = [issue('**Verify:** x · **On:** 2026-11-05')];
  // Thursday 11-05: the verify date came due since Wednesday's brief.
  assert.deepEqual(shouldBrief({ since: at('2026-11-04'), now: at('2026-11-05'), tz: TZ, activity: false, open, verify }), ['came due']);
  // Friday: both dates are old news, nothing happened.
  assert.deepEqual(shouldBrief({ since: at('2026-11-05'), now: at('2026-11-06'), tz: TZ, activity: false, open, verify }), []);
  // Monday: overdue items get raised again.
  assert.deepEqual(shouldBrief({ since: at('2026-11-06'), now: at('2026-11-09'), tz: TZ, activity: false, open, verify }), ['Monday, overdue items']);
  assert.deepEqual(shouldBrief({ since: at('2026-11-06'), now: at('2026-11-07'), tz: TZ, activity: true, open: [], verify: [] }), ['activity']);
});

test('telegram: escapes, links issue numbers, and adds the resume line', () => {
  const html = toTelegram([{ repo: 'o/r', title: 'r', checkout: '/x/r', sessionId: 'abc', text: 'PR #12 for (#7) & Q1: close #3?' }]);
  assert.match(html, /^<b>r<\/b>\n/);
  assert.match(html, /PR <a href="https:\/\/github.com\/o\/r\/issues\/12">#12<\/a>/);
  assert.match(html, /\(<a href="https:\/\/github.com\/o\/r\/issues\/7">#7<\/a>\) &amp; Q1/);
  assert.match(html, /<code>cd \/x\/r &amp;&amp; claude --resume abc<\/code>$/);
  assert.doesNotMatch(toTelegram([{ repo: 'o/r', title: 'r', checkout: '/x', text: 'a&#39;b' }]), /href/);
});
