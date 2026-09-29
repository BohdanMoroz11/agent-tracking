// One-way mirror of GitHub issues into Jira (see ../RUNBOOK.md).
// GitHub is the source of truth; a Jira issue is found by its `gh-<number>`
// label and overwritten from the GitHub issue on every event. Edits made in
// Jira do not flow back.
//
//   node jira-sync.mjs discover          # print project, types, statuses; writes nothing
//   node jira-sync.mjs event             # sync the issue in $GITHUB_EVENT_PATH
//   node jira-sync.mjs backfill          # sync every open issue
//   DRY_RUN=true node jira-sync.mjs …    # log what would change, write nothing
//
// Env: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY, JIRA_ASSIGNEE_ACCOUNT_ID (optional),
//      GITHUB_TOKEN, GITHUB_REPOSITORY. The token is never printed.
import { readFileSync } from 'node:fs';

const env = name => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
};
const DRY = ['1', 'true'].includes(process.env.DRY_RUN ?? '');

// ---------------------------------------------------------------- mapping

export const TYPE_BY_LABEL = { bug: 'Bug', feature: 'Story' }; // everything else: Task
export const STATUS = { later: 'To Do', next: 'To Do', now: 'In Progress', blocked: 'Blocked', closed: 'Done' };
export const PRIORITY_BY_LABEL = { p1: 'High', p2: 'Medium', p3: 'Low' }; // unlabeled: Jira's default

// Jira labels cannot contain spaces; `tenant:tls` becomes `tenant-tls`.
export const jiraLabel = l => l.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');

export function mapIssue(gh) {
  const labels = gh.labels.map(l => (typeof l === 'string' ? l : l.name));
  const type = labels.map(l => TYPE_BY_LABEL[l]).find(Boolean) ?? 'Task';
  const state =
    gh.state.toLowerCase() === 'closed'
      ? 'closed'
      : ['now', 'blocked', 'next'].find(s => labels.includes(s)) ?? 'later';
  const jiraLabels = ['github', `gh-${gh.number}`, ...labels.map(jiraLabel).filter(Boolean)];
  const reason = (gh.state_reason ?? gh.stateReason ?? '').toLowerCase();
  if (state === 'closed' && reason === 'not_planned') jiraLabels.push('not-now');
  return {
    number: gh.number,
    summary: `${gh.title} (#${gh.number})`.slice(0, 250),
    type,
    status: STATUS[state],
    priority: labels.map(l => PRIORITY_BY_LABEL[l]).find(Boolean) ?? null,
    labels: [...new Set(jiraLabels)],
    description: toAdf(gh.body ?? '', gh.html_url ?? gh.url),
  };
}

// Just enough markdown → Atlassian Document Format for our issue bodies:
// headings, bullet/numbered lists, paragraphs, **bold**, `code`, [links](…).
export function toAdf(md, url) {
  const content = [
    { type: 'paragraph', content: [
      { type: 'text', text: 'Mirrored from GitHub — edit it there: ' },
      { type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] },
    ] },
  ];
  const lines = md.replace(/\r/g, '').replace(/<!--[\s\S]*?-->/g, '').split('\n');
  let para = null;
  let list = null;
  const flush = () => {
    if (para) content.push({ type: 'paragraph', content: para });
    if (list) content.push(list);
    para = list = null;
  };
  for (const line of lines) {
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    const item = line.match(/^\s*([-*]|\d+\.)\s+(.*)$/);
    if (!line.trim()) {
      flush();
    } else if (h) {
      flush();
      content.push({ type: 'heading', attrs: { level: Math.min(h[1].length + 1, 6) }, content: inline(h[2]) });
    } else if (item) {
      const kind = /\d/.test(item[1]) ? 'orderedList' : 'bulletList';
      if (para || (list && list.type !== kind)) flush();
      list ??= { type: kind, content: [] };
      list.content.push({ type: 'listItem', content: [{ type: 'paragraph', content: inline(item[2]) }] });
    } else if (list && /^\s+/.test(line)) {
      list.content.at(-1).content[0].content.push({ type: 'hardBreak' }, ...inline(line.trim()));
    } else {
      if (list) flush();
      if (para) para.push({ type: 'hardBreak' });
      para = [...(para ?? []), ...inline(line)];
    }
  }
  flush();
  return { type: 'doc', version: 1, content };
}

function inline(s) {
  const out = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (let m; (m = re.exec(s)); ) {
    if (m.index > last) out.push({ type: 'text', text: s.slice(last, m.index) });
    if (m[1]) out.push({ type: 'text', text: m[1], marks: [{ type: 'strong' }] });
    else if (m[2]) out.push({ type: 'text', text: m[2], marks: [{ type: 'code' }] });
    else out.push({ type: 'text', text: m[3], marks: [{ type: 'link', attrs: { href: m[4] } }] });
    last = re.lastIndex;
  }
  if (last < s.length) out.push({ type: 'text', text: s.slice(last) });
  return out.length ? out : [{ type: 'text', text: ' ' }];
}

// ---------------------------------------------------------------- clients

async function jira(method, path, body) {
  const auth = Buffer.from(`${env('JIRA_EMAIL')}:${env('JIRA_API_TOKEN')}`).toString('base64');
  const res = await fetch(env('JIRA_BASE_URL').replace(/\/$/, '') + path, {
    method,
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Jira ${method} ${path.split('?')[0]} → ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

async function github(method, path, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env('GITHUB_TOKEN')}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`GitHub ${method} ${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.status === 204 ? null : res.json();
}

async function githubAll(path) {
  const out = [];
  for (let page = 1; ; page++) {
    const batch = await github('GET', `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    out.push(...batch);
    if (batch.length < 100) return out;
  }
}

// ---------------------------------------------------------------- sync

export const TWIN_MARK = /^Mirrored to Jira as \[([A-Z][A-Z0-9]*-\d+)\]/;

// The twin is found first through the "Mirrored to Jira as KEY" comment this
// script leaves on the GitHub issue: GitHub reads are consistent at once, while
// Jira search can lag a few seconds, and an issue created with labels fires
// `opened` and `labeled` back to back. The label search is the fallback.
async function findTwin(project, number) {
  const comments = await githubAll(`/repos/${env('GITHUB_REPOSITORY')}/issues/${number}/comments`);
  const mark = comments.map(c => c.body?.match(TWIN_MARK)).find(Boolean);
  if (mark) {
    return jira('GET', `/rest/api/3/issue/${mark[1]}?fields=summary,status,issuetype,labels,assignee,priority`);
  }
  const r = await jira('POST', '/rest/api/3/search/jql', {
    jql: `project = "${project}" AND labels = "gh-${number}"`,
    fields: ['summary', 'status', 'issuetype', 'labels', 'assignee', 'priority'],
    maxResults: 2,
  });
  return r.issues?.[0] ?? null;
}

// A project whose screens lack the priority field rejects it with a 400; the
// sync then carries on without it rather than failing every event.
let priorityOk = true;
async function writeIssue(method, path, fields, priority) {
  if (!priority || !priorityOk) return jira(method, path, { fields });
  try {
    return await jira(method, path, { fields: { ...fields, priority: { name: priority } } });
  } catch (e) {
    if (!/→ 400:.*priority/i.test(e.message)) throw e;
    priorityOk = false;
    console.log(`  ! Jira refused the priority field, syncing without it: ${e.message}`);
    return jira(method, path, { fields });
  }
}

// New issues are assigned to JIRA_ASSIGNEE_ACCOUNT_ID, or to the token's owner
// when that is unset. Only an unassigned issue is touched: a reassignment made
// in Jira is kept, the one field this mirror leaves to Jira.
let defaultAssignee;
async function assigneeId() {
  defaultAssignee ??= process.env.JIRA_ASSIGNEE_ACCOUNT_ID || (await jira('GET', '/rest/api/3/myself')).accountId;
  return defaultAssignee;
}

async function syncOne(gh) {
  const project = env('JIRA_PROJECT_KEY');
  const m = mapIssue(gh);
  const twin = await findTwin(project, m.number);
  const fields = { summary: m.summary, description: m.description, labels: m.labels };
  let key = twin?.key;

  if (!twin) {
    console.log(`#${m.number} → create ${m.type} "${m.summary}" [${m.status}] priority=${m.priority ?? '-'} labels=${m.labels.join(',')}`);
    if (DRY) return;
    const created = await writeIssue('POST', '/rest/api/3/issue', {
      ...fields, project: { key: project }, issuetype: { name: m.type }, assignee: { accountId: await assigneeId() },
    }, m.priority);
    key = created.key;
    const browse = `${env('JIRA_BASE_URL').replace(/\/$/, '')}/browse/${key}`;
    await github('POST', `/repos/${env('GITHUB_REPOSITORY')}/issues/${m.number}/comments`, {
      body: `Mirrored to Jira as [${key}](${browse}). GitHub stays the source of truth; edits in Jira are overwritten.`,
    });
  } else {
    const typeNote = twin.fields.issuetype?.name !== m.type ? ` (type stays ${twin.fields.issuetype?.name}; wanted ${m.type})` : '';
    const who = twin.fields.assignee ? '' : ' (unassigned → assign)';
    const prio = m.priority && twin.fields.priority?.name !== m.priority ? ` (priority ${twin.fields.priority?.name ?? '-'} → ${m.priority})` : '';
    console.log(`#${m.number} → update ${key} [${twin.fields.status?.name} → ${m.status}]${typeNote}${who}${prio}`);
    if (DRY) return;
    const assign = twin.fields.assignee ? {} : { assignee: { accountId: await assigneeId() } };
    await writeIssue('PUT', `/rest/api/3/issue/${key}`, { ...fields, ...assign }, m.priority);
  }

  const current = twin?.fields.status?.name ?? null;
  if (current === m.status) return;
  const { transitions } = await jira('GET', `/rest/api/3/issue/${key}/transitions`);
  const t = transitions.find(x => x.to?.name?.toLowerCase() === m.status.toLowerCase());
  if (!t) {
    if (current !== null || m.status !== 'To Do') {
      console.log(`  ! no transition to "${m.status}" from ${key}; available: ${transitions.map(x => x.to?.name).join(', ')}`);
    }
    return;
  }
  await jira('POST', `/rest/api/3/issue/${key}/transitions`, { transition: { id: t.id } });
}

// Checks everything the mirror relies on, so a new project is verified before
// the first write: auth, the project, the issue types and statuses it maps to,
// priorities, and permissions.
async function discover() {
  const me = await jira('GET', '/rest/api/3/myself');
  console.log(`auth ok as: ${me.displayName} (${me.accountType})`);
  const key = env('JIRA_PROJECT_KEY');
  const proj = await jira('GET', `/rest/api/3/project/${key}`);
  console.log(`project ${key}: "${proj.name}" style=${proj.style}`);
  const types = proj.issueTypes.map(t => t.name);
  console.log(`issue types: ${types.join(', ')}`);
  const statuses = await jira('GET', `/rest/api/3/project/${key}/statuses`);
  for (const t of statuses) console.log(`  statuses for ${t.name}: ${t.statuses.map(s => s.name).join(' | ')}`);
  const prios = await jira('GET', '/rest/api/3/priority');
  console.log(`priorities: ${prios.map(p => p.name).join(', ')}`);
  const perms = await jira('GET', `/rest/api/3/mypermissions?projectKey=${key}&permissions=CREATE_ISSUES,EDIT_ISSUES,TRANSITION_ISSUES`);
  console.log(`permissions: ${Object.values(perms.permissions).map(p => `${p.key}=${p.havePermission}`).join(' ')}`);

  const problems = [];
  for (const t of new Set([...Object.values(TYPE_BY_LABEL), 'Task'])) {
    if (!types.includes(t)) problems.push(`issue type "${t}" is missing`);
  }
  const allStatuses = new Set(statuses.flatMap(t => t.statuses.map(s => s.name.toLowerCase())));
  for (const s of new Set(Object.values(STATUS))) {
    if (!allStatuses.has(s.toLowerCase())) problems.push(`status "${s}" is missing from the workflow`);
  }
  const prioNames = prios.map(p => p.name);
  for (const p of Object.values(PRIORITY_BY_LABEL)) {
    if (!prioNames.includes(p)) problems.push(`priority "${p}" does not exist`);
  }
  for (const p of Object.values(perms.permissions)) if (!p.havePermission) problems.push(`no ${p.key} permission`);
  console.log(problems.length ? `\nPROBLEMS:\n- ${problems.join('\n- ')}` : '\nready: everything the mirror needs is there');
  if (problems.length) process.exitCode = 1;
}

async function main() {
  const mode = process.argv[2];
  if (DRY) console.log('DRY RUN — nothing is written');
  if (mode === 'discover') return discover();
  if (mode === 'event') {
    const ev = JSON.parse(readFileSync(env('GITHUB_EVENT_PATH'), 'utf8'));
    if (ev.issue?.pull_request) return;
    return syncOne(ev.issue);
  }
  if (mode === 'backfill') {
    const issues = (await githubAll(`/repos/${env('GITHUB_REPOSITORY')}/issues?state=open&sort=created&direction=asc`))
      .filter(i => !i.pull_request);
    console.log(`backfill: ${issues.length} open issues`);
    for (const i of issues) await syncOne(i);
    return;
  }
  throw new Error('usage: jira-sync.mjs discover|event|backfill');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => {
    console.error(e.message);
    process.exit(1);
  });
}
