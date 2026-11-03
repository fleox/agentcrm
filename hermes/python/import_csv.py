#!/usr/bin/env python3
"""Imports a CSV into an AgentCRM object in two steps: a dry run whose report is summarised, then (with --yes) the real import.

    python3 import_csv.py leads.csv --site acme --object people [--map "E-mail=email,Company=company"] [--dedupe update|skip|create] [--source "Expo 2026"] [--yes]

Prints one JSON object: {"ok": true, "data": {"applied": bool, "summary": {...}, "errors": [...], "mapping": {...}}}.
Without --yes nothing is written (the summary is what the import would do).
--source tags every row with a leadSource value (a column is added to a temporary copy of the file).
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import tempfile
from typing import Any, Dict, List

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from agentcrm import AgentcrmError, run  # noqa: E402


def with_source(path: str, source: str) -> str:
    with open(path, newline="", encoding="utf-8-sig") as fh:
        sample = fh.read(4096)
        fh.seek(0)
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
        except csv.Error:
            dialect = csv.excel
        rows = list(csv.reader(fh, dialect))
    if not rows:
        return path
    header, body = rows[0], rows[1:]
    header = header + ["Lead source"]
    body = [r + [source] for r in body if any(c.strip() for c in r)]
    fd, out = tempfile.mkstemp(suffix=".csv")
    with os.fdopen(fd, "w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(header)
        writer.writerows(body)
    return out


def summarise(report: Dict[str, Any]) -> Dict[str, Any]:
    keys = ["object", "dryRun", "total", "created", "updated", "skipped", "failed"]
    out = {k: report.get(k) for k in keys}
    out["newOptions"] = report.get("newOptions", [])
    out["createdRelated"] = report.get("createdRelated", [])
    out["unmappedColumns"] = report.get("unmappedColumns", [])
    return out


def main(argv: List[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("file")
    p.add_argument("--site", required=True)
    p.add_argument("--object", required=True)
    p.add_argument("--map", dest="mapping")
    p.add_argument("--dedupe", choices=["update", "skip", "create"], default="update")
    p.add_argument("--source", help="leadSource value added to every row")
    p.add_argument("--day-first", action="store_true")
    p.add_argument("--yes", action="store_true", help="apply (after the user approved the dry run)")
    a = p.parse_args(argv)
    path = with_source(a.file, a.source) if a.source else a.file
    args = ["import", "csv", path, "--object", a.object, "--dedupe", a.dedupe]
    mapping = a.mapping
    if a.source and mapping:
        if mapping.strip().startswith("{"):
            m = json.loads(mapping)
            m["Lead source"] = "leadSource"
            mapping = json.dumps(m)
        else:
            mapping += ",Lead source=leadSource"
    if mapping:
        args += ["--map", mapping]
    if a.day_first:
        args.append("--day-first")
    if a.yes:
        args.append("--yes")
    try:
        report = run(*args, site=a.site)
    except AgentcrmError as err:
        print(json.dumps(err.as_json(), indent=2))
        return err.exit_code or 1
    finally:
        if path != a.file:
            os.unlink(path)
    errors = [r for r in report.get("rows", []) if r.get("action") == "error"]
    print(json.dumps({"ok": True, "data": {"applied": not report.get("dryRun", True), "summary": summarise(report), "errors": errors, "mapping": report.get("mapping", {})}}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
