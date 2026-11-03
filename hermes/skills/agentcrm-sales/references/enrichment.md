# Lead enrichment from the public web

Allowed sources: the company's own website (about, team, pricing, careers, press pages), reputable press, public company registries, the person's public professional profile. Not allowed: guessing personal emails, private profiles, data brokers, anything behind a login.

For each lead:

1. Company: confirm the domain from the email; read the website for industry, size range, location, products. Update `companies` fields (`industry`, `employees`, `address`, `linkedin`) only with values you found.
2. Person: public role and seniority; update `jobTitle` only if found.
3. Fit score (1-5): match with the user's ideal customer (ask the user for it once and keep it in a note on the CRM settings or in this conversation).
4. Intent: from the CRM timeline (form submissions, emails, meetings).
5. Recommendation: lifecycle stage (lead, mql, sql), owner, next action.

Log each enrichment: `notes add <recordId> --body "Enriched from <url> on <date>: …"`. Present everything as a table before writing; write only what the user approves.
