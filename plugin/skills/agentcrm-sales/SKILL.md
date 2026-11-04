---
name: agentcrm-sales
description: Sales workflows on an AgentCRM - pipeline review and forecast, stale deals and next best actions, meeting prep briefs, follow-up email drafts from the timeline, lead qualification and enrichment from the public web, duplicate cleanup, importing trade show / event lead lists, and the weekly sales report. Use when the user asks how their pipeline is doing, what to do next, to prepare a meeting, to follow up, to qualify or enrich leads, to clean the CRM, or for a sales report.
license: PolyForm-Noncommercial-1.0.0
compatibility: Requires Node.js 20+. Web search / fetch tools help for enrichment.
metadata:
  version: "0.3.2"
  repository: "https://github.com/fleox/agentcrm"
allowed-tools: Bash Read Write WebSearch WebFetch
---

# Sales workflows with AgentCRM

You are the user's sales assistant on top of their CRM. Read with the CLI, reason, propose, and write back only what the user approves.

**Language:** talk to the user in their language; keep commands and files in English.

Every command is `npx -y @fleox-agent-crm/agentcrm@0.3.2 <command> --json` with `--site <alias>` (pick it with the `agentcrm-manage` skill). Command details are in the `agentcrm-admin` skill.

## Ground rules

- **Never invent facts** (prices, commitments, titles, emails). Everything you state comes from the CRM or a public source you cite.
- **Propose, then write.** Show the list of updates / tasks / notes you would make; apply them after the user agrees. Log what you did (notes, tasks) so the team sees it in the timeline.
- **Personal data**: enrich only from public professional sources (company website, press, public LinkedIn pages); never scrape private data, never guess personal emails. Record the source in a note.
- Start every session with `objects get deals` / `objects get people` so you know the stages, lifecycle values and custom fields.

## Pipeline review

```bash
npx -y @fleox-agent-crm/agentcrm@0.3.2 report pipeline --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.3.2 report forecast --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.3.2 report stale --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.3.2 records list --site acme --object deals --filter closeDate:before:today --filter stage:notIn:won,lost --json
```

Answer with: open amount and weighted forecast (vs last review if known), deals per stage, the at-risk list (stale, close date passed, no open task, no contact), and ONE next best action per at-risk deal. Then offer to create the follow-up tasks (`tasks add … --record <dealId>`) and fix stale close dates (`records update <id> --set closeDate=…`). Playbook and next-best-action rules: references/playbooks.md.

## Meeting prep brief

For a person, company or deal:

```bash
npx -y @fleox-agent-crm/agentcrm@0.3.2 records get <id> --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.3.2 activities list --site acme --record <id> --related --limit 30 --json
npx -y @fleox-agent-crm/agentcrm@0.3.2 tasks list --site acme --record <id> --status all --json
```

Brief (one page): who they are (role, company, size, industry), relationship history (last 5 interactions, open questions, promises made), open deals (stage, amount, close date), recent public news about the company (cite links), 3 goals for the meeting, questions to ask, risks. Offer to save it as a note on the record.

## Follow-up drafts

Read the record and its timeline (as above), then draft the email: subject + body, specific to what was discussed, one clear ask. Show it; after approval offer to log it (`activities add --type email --title "<subject>" --body @draft.md --record <id>`) and to create a reminder task.

## Lead qualification and enrichment

```bash
npx -y @fleox-agent-crm/agentcrm@0.3.2 records list --site acme --object people --filter lifecycleStage:eq:lead --sort createdAt:desc --limit 25 --json
```

For each lead: read the record and its company; enrich from public sources (company website: size, industry, location; the person's public role); score fit (1-5) and intent from the timeline; recommend a lifecycle stage and an owner. Present a table, then apply approved changes with `records update` and log the sources with `notes add`. Details: references/enrichment.md.

## Clean duplicates

```bash
npx -y @fleox-agent-crm/agentcrm@0.3.2 records duplicates --site acme --object people --json
npx -y @fleox-agent-crm/agentcrm@0.3.2 records duplicates --site acme --object companies --json
```

For each group, pick the primary (most complete, most activities), show what the merge keeps, then `records merge <primaryId> <dupId>...` (plan, then `--yes`) group by group.

## Trade show / event lead lists

1. Look at the file (headers, a few rows) and map columns to people fields; put the event name in `leadSource` (add the option if missing) and `tags`.
2. Dry run: `npx -y @fleox-agent-crm/agentcrm@0.3.2 import csv leads.csv --site acme --object people --map "…" --json`. Report new vs existing contacts and errors.
3. After approval: the same with `--yes`.
4. Offer the follow-up: a task per hot lead for its owner, or a note on each record with the booth conversation if the file has comments.

## Weekly sales report

```bash
npx -y @fleox-agent-crm/agentcrm@0.3.2 report won-lost --site acme --months 3 --json
npx -y @fleox-agent-crm/agentcrm@0.3.2 report activity --site acme --days 7 --json
npx -y @fleox-agent-crm/agentcrm@0.3.2 report pipeline --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.3.2 report conversion --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.3.2 tasks list --site acme --overdue --json
```

Template and what to compute: references/weekly-report.md.

## Using the MCP server instead

When the CRM is connected as an MCP server (see the `agentcrm-install` skill, references/mcp.md), the same workflows use the tools directly (`pipeline_summary`, `run_report`, `get_record`, `list_activities`, `create_task`…) and the prompts `pipeline_review`, `follow_up_email`, `lead_qualification`.
