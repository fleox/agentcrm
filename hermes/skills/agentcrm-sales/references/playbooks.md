# Pipeline playbooks

## Signals of a deal at risk

- No activity for longer than `settings.staleDealDays` (report `stale`).
- Close date in the past while the deal is still open.
- No open task on the deal (nobody owns the next step).
- No contact linked (`contacts` empty) or a single contact (single-threaded).
- Stuck in the same stage much longer than other deals of that stage.
- Amount empty in Proposal or later.

## Next best action by stage

| Stage | Typical next step |
|---|---|
| New | Qualify: discovery call within 3 days; confirm need, budget owner, timing |
| Qualified | Book the demo / workshop with the decision maker; add the second contact |
| Proposal | Walk through the proposal live; ask for objections and the decision date |
| Negotiation | Align on terms; identify the signer and the paperwork; set a close plan |
| Won | Kick-off and handover task; ask for a referral after onboarding |
| Lost | Log the lost reason; set a reminder to reconnect in 3 to 6 months |

Always phrase the action as a task with an owner and a due date: `tasks add --title "…" --due <date> --assignee <owner> --record <dealId>`.

## Forecast hygiene

- Weighted forecast = amount x stage probability; moving a deal updates its probability.
- Deals past their close date inflate the forecast: propose new dates with the owner.
- Large deals without recent activity deserve a direct question to their owner.
