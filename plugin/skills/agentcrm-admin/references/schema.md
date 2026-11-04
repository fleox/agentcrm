# Data model, views, users, settings

All schema commands need the admin role.

## Objects

```bash
npx -y @fleox-agent-crm/agentcrm@0.9.2 objects list --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 objects get deals --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 objects create --site acme --singular Project --plural Projects --icon folder --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 objects update projects --site acme --plural "Client projects" --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 objects delete projects --site acme --json
```

Deleting an object deletes all its records (plan first).

## Fields

Types: text, longText, number, currency, percent, date, datetime, boolean, select, multiSelect, email, phone, url, relation, user, rating, address, tags, image (one picture; the first one becomes the record avatar), files (attachments).

```bash
npx -y @fleox-agent-crm/agentcrm@0.9.2 fields add --site acme --object deals --label "Contract type" --type select --options "New,Renewal,Upsell" --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 fields add --site acme --object projects --label Client --type relation --relation-object companies --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 fields update contractType --site acme --object deals --options "New,Renewal,Upsell,Cross-sell" --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 fields delete contractType --site acme --object deals --json
```

`fields update --type <t>` converts existing values (the result reports what could not be converted). Standard fields can't be deleted.

## Views

```bash
npx -y @fleox-agent-crm/agentcrm@0.9.2 views list --site acme --object deals --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 views create --site acme --object deals --name "Closing this month" --filter closeDate:withinDays:30 --sort closeDate --columns name,amount,stage,closeDate --shared --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 views create --site acme --object deals --name Board --type kanban --group-by stage --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 views delete <viewId> --site acme --json
```

## Users and roles

Roles: `admin` (everything), `member` (records, activities, own views, import / export), `viewer` (read only).

```bash
npx -y @fleox-agent-crm/agentcrm@0.9.2 users list --site acme --all --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 users add --site acme --email sam@acme.com --name "Sam Rivera" --role member --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 users role sam@acme.com admin --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 users disable sam@acme.com --site acme --json
```

Firebase / git-json sites: the login itself is created on that service (Firebase Authentication, a repository collaborator).

## Settings

```bash
npx -y @fleox-agent-crm/agentcrm@0.9.2 settings get --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 settings set --site acme --set name="Acme CRM" --set defaultCurrency=EUR --set locale=fr-FR --set staleDealDays=21 --json
```

Secrets are refused in settings.
