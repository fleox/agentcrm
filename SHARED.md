# SHARED.md — provenance of code copied from AgentCMS (`../cms-ia/`)

AgentCRM reuses the infrastructure of its sibling AgentCMS. Files below were
copied and adapted; when fixing a bug in one of them, check whether the
cms-ia original needs the same fix (and vice versa).

| AgentCRM file | cms-ia origin | Changes |
|---|---|---|
| `src/shared/storage/types.ts` | `src/services/storage/types.ts` | Comments; **added `listPrefix?(prefix)`** to `StorageConnector`. |
| `src/shared/storage/registry.ts` | `src/services/storage/registry.ts` | Active-connector config is pluggable: `setStorageConfigSource()` / `getStorageConfig()` replace cms-ia `storageConfig.ts` (no CMS settings dependency). |
| `src/shared/storage/http.ts` | `src/services/storage/http.ts` | Import paths only (errors still go through `t("storage.errors.*")` + toast). |
| `src/shared/storage/batch.ts` | `src/services/storage/batch.ts` | Unchanged. |
| `src/shared/storage/testConnection.ts` | `src/services/storage/testConnection.ts` | Probe file `.agentcrm-probe.txt`; also proves `listPrefix` works. |
| `src/shared/storage/mime.ts` | `src/services/storage/mime.ts` | Unchanged. |
| `src/shared/storage/sigv4.ts` (+ `sigv4.test.ts`) | `src/services/storage/sigv4.ts` | Unchanged. |
| `src/shared/storage/kvStore.ts` | `src/services/storage/kvStore.ts` | Unchanged. |
| `src/shared/storage/storage.test.ts` | `src/services/storage/storage.test.ts` | Uses `setStorageConfigSource` instead of mocking `storageConfig`. |
| `src/shared/storage/connectors/s3.ts` | `src/services/storage/connectors/s3.ts` | `siteUrl` optional; **`listPrefix`** (ListObjectsV2 `prefix=`, paginated). |
| `src/shared/storage/connectors/gitPages.ts` | `src/services/storage/connectors/gitPages.ts` | Token reuse from the `git-json` backend (`getGitToken` in `lib/runtimeConfig.ts`); `host` / `siteUrl` optional (data-only repos commit "Update data … [skip ci]"); **`listPrefix`** (tree listing). |
| `src/shared/storage/connectors/localFolder.ts` | `src/services/storage/connectors/localFolder.ts` | `handleKey` setting (`LOCAL_DATA_HANDLE_KEY` for data folders); **`listPrefix`**. |
| `src/shared/storage/connectors/browserMirror.ts` | `src/services/storage/connectors/browserMirror.ts` | IndexedDB name `agentcrm-site-mirror`; **`listPrefix`**. |
| `src/shared/storage/connectors/connectors.test.ts` | `src/services/storage/connectors/connectors.test.ts` | Commit messages; new `listPrefix` tests (git, S3 pagination, mirror). |
| `src/shared/storage/connectors/memory.ts` | — (new) | In-memory connector for tests / CLI dry runs. |
| `src/shared/siteFiles.ts` | `src/services/siteFiles.ts` | Dropped the media-cache hook; added `listFilesUnder(prefix)`. |
| `src/shared/git/*.ts` (`index`, `types`, `encoding`, `http`, `handleStore`, `blobCache`, `github`, `gitlab`, `localFs`, `git.test.ts`) | `src/services/git/*` | IndexedDB names / picker id / bootstrap commit message renamed to AgentCRM. |
| `src/shared/crypto/index.ts` | `src/services/docstore/sqliteCrypto.ts` | Generalised to any bytes (`encryptBytes` / `decryptBytes` / `encryptText`…); magic **`ACRMENC1`**; `PassphraseError` (was `SqlitePassphraseError`); `newEncryptionParams()`. |
| `src/shared/lib/toast.ts` | `src/lib/toast.ts` | Unchanged. |
| `src/shared/lib/utils.ts` | `src/lib/utils.ts` | Firestore `Timestamp` support removed (dates are epoch ms); added `formatRelative`, `slugify`, `camelId`, `debounce`, `initials`. |
| `src/lib/runtimeConfig.ts` | `src/lib/runtimeConfig.ts` | New union (local / journal / git-json / firebase), `window.__AGENTCRM_CONFIG__`, `agentcrm.runtimeConfig`, per-dataset secrets `agentcrm.secrets:<…>`, `setRuntimeConfigOverride()` for the CLI. |
| `src/data/core.ts` | `src/services/docstore/core.ts` | `patch` mutations (per-field, dot paths), synchronous optimistic apply once loaded, `watch` (push) backends, `compact`, `close`, 11 CRM collections. |
| `src/data/local.ts` | `src/services/docstore/localStore.ts` | CRM collections; persists from the `after` snapshot (patches). |
| `src/core/pluginRegistry.ts` | `src/core/pluginRegistry.ts` | Instance-based (`createPluginRegistry`), typed CRM actions, error isolation; no blocks / themes API. |
| `agent/browserEnv.ts` | `agent/browserEnv.ts` | Unchanged. |
| `agent/output.ts`, `agent/cli.ts`, `agent/commands/{index,types}.ts` | same paths | Skeleton only (help / version); the CLI agent fills the rest. |
| `index.html`, `vite.config.ts`, `vite.agent.config.ts`, `tsconfig*.json`, `tailwind.config.js`, `postcss.config.js`, `scripts/write-version.mjs` | same paths | No themes / plugins / import maps / sql.js / jsquash. |

Stripped from the copies: themes, publisher, posts / terms / media, plugin
loader, SQLite, image processing.
