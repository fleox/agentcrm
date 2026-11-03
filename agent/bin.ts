// `agentcrm` binary entry. The browser shims must be installed before any
// src/ module loads (commands import them dynamically).
import { installBrowserEnv } from "./browserEnv";
import { main } from "./cli";
import { routeConsoleToStderr } from "./output";

installBrowserEnv();
// Extensions loaded in a session must not write on stdout (--json, mcp).
routeConsoleToStderr();
main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
