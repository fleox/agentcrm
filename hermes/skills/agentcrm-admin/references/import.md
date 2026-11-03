# CSV import

1. Dry run (default): `import csv <file> --object <id> --site <alias> --json`.
2. Read `data.mapping` (header to field id; `""` = skipped), `unmappedColumns`, `created` / `updated` / `skipped` / `failed`, `rows[]` (per row: action, id, messages), `newOptions` (select values that will be added), `createdRelated` (companies created from a company column).
3. Fix the mapping if needed: `--map '{"E-mail":"email","Societe":"company","Source":"leadSource"}'` or `--map "E-mail=email,Societe=company"`. Special targets: `$id` (update by record id), `$owner` (owner by email or name), `""` (skip).
4. Apply with `--yes`.

## Rules

- **Dedupe**: people by email, companies by domain, other objects by their label field. `--dedupe update` (default) fills the existing record, `skip` leaves it, `create` makes a new one anyway.
- **Coercion**: numbers accept `1 200,50` and `$1,200.50`; dates accept ISO, `DD/MM/YYYY` with `--day-first`; booleans yes / no / true / false / 1 / 0; multi values split on `,` `;` `|`.
- **Relations**: a `company` column with a name or domain links the person to that company, creating it when missing (`createdRelated`).
- **Delimiter** is detected (`,` `;` tab); force it with `--delimiter ";"`.
- Re-importing an `export csv` file updates the same records (its first column is the id).

Show the user the counts and the errors before applying; never apply an import with unexplained errors.
