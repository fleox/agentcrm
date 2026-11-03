import { spawn } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { CliError, printResult } from "../output";
import { distRoot } from "../paths";
import type { Command } from "./types";
import { boolOpt, strOpt, usage } from "./util";

// Serves the built admin on this computer (127.0.0.1 only) so the user
// can run the setup wizard — or use a "This browser" / local-folder CRM —
// without cloning or building the repo.

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

const NO_CACHE = new Set(["/index.html", "/config.js", "/version.json", "/admin-files.json"]);

export function resolveRequestPath(root: string, url: string): string | null {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(url, "http://localhost").pathname);
  } catch {
    return null;
  }
  if (pathname.endsWith("/")) pathname += "index.html";
  const file = normalize(join(root, pathname));
  if (file !== root && !file.startsWith(root.endsWith(sep) ? root : root + sep)) return null;
  return file;
}

export function startStaticServer(root: string, host: string, port: number): Promise<Server> {
  const server = createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end();
      return;
    }
    const file = resolveRequestPath(root, req.url ?? "/");
    if (!file || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
      return;
    }
    const rel = "/" + file.slice(root.length).split(sep).filter(Boolean).join("/");
    res.writeHead(200, {
      "content-type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
      "cache-control": NO_CACHE.has(rel) ? "no-store" : "no-cache",
      "x-content-type-options": "nosniff",
    });
    if (req.method === "HEAD") res.end();
    else createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

function openBrowser(url: string): void {
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    spawn(cmd, args as string[], { stdio: "ignore", detached: true }).on("error", () => undefined).unref();
  } catch {
    /* no browser: the URL is printed */
  }
}

export const serveCommand: Command = {
  name: "serve",
  usage: "serve [--port <n>] [--dir <folder>] [--no-open]",
  summary: "Serve the admin on this computer (127.0.0.1) and open the setup wizard in the browser. Runs until stopped (Ctrl+C).",
  options: [
    { name: "port", type: "string", description: "First port to try (the next free one is used).", default: "4173" },
    { name: "dir", type: "string", description: "Serve this folder instead of the bundled admin (e.g. a local-folder hosting)." },
    { name: "no-open", type: "boolean", description: "Don't open a browser." },
  ],
  async run({ io, options }) {
    const root = strOpt(options, "dir") ?? join(distRoot(), "admin");
    if (!existsSync(join(root, "index.html"))) throw new CliError("admin-missing", `No index.html in ${root}.`, "Use the npm package, or run `npm run build` in a clone.");
    const first = Number(strOpt(options, "port") ?? 4173);
    if (!Number.isInteger(first) || first < 1 || first > 65535) usage(`Invalid port: ${String(options.port)}`);
    let server: Server | null = null;
    let port = first;
    for (; port < first + 20 && port <= 65535; port++) {
      try {
        server = await startStaticServer(root, "127.0.0.1", port);
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE") throw e;
      }
    }
    if (!server) throw new CliError("port-busy", `Ports ${first}-${port - 1} are all in use.`, "Pass --port <n>.");
    const url = `http://localhost:${port}/`;
    printResult(io, { url, root }, () => `AgentCRM admin running at ${url}\nPress Ctrl+C to stop.`);
    if (!boolOpt(options, "no-open")) openBrowser(url);
    await new Promise<void>((resolve) => {
      const stop = () => server!.close(() => resolve());
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    });
  },
};
