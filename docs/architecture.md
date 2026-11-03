# Architecture

AgentCRM is a CRM with **no server of its own**. Four front doors share one engine; the engine talks to one storage API; the storage is the user's.

```text
 Browser admin (React SPA)   agentcrm CLI   MCP server (stdio)   AI assistant (browser)
            \                    |                 |                    /
             \                   |                 |                   /
              +----------------- src/ops/ — the business engine -----+
              |   records · relations · activities · pipelines · schema · views
              |   users · settings · import/export · dedupe · reports
              |   automations · forms · compact · stats        (+ src/ai/tools.ts)
              +--------------------------- DataStore API -------------------+
                     |              |               |              |
             journal (encrypted)  git-json       firebase        local
             S3 / git / folder    private repo   Firestore       IndexedDB
```

## Layers

- `src/core/` — pure domain: types, field validation and formatting, query (filters / sorts / pagination), search index, ids, hybrid logical clock, plugin action registry, standard objects.
- `src/data/` — the `DataStore` API (`ready`, synchronous `list` / `get`, optimistic `write(mutations)`, `subscribe`, `refresh`, `identity`, `compact`) and its backends. The whole dataset is held in memory: perfect for small and medium teams, not for millions of records.
- `src/ops/` — every business rule. Each op takes an `OpsContext { store, user, now, plugins }`, checks the role, validates through `core/fields`, writes through `store.write`, then emits plugin actions (`record.created`, `stage.changed`…). The automations engine subscribes to those actions.
- `src/ai/tools.ts` — the AI tool catalog (name, description, JSON schema, `mutating`, handler calling ops). Exposed identically by the MCP server, the assistant and `agentcrm tools`.
- `src/features/` — the admin UI, one folder per feature; `src/app/` the shell.
- `src/shared/` — infrastructure copied from AgentCMS: storage connectors (S3 SigV4, git pages, local folder, browser mirror, memory), git transport, crypto.

## The CLI (`agent/`)

- `agent/bin.ts` installs `agent/browserEnv.ts` (an in-memory `window` + `localStorage`) so the browser-written modules run unchanged in Node, then `agent/cli.ts` parses arguments (`node:util` `parseArgs`, strict) and dispatches to `agent/commands/*`.
- `agent/ops/session.ts` opens a site: resolves it (`agent/sites.ts`), merges the credentials (`agent/credentials.ts`) into the backend options, opens the `DataStore`, installs the automations engine on a fresh plugin registry, builds an `OpsContext` acting as the site's CLI user, takes the site lock for writes, and flushes / closes at the end.
- `agent/ops/plan.ts` validates install plans; `agent/ops/install.ts` checks access, seeds, uploads the admin; `agent/ops/hosting.ts` builds connectors from Node (S3, git, a node:fs folder connector) and the admin upload ops.
- `agent/mcp/server.ts` — the MCP protocol by hand (JSON-RPC 2.0 over stdio).
- Bundled by `vite.agent.config.ts` into `dist/agent/agentcrm.mjs` + lazy chunks, every dependency inlined: the npm package has no runtime dependency.

## Journal backend in one paragraph

Every `write()` becomes one encrypted, gzipped segment `journal/<wall>-<counter>-<client>.bin` appended to the location: no lock, no read-modify-write, so the browser admin, the CLI, a cron and the MCP server can write at the same time. Each mutation carries a hybrid-logical-clock stamp; readers merge the snapshot and every unapplied segment with per-field last-writer-wins. Clients poll the `journal/` listing every 20 s. `compact` folds everything into `snapshot.bin` and deletes the merged segments — which also physically erases deleted records. The passphrase never leaves the client; `keyinfo.json` holds only the salt, iteration count and an encrypted check value.

## Why no server

A server would hold everyone's personal data and need patching, scaling and paying. Everything "server-like" is done (a) in the browser while the admin is open, (b) by the CLI — run by a person, an agent, or a scheduled GitHub Action, or (c) by a service the user owns (their bucket, their Firebase project, their Google account via browser OAuth).
