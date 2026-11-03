# Weekly sales report

Compute from the reports (last 7 days unless the user says otherwise):

- **Headline**: open pipeline, weighted forecast, won this week (count, amount), lost this week (count, top reasons).
- **Movement**: deals created, deals that moved forward, deals that slipped (close date pushed).
- **Activity**: calls, emails, meetings, notes per user (report `activity --days 7`).
- **Funnel**: lifecycle conversion (report `conversion`).
- **Risks**: stale deals (report `stale`), overdue tasks (`tasks list --overdue`).
- **Next week**: deals expected to close (closeDate within 7 days), meetings booked.

Format (Markdown, short):

```
# Sales week <date range>
Open pipeline: <amount> (weighted <amount>) | Won: <n> / <amount> | Lost: <n>
## Highlights
- …
## At risk
| Deal | Owner | Stage | Amount | Why | Next step |
## Activity by rep
| Rep | Calls | Emails | Meetings |
## Next week
- …
```

Offer to save it as a note on a "Weekly reports" record or to export it as a file; never send it anywhere without the user.
