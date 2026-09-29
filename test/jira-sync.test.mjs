import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jiraLabel, mapIssue, toAdf, TWIN_MARK } from '../jira-sync/jira-sync.mjs';

const issue = (over = {}) => ({
  number: 7, title: 'Loads vanish', state: 'open', body: '', html_url: 'https://github.com/o/r/issues/7', labels: [], ...over,
});

test('type, state and priority come from the labels', () => {
  const m = mapIssue(issue({ labels: [{ name: 'bug' }, { name: 'now' }, { name: 'p1' }] }));
  assert.equal(m.type, 'Bug');
  assert.equal(m.status, 'In Progress');
  assert.equal(m.priority, 'High');
  assert.equal(m.summary, 'Loads vanish (#7)');
});

test('an issue with no labels is a To Do task with Jira default priority', () => {
  const m = mapIssue(issue());
  assert.deepEqual([m.type, m.status, m.priority], ['Task', 'To Do', null]);
});

test('closed wins over any state label, and not planned is marked', () => {
  const m = mapIssue(issue({ state: 'closed', state_reason: 'not_planned', labels: ['now'] }));
  assert.equal(m.status, 'Done');
  assert.ok(m.labels.includes('not-now'));
});

test('blocked beats next when both are set', () => {
  assert.equal(mapIssue(issue({ labels: ['next', 'blocked'] })).status, 'Blocked');
});

test('labels are made safe for Jira and keep the gh-N link', () => {
  assert.equal(jiraLabel('tenant:tls'), 'tenant-tls');
  assert.equal(jiraLabel('Good First Issue'), 'good-first-issue');
  const m = mapIssue(issue({ labels: ['tenant:tls'] }));
  assert.deepEqual(m.labels, ['github', 'gh-7', 'tenant-tls']);
});

test('the description links back to GitHub and converts markdown', () => {
  const adf = toAdf('## What\n- **one** `two`\n- [three](https://x.y)\n\npara', 'https://gh/7');
  assert.equal(adf.content[0].content[1].marks[0].attrs.href, 'https://gh/7');
  assert.equal(adf.content[1].type, 'heading');
  const list = adf.content[2];
  assert.equal(list.type, 'bulletList');
  assert.deepEqual(list.content[0].content[0].content.map(n => n.marks?.[0].type ?? 'text'), ['strong', 'text', 'code']);
  assert.equal(adf.content[3].type, 'paragraph');
});

test('HTML comments in the body are dropped', () => {
  const adf = toAdf('<!-- template hint -->\nreal', 'u');
  assert.equal(adf.content.length, 2);
  assert.equal(adf.content[1].content[0].text, 'real');
});

test('the twin comment is recognised', () => {
  assert.equal('Mirrored to Jira as [CF-12](https://x/browse/CF-12). …'.match(TWIN_MARK)[1], 'CF-12');
});
