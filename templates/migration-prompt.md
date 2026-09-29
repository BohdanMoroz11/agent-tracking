Move this repo's work tracking into GitHub issues. Read the "Work tracking" and "Work tracking in this repo" sections of AGENTS.md first; they define the labels and the rules.

1. **Find everything that tracks work** rather than describing the system: status or roadmap docs, backlogs, "known issues", "planned features", TODO lists, checklists of pending confirmations, status lines in plan indexes, "next steps" sections, and open questions waiting on someone. Also note any status that is stale (a plan marked "not started" that the code or git history shows shipped).

2. **Verify each item before proposing it.** Check the code, git log and merged PRs: an item that already shipped is not an issue. Record what you checked.

3. **Write the proposal to a scratch file, not to GitHub.** One entry per issue: title, type, priority, state, extra labels, the Waiting line if any, and a body (what, evidence with its source, done when). Then list separately:
   - items you dropped, and why (shipped, obsolete, duplicate);
   - docs to archive or trim, and the status text to delete from them;
   - anything you could not decide.

4. **Stop and show the user the proposal.** Create nothing until they approve it. They will edit it.

5. After approval: create the issues with `gh issue create` (search first for duplicates), then make the doc changes in one commit, separate from any code, so that docs keep describing how the system works and link issues instead of tracking progress. Report the issue numbers.
