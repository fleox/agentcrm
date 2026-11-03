# Records by object

Standard objects (always present; custom objects come on top):

- `companies`: name, domain, industry (select), employees, annualRevenue (currency), address, linkedin, phone, tags.
- `people`: firstName, lastName, name (computed), email (unique), phone, jobTitle, company (relation to companies), city, linkedin, lifecycleStage (subscriber, lead, mql, sql, opportunity, customer, evangelist), leadSource, tags.
- `deals`: name, amount (currency), pipeline, stage, closeDate, probability, company (relation), contacts (relation to people, many), lostReason.

Always confirm with `objects get <object>`: admins add fields and options.

## Examples

```bash
# A company and its contact
python3 <skill dir>/scripts/agentcrm.py records create --site acme --object companies --set name="Globex" --set domain=globex.com --set industry=software --json
python3 <skill dir>/scripts/agentcrm.py records create --site acme --object people --fields @grace.json --json

# A deal linked to both
python3 <skill dir>/scripts/agentcrm.py records create --site acme --object deals --fields '{"name":"Globex pilot","amount":12000,"closeDate":"2026-12-15","company":"<companyId>","contacts":["<personId>"]}' --json

# Leads created this week, without an owner
python3 <skill dir>/scripts/agentcrm.py records list --site acme --object people --filter lifecycleStage:eq:lead --filter createdAt:withinDays:-7 --filter ownerId:empty --json

# Assign an owner
python3 <skill dir>/scripts/agentcrm.py records update <id> --site acme --owner <userId> --json
```

`records get` returns `relations` (records this one points to) and `related` (records pointing to it, e.g. a company's people and deals) plus `activityCount`.

Soft delete keeps the record restorable (`records restore`) until `compact`; `--hard` removes at once (also asks for `--yes`).
