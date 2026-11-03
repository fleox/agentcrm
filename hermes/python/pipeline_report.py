#!/usr/bin/env python3
"""Builds a pipeline review (forecast, stale deals, overdue tasks, won / lost) for one AgentCRM site as JSON or Markdown.

    python3 pipeline_report.py --site acme [--days 21] [--months 3] [--markdown]

Read-only: runs `report pipeline`, `report forecast`, `report stale`, `report won-lost` and `tasks list --overdue`.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Dict, List

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from agentcrm import AgentcrmError, run  # noqa: E402


def collect(site: str, days: int, months: int) -> Dict[str, Any]:
    return {
        "site": site,
        "pipeline": run("report", "pipeline", site=site)["data"],
        "forecast": run("report", "forecast", site=site)["data"],
        "stale": run("report", "stale", "--days", str(days), site=site)["data"],
        "wonLost": run("report", "won-lost", "--months", str(months), site=site)["data"],
        "overdueTasks": run("tasks", "list", "--overdue", site=site),
    }


def money(v: Any) -> str:
    try:
        return f"{float(v):,.0f}"
    except (TypeError, ValueError):
        return "-"


def markdown(r: Dict[str, Any]) -> str:
    lines: List[str] = [f"# Pipeline review - {r['site']}", ""]
    f = r["forecast"] or {}
    lines.append(f"Open: {f.get('openCount', '-')} deals, {money(f.get('openAmount'))} (weighted {money(f.get('weightedAmount'))})")
    lines += ["", "## By stage", "", "| Stage | Deals | Amount | Weighted |", "|---|---|---|---|"]
    for s in (r["pipeline"] or {}).get("stages", []):
        lines.append(f"| {s.get('label', s.get('id'))} | {s.get('count', 0)} | {money(s.get('amount'))} | {money(s.get('weighted', s.get('weightedAmount')))} |")
    deals = (r["stale"] or {}).get("deals", [])
    lines += ["", f"## Stale deals ({len(deals)})", ""]
    for d in deals[:20]:
        lines.append(f"- {d.get('label', d.get('id'))}: {d.get('daysSinceActivity', d.get('days', '?'))} days without activity")
    tasks = (r["overdueTasks"] or {}).get("tasks", [])
    lines += ["", f"## Overdue tasks ({len(tasks)})", ""]
    for t in tasks[:20]:
        lines.append(f"- {t.get('title')} (due {t.get('dueAt', '?')[:10]})")
    totals = (r["wonLost"] or {}).get("totals", {})
    if totals:
        lines += ["", "## Won / lost", "", json.dumps(totals)]
    return "\n".join(lines) + "\n"


def main(argv: List[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--site", required=True)
    p.add_argument("--days", type=int, default=21)
    p.add_argument("--months", type=int, default=3)
    p.add_argument("--markdown", action="store_true")
    a = p.parse_args(argv)
    try:
        report = collect(a.site, a.days, a.months)
    except AgentcrmError as err:
        print(json.dumps(err.as_json(), indent=2))
        return err.exit_code or 1
    if a.markdown:
        print(markdown(report))
    else:
        print(json.dumps({"ok": True, "data": report}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
