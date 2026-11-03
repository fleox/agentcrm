// Minimal semver comparison (x.y.z, optional -prerelease) — enough for
// "is an update available?" without pulling a dependency.

function parse(v: string): [number, number, number, string] {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(v.trim());
  if (!m) throw new Error(`Invalid version: ${v}`);
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ?? ""];
}

export function compareVersions(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return (pa[i] as number) < (pb[i] as number) ? -1 : 1;
  }
  // A release sorts after its prereleases (1.0.0-rc.1 < 1.0.0).
  if (pa[3] === pb[3]) return 0;
  if (!pa[3]) return 1;
  if (!pb[3]) return -1;
  return pa[3] < pb[3] ? -1 : 1;
}

export function isValidVersion(v: string): boolean {
  try {
    parse(v);
    return true;
  } catch {
    return false;
  }
}
