# Data model, views, users, settings

All schema commands need the admin role.

## Objects

```bash
python3 <skill dir>/scripts/agentcrm.py objects list --site acme --json
python3 <skill dir>/scripts/agentcrm.py objects get deals --site acme --json
python3 <skill dir>/scripts/agentcrm.py objects create --site acme --singular Project --plural Projects --icon folder --json
python3 <skill dir>/scripts/agentcrm.py objects update projects --site acme --plural "Client projects" --json
python3 <skill dir>/scripts/agentcrm.py objects delete projects --site acme --json
```

Deleting an object deletes all its records (plan first).

## Fields

Types: text, longText, number, currency, percent, date, datetime, boolean, select, multiSelect, email, phone, url, relation, user, rating, address, tags.

```bash
python3 <skill dir>/scripts/agentcrm.py fields add --site acme --object deals --label "Contract type" --type select --options "New,Renewal,Upsell" --json
python3 <skill dir>/scripts/agentcrm.py fields add --site acme --object projects --label Client --type relation --relation-object companies --json
python3 <skill dir>/scripts/agentcrm.py fields update contractType --site acme --object deals --options "New,Renewal,Upsell,Cross-sell" --json
python3 <skill dir>/scripts/agentcrm.py fields delete contractType --site acme --object deals --json
```

`fields update --type <t>` converts existing values (the result reports what could not be converted). Standard fields can't be deleted.

## Views

```bash
python3 <skill dir>/scripts/agentcrm.py views list --site acme --object deals --json
python3 <skill dir>/scripts/agentcrm.py views create --site acme --object deals --name "Closing this month" --filter closeDate:withinDays:30 --sort closeDate --columns name,amount,stage,closeDate --shared --json
python3 <skill dir>/scripts/agentcrm.py views create --site acme --object deals --name Board --type kanban --group-by stage --json
python3 <skill dir>/scripts/agentcrm.py views delete <viewId> --site acme --json
```

## Users and roles

Roles: `admin` (everything), `member` (records, activities, own views, import / export), `viewer` (read only).

```bash
python3 <skill dir>/scripts/agentcrm.py users list --site acme --all --json
python3 <skill dir>/scripts/agentcrm.py users add --site acme --email sam@acme.com --name "Sam Rivera" --role member --json
python3 <skill dir>/scripts/agentcrm.py users role sam@acme.com admin --site acme --json
python3 <skill dir>/scripts/agentcrm.py users disable sam@acme.com --site acme --json
```

Firebase / git-json sites: the login itself is created on that service (Firebase Authentication, a repository collaborator).

## Settings

```bash
python3 <skill dir>/scripts/agentcrm.py settings get --site acme --json
python3 <skill dir>/scripts/agentcrm.py settings set --site acme --set name="Acme CRM" --set defaultCurrency=EUR --set locale=fr-FR --set staleDealDays=21 --json
```

Secrets are refused in settings.
