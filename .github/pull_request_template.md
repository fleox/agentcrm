## What and why

<!-- What does this change, and which issue does it address? -->

## Checklist

- [ ] Business rules live in `src/ops/` (not in a page or a command), with Vitest tests next to the code
- [ ] `npm run typecheck`, `npm test`, `npm run build`, `npm run check:skills` and `npm run check:hermes` pass
- [ ] New UI strings go through `t()`, in `en` and `fr`
- [ ] Skills in `plugin/skills/` and `docs/` updated if the CLI, the AI tools or the admin's behaviour changed
- [ ] `changelog.json` entry for user-visible changes
