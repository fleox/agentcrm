// `agentcrm` binary entry. The browser shims must be installed before any
// src/ module loads (commands import them dynamically).
import { installBrowserEnv } from "./browserEnv";
import { main } from "./cli";
import { routeConsoleToStderr } from "./output";

// process.exit() drops what stdout / stderr still hold when they are pipes
// (a large --json result read by a script was cut short). Exit once both have
// flushed: a write's callback runs after every write queued before it.
function exitWhenFlushed(code: number): void {
  let pending = 2;
  const done = () => {
    if (--pending === 0) process.exit(code);
  };
  process.stdout.write("", done);
  process.stderr.write("", done);
}

installBrowserEnv();
// Extensions loaded in a session must not write on stdout (--json, mcp).
routeConsoleToStderr();
main(process.argv.slice(2)).then(exitWhenFlushed, (err) => {
  console.error(err);
  exitWhenFlushed(1);
});
