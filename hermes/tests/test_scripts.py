"""Tests of the Hermes Python helpers against a fake agentcrm engine.

    python3 -m unittest discover -s hermes/tests
"""

import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "python"))

import add_lead  # noqa: E402
import agentcrm  # noqa: E402
import import_csv  # noqa: E402
import pipeline_report  # noqa: E402


def ok(data):
    return {"ok": True, "data": data}


class FakeEngine(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.log = os.path.join(self.dir, "calls.jsonl")
        self.script = os.path.join(self.dir, "script.json")
        os.environ["AGENTCRM_CMD"] = f'"{sys.executable}" "{os.path.join(HERE, "fake_engine.py")}"'
        os.environ["FAKE_LOG"] = self.log
        os.environ["FAKE_SCRIPT"] = self.script

    def answer(self, *pairs):
        with open(self.script, "w", encoding="utf-8") as fh:
            json.dump([[list(p), r] for p, r in pairs], fh)

    def calls(self):
        if not os.path.exists(self.log):
            return []
        with open(self.log, encoding="utf-8") as fh:
            return [json.loads(l) for l in fh if l.strip()]

    def commands(self):
        return [c for c in self.calls() if isinstance(c, list)]

    def capture(self, fn, argv):
        buf = StringIO()
        with redirect_stdout(buf):
            code = fn(argv)
        return code, json.loads(buf.getvalue()) if buf.getvalue().strip().startswith("{") else buf.getvalue()


class WrapperTest(FakeEngine):
    def test_run_returns_data_and_adds_json_and_site(self):
        self.answer((["records", "list"], ok({"total": 1, "records": [{"id": "a"}]})))
        data = agentcrm.run("records", "list", "--object", "people", site="acme")
        self.assertEqual(data["records"], [{"id": "a"}])
        self.assertEqual(self.commands()[0], ["records", "list", "--object", "people", "--site", "acme", "--json"])

    def test_errors_carry_code_and_hint(self):
        self.answer((["records", "get"], {"ok": False, "error": {"code": "notFound", "message": "No record", "hint": "List them"}, "__exit__": 1}))
        with self.assertRaises(agentcrm.AgentcrmError) as ctx:
            agentcrm.run("records", "get", "x", site="acme")
        self.assertEqual((ctx.exception.code, ctx.exception.hint, ctx.exception.exit_code), ("notFound", "List them", 1))

    def test_no_json_output(self):
        self.answer((["status"], {"__raw__": "boom", "__exit__": 1}))
        with self.assertRaises(agentcrm.AgentcrmError) as ctx:
            agentcrm.run("status")
        self.assertEqual(ctx.exception.code, "no-output")

    def test_node_missing_is_explained(self):
        del os.environ["AGENTCRM_CMD"]
        path = os.environ.get("PATH", "")
        os.environ["PATH"] = self.dir
        try:
            with self.assertRaises(agentcrm.AgentcrmError) as ctx:
                agentcrm.engine_command()
            self.assertEqual(ctx.exception.code, "node-missing")
            self.assertIn("nodejs.org", ctx.exception.hint)
        finally:
            os.environ["PATH"] = path

    def test_pinned_package(self):
        self.assertEqual(agentcrm.PACKAGE, "@fleox-agent-crm/agentcrm")

    def test_needs_confirmation_and_result(self):
        self.assertTrue(agentcrm.needs_confirmation({"needsConfirmation": True, "plan": {}}))
        self.assertFalse(agentcrm.needs_confirmation({"deleted": []}))
        self.assertEqual(agentcrm.result({"tool": "search_records", "result": [1]}), [1])

    def test_interactive_commands(self):
        self.assertTrue(agentcrm._interactive(["credentials", "set", "s3:main"]))
        self.assertFalse(agentcrm._interactive(["credentials", "set", "s3:main", "--from-env", "A,B"]))


class ImportCsvTest(FakeEngine):
    def test_dry_run_then_apply_with_source(self):
        csv_path = os.path.join(self.dir, "expo.csv")
        with open(csv_path, "w", encoding="utf-8") as fh:
            fh.write("Name,Email\nAda,ada@x.test\n")
        report = {"object": "people", "dryRun": True, "total": 1, "created": 1, "updated": 0, "skipped": 0, "failed": 0, "mapping": {"Name": "name"}, "rows": [{"row": 1, "action": "create"}], "newOptions": [], "createdRelated": [], "unmappedColumns": []}
        self.answer((["import", "csv"], ok(report)))
        code, out = self.capture(import_csv.main, [csv_path, "--site", "acme", "--object", "people", "--source", "Expo 2026", "--map", "Name=name,Email=email"])
        self.assertEqual(code, 0)
        self.assertFalse(out["data"]["applied"])
        cmd = self.commands()[0]
        self.assertNotIn("--yes", cmd)
        self.assertIn("Name=name,Email=email,Lead source=leadSource", cmd)
        copied = [c for c in self.calls() if isinstance(c, dict) and "csv" in c][0]["csv"]
        self.assertIn("Expo 2026", copied)
        self.assertFalse(os.path.exists(cmd[2]))  # temporary copy removed

        self.answer((["import", "csv"], ok({**report, "dryRun": False})))
        code, out = self.capture(import_csv.main, [csv_path, "--site", "acme", "--object", "people", "--yes"])
        self.assertTrue(out["data"]["applied"])
        self.assertIn("--yes", self.commands()[-1])


class PipelineReportTest(FakeEngine):
    def test_markdown(self):
        self.answer(
            (["report", "pipeline"], ok({"report": "pipeline", "data": {"stages": [{"id": "new", "label": "New", "count": 2, "amount": 1000, "weighted": 100}]}})),
            (["report", "forecast"], ok({"report": "forecast", "data": {"openCount": 2, "openAmount": 1000, "weightedAmount": 100}})),
            (["report", "stale"], ok({"report": "stale", "data": {"deals": [{"id": "d1", "label": "Old deal", "daysSinceActivity": 40}]}})),
            (["report", "won-lost"], ok({"report": "won-lost", "data": {"totals": {"won": 1}}})),
            (["tasks", "list"], ok({"total": 1, "tasks": [{"title": "Call Ada", "dueAt": "2026-01-01T00:00:00Z"}]})),
        )
        code, out = self.capture(pipeline_report.main, ["--site", "acme", "--markdown"])
        self.assertEqual(code, 0)
        self.assertIn("| New | 2 |", out)
        self.assertIn("Old deal: 40 days", out)
        self.assertIn("Call Ada", out)
        self.assertIn(["tasks", "list", "--overdue", "--site", "acme", "--json"], self.commands())


class AddLeadTest(FakeEngine):
    def test_creates_company_and_person_once(self):
        self.answer(
            (["records", "list", "--object", "companies"], ok({"total": 0, "records": []})),
            (["records", "list", "--object", "people"], ok({"total": 0, "records": []})),
            (["records", "create", "--object", "companies"], ok({"id": "c1", "label": "Globex"})),
            (["records", "create", "--object", "people"], ok({"id": "p1", "label": "Grace Hopper", "fields": {}})),
            (["notes", "add"], ok({"id": "n1"})),
        )
        code, out = self.capture(add_lead.main, ["--site", "acme", "--email", "Grace@Globex.com", "--first-name", "Grace", "--last-name", "Hopper", "--note", "Met at the expo"])
        self.assertEqual(code, 0)
        self.assertEqual(out["data"]["created"], {"person": True, "company": True})
        person_create = [c for c in self.commands() if c[:4] == ["records", "create", "--object", "people"]][0]
        fields = json.loads(person_create[person_create.index("--fields") + 1])
        self.assertEqual(fields, {"email": "grace@globex.com", "firstName": "Grace", "lastName": "Hopper", "company": "c1", "lifecycleStage": "lead"})
        self.assertIn(["records", "list", "--object", "companies", "--filter", "domain:eq:globex.com", "--limit", "1", "--site", "acme", "--json"], self.commands())

    def test_free_mail_skips_company(self):
        self.answer(
            (["records", "list", "--object", "people"], ok({"total": 1, "records": [{"id": "p1", "fields": {"email": "x@gmail.com", "firstName": "X"}}]})),
            (["records", "update"], ok({"id": "p1"})),
        )
        code, out = self.capture(add_lead.main, ["--site", "acme", "--email", "x@gmail.com", "--title", "CEO"])
        self.assertEqual(out["data"]["created"], {"person": False, "company": False})
        self.assertFalse(any(c[:3] == ["records", "list", "--object"] and c[3] == "companies" for c in self.commands()))


if __name__ == "__main__":
    unittest.main()
