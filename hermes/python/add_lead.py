#!/usr/bin/env python3
"""Adds a lead to AgentCRM without creating duplicates: finds or creates the company (by email domain), finds or creates the person (by email), optionally logs a note and a follow-up task.

    python3 add_lead.py --site acme --email grace@globex.com [--first-name Grace] [--last-name Hopper] [--company Globex] [--title CTO] [--source website] [--note "Met at the expo"] [--task "Call back" --due 2026-11-10]

Prints one JSON object: {"ok": true, "data": {"person": {...}, "company": {...}|null, "created": {"person": bool, "company": bool}, "note": ..., "task": ...}}.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Dict, List, Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from agentcrm import AgentcrmError, run  # noqa: E402

FREE_MAIL = {"gmail.com", "googlemail.com", "yahoo.com", "hotmail.com", "outlook.com", "live.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "orange.fr", "free.fr", "laposte.net"}


def find_one(site: str, obj: str, field: str, value: str) -> Optional[Dict[str, Any]]:
    res = run("records", "list", "--object", obj, "--filter", f"{field}:eq:{value}", "--limit", "1", site=site)
    recs = res.get("records", [])
    return recs[0] if recs else None


def main(argv: List[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--site", required=True)
    p.add_argument("--email", required=True)
    p.add_argument("--first-name")
    p.add_argument("--last-name")
    p.add_argument("--company", help="company name (default: from the email domain)")
    p.add_argument("--title")
    p.add_argument("--source", help="leadSource option id or label")
    p.add_argument("--note")
    p.add_argument("--task")
    p.add_argument("--due")
    a = p.parse_args(argv)
    email = a.email.strip().lower()
    domain = email.split("@")[-1] if "@" in email else ""
    out: Dict[str, Any] = {"created": {"person": False, "company": False}, "company": None, "note": None, "task": None}
    try:
        company = None
        if domain and domain not in FREE_MAIL:
            company = find_one(a.site, "companies", "domain", domain)
        if not company and a.company:
            company = find_one(a.site, "companies", "name", a.company)
        if not company and (a.company or (domain and domain not in FREE_MAIL)):
            sets = [f"name={a.company or domain.split('.')[0].capitalize()}"]
            if domain and domain not in FREE_MAIL:
                sets.append(f"domain={domain}")
            company = run("records", "create", "--object", "companies", *sum([["--set", s] for s in sets], []), site=a.site)
            out["created"]["company"] = True
        out["company"] = company
        person = find_one(a.site, "people", "email", email)
        fields = {"email": email}
        if a.first_name:
            fields["firstName"] = a.first_name
        if a.last_name:
            fields["lastName"] = a.last_name
        if a.title:
            fields["jobTitle"] = a.title
        if a.source:
            fields["leadSource"] = a.source
        if company:
            fields["company"] = company["id"]
        if person:
            missing = {k: v for k, v in fields.items() if not person.get("fields", {}).get(k)}
            if missing:
                person = run("records", "update", person["id"], "--fields", json.dumps(missing), site=a.site)
        else:
            fields.setdefault("lifecycleStage", "lead")
            person = run("records", "create", "--object", "people", "--fields", json.dumps(fields), site=a.site)
            out["created"]["person"] = True
        out["person"] = person
        if a.note:
            out["note"] = run("notes", "add", person["id"], "--body", a.note, site=a.site)
        if a.task:
            args = ["tasks", "add", "--title", a.task, "--record", person["id"], "--assignee", "me"]
            if a.due:
                args += ["--due", a.due]
            out["task"] = run(*args, site=a.site)
    except AgentcrmError as err:
        print(json.dumps(err.as_json(), indent=2))
        return err.exit_code or 1
    print(json.dumps({"ok": True, "data": out}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
