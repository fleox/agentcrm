import { describe, expect, it } from "vitest";
import type { FileMeta } from "../core/types";
import { createMemoryConnector } from "../shared/storage/connectors/memory";
import { createJournalStore } from "../data/journal/journalStore";
import { fileStoreOf } from "../data/files";
import { addActivity, addNote, deleteActivity, updateActivity } from "./activities";
import { compactData } from "./compact";
import { createOpsContext } from "./context";
import { mergeRecords } from "./dedupe";
import {
  attachFile,
  clearRecordImage,
  deleteFile,
  detachFile,
  fileUsage,
  getFileBytes,
  listFiles,
  purgeFiles,
  restoreFile,
  setRecordImage,
  uploadFile,
} from "./files";
import { migrateSchema } from "./migrate";
import { createRecord, deleteRecord, getRecord } from "./records";
import { createField, updateObject } from "./schema";
import { seedCrm } from "./seed";
import { updateSettings } from "./settings";
import { setupTestCrm, TEST_NOW } from "./testing";

const bytes = (text: string) => new TextEncoder().encode(text);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

async function crmWithPerson() {
  const crm = await setupTestCrm();
  const company = await createRecord(crm.admin, "companies", { name: "Acme", domain: "acme.io" });
  const person = await createRecord(crm.admin, "people", { firstName: "Ada", lastName: "Lovelace", company: company.id });
  return { crm, company, person };
}

describe("files ops", () => {
  it("uploads to the backend FileStore with metadata, thumbnail, sha256 and targets", async () => {
    const { crm, person } = await crmWithPerson();
    const f = await uploadFile(crm.admin, { name: "../notes/report.pdf", bytes: bytes("%PDF-1.4 hello"), targets: [person.id], thumbnail: { bytes: PNG } });
    expect(f).toMatchObject({ name: "report.pdf", mime: "application/pdf", size: 14, thumbId: `${f.id}_t`, targets: [{ kind: "record", object: "people", id: person.id }], createdBy: "owner" });
    expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(new TextDecoder().decode(await getFileBytes(crm.admin, f.id))).toBe("%PDF-1.4 hello");
    expect(await getFileBytes(crm.admin, f.id, { thumb: true })).toEqual(PNG);
    expect(fileUsage(crm.admin)).toMatchObject({ count: 1, totalBytes: 14, images: 0 });
    // Viewers read, can't write.
    expect((await getFileBytes(crm.as("viewer"), f.id)).length).toBe(14);
    await expect(uploadFile(crm.as("viewer"), { name: "x.txt", bytes: bytes("x") })).rejects.toThrow(/Not allowed/);
    await expect(deleteFile(crm.as("viewer"), f.id)).rejects.toThrow(/Not allowed/);
    // Unknown targets are refused.
    await expect(uploadFile(crm.admin, { name: "x.txt", bytes: bytes("x"), targets: ["nope"] })).rejects.toThrow(/neither a record nor an activity/);
  });

  it("enforces the upload limit (settings.maxUploadMb)", async () => {
    const { crm } = await crmWithPerson();
    await updateSettings(crm.admin, { maxUploadMb: 1 });
    await expect(uploadFile(crm.admin, { name: "big.bin", bytes: new Uint8Array(1024 * 1024 + 1) })).rejects.toThrow(/too large/);
    await expect(updateSettings(crm.admin, { maxUploadMb: 0 })).rejects.toThrow(/between 1 and 1024/);
    await expect(uploadFile(crm.admin, { name: "empty.txt", bytes: new Uint8Array() })).rejects.toThrow(/empty/);
  });

  it("attaches files to activities (attachments ⇄ targets) and lists a record's files", async () => {
    const { crm, company, person } = await crmWithPerson();
    const img = await uploadFile(crm.admin, { name: "whiteboard.png", bytes: PNG, width: 800, height: 600 });
    const doc = await uploadFile(crm.admin, { name: "contract.pdf", bytes: bytes("%PDF") });
    const note = await addActivity(crm.admin, { type: "note", title: "Kick-off", body: `See ![whiteboard](file:${img.id})`, targets: [{ object: "people", id: person.id }], attachments: [img.id, doc.id] });
    expect(note.attachments).toEqual([img.id, doc.id]);
    expect(crm.store.get("files", img.id)).toMatchObject({ targets: [{ kind: "activity", id: note.id }] });
    // Record's files: its activities' by default; related records' on demand.
    expect(listFiles(crm.admin, person.id).map((f) => f.id).sort()).toEqual([img.id, doc.id].sort());
    expect(listFiles(crm.admin, person.id, { includeActivities: false })).toEqual([]);
    expect(listFiles(crm.admin, company.id)).toEqual([]);
    expect(listFiles(crm.admin, company.id, { includeRelated: true }).map((f) => f.via.kind)).toEqual(["activity", "activity"]);
    expect(listFiles(crm.admin, note.id).length).toBe(2);
    expect(listFiles(crm.admin, person.id, { kind: "image" }).map((f) => f.id)).toEqual([img.id]);
    expect(listFiles(crm.admin, person.id, { search: "contr" }).map((f) => f.id)).toEqual([doc.id]);
    // Removing an attachment through the activity updates the file's targets.
    await updateActivity(crm.admin, note.id, { attachments: [img.id] });
    expect(crm.store.get("files", doc.id)).toMatchObject({ targets: [] });
    await expect(addNote(crm.admin, person.id, "x").then((n) => updateActivity(crm.admin, n.id, { attachments: ["missing"] }))).rejects.toThrow(/not found/);
    // attach / detach directly.
    await attachFile(crm.admin, doc.id, person.id);
    expect(listFiles(crm.admin, person.id, { includeActivities: false }).map((f) => f.id)).toEqual([doc.id]);
    await attachFile(crm.admin, doc.id, note.id);
    expect((crm.store.get("activities", note.id) as unknown as { attachments: string[] }).attachments).toEqual([img.id, doc.id]);
    await detachFile(crm.admin, doc.id, note.id);
    expect((crm.store.get("activities", note.id) as unknown as { attachments: string[] }).attachments).toEqual([img.id]);
  });

  it("soft delete removes references; restore; purge deletes the blobs (GDPR)", async () => {
    const { crm, person } = await crmWithPerson();
    const f = await uploadFile(crm.admin, { name: "id.png", bytes: PNG, thumbnail: { bytes: PNG } });
    const note = await addActivity(crm.admin, { type: "note", title: "n", targets: [{ object: "people", id: person.id }], attachments: [f.id] });
    await deleteFile(crm.admin, f.id);
    expect((crm.store.get("activities", note.id) as unknown as { attachments?: string[] }).attachments).toBeUndefined();
    expect(listFiles(crm.admin, person.id)).toEqual([]);
    await restoreFile(crm.admin, f.id);
    expect((crm.store.get("activities", note.id) as unknown as { attachments?: string[] }).attachments).toEqual([f.id]);
    await deleteFile(crm.admin, f.id);
    const files = fileStoreOf(crm.store);
    expect(await files.list!()).toEqual([f.id, `${f.id}_t`]);
    const dry = await purgeFiles(crm.admin, { dryRun: true });
    expect(dry.purged).toEqual([f.id]);
    await expect(purgeFiles(crm.as("member"))).rejects.toThrow(/Not allowed/);
    const report = await compactData(crm.admin);
    expect(report.purgedFiles).toBe(1);
    expect(await files.list!()).toEqual([]);
    expect(crm.store.get("files", f.id)).toBeUndefined();
  });

  it("hard-deleting a record (and activities) frees its files; compact purges them; orphan blobs too", async () => {
    const { crm, person } = await crmWithPerson();
    const direct = await uploadFile(crm.admin, { name: "cv.pdf", bytes: bytes("cv"), targets: [person.id] });
    const onNote = await uploadFile(crm.admin, { name: "n.txt", bytes: bytes("n") });
    await addActivity(crm.admin, { type: "note", title: "n", targets: [{ object: "people", id: person.id }], attachments: [onNote.id] });
    const keep = await uploadFile(crm.admin, { name: "fresh.txt", bytes: bytes("fresh") });
    await fileStoreOf(crm.store).put("strayblob", bytes("stray"));
    await deleteRecord(crm.admin, person.id, { hard: true });
    expect((crm.store.get("files", direct.id) as unknown as FileMeta).deletedAt).toBe(TEST_NOW);
    expect((crm.store.get("files", onNote.id) as unknown as FileMeta).targets).toEqual([]);
    const report = await compactData(crm.admin);
    expect(report.files?.purged.sort()).toEqual([direct.id, onNote.id].sort());
    expect(report.files?.orphanBlobs).toBe(1);
    // A fresh upload not attached yet survives (grace period)…
    expect(crm.store.get("files", keep.id)).toBeDefined();
    // …but not after a day.
    crm.clock.now = TEST_NOW + 2 * 86_400_000;
    expect((await compactData(crm.admin)).files?.purged).toEqual([keep.id]);
  });

  it("soft-deleted activity purged by compact takes its orphan files along", async () => {
    const { crm, person } = await crmWithPerson();
    const f = await uploadFile(crm.admin, { name: "a.txt", bytes: bytes("a") });
    const note = await addActivity(crm.admin, { type: "note", title: "n", targets: [{ object: "people", id: person.id }], attachments: [f.id] });
    await deleteActivity(crm.admin, note.id);
    const report = await compactData(crm.admin);
    expect(report.files?.purged).toEqual([f.id]);
  });

  it("merge moves file targets to the primary record", async () => {
    const { crm } = await crmWithPerson();
    const a = await createRecord(crm.admin, "people", { name: "Grace Hopper", email: "g@navy.mil" });
    const b = await createRecord(crm.admin, "people", { name: "Grace H." });
    const f = await uploadFile(crm.admin, { name: "badge.png", bytes: PNG, targets: [b.id] });
    await mergeRecords(crm.admin, a.id, [b.id]);
    expect((crm.store.get("files", f.id) as unknown as FileMeta).targets).toEqual([{ kind: "record", object: "people", id: a.id }]);
    expect(listFiles(crm.admin, a.id).map((x) => x.id)).toEqual([f.id]);
  });

  it("record images: set, replace (old one retired), clear; image field rules", async () => {
    const { crm, person, company } = await crmWithPerson();
    const first = await setRecordImage(crm.admin, person.id, undefined, { name: "ada.png", bytes: PNG, width: 400, height: 400, thumbnail: { bytes: PNG } });
    expect(first.record.fields.avatar).toBe(first.file.id);
    const second = await setRecordImage(crm.admin, person.id, undefined, { name: "ada2.png", bytes: PNG });
    expect(getRecord(crm.admin, person.id).fields.avatar).toBe(second.file.id);
    expect((crm.store.get("files", first.file.id) as unknown as FileMeta).deletedAt).toBeDefined();
    await clearRecordImage(crm.admin, person.id);
    expect(getRecord(crm.admin, person.id).fields.avatar).toBeUndefined();
    expect((crm.store.get("files", second.file.id) as unknown as FileMeta).deletedAt).toBeDefined();
    const logo = await setRecordImage(crm.admin, company.id, "logo", { name: "logo.svg", mime: "image/svg+xml", bytes: bytes("<svg/>") });
    expect(logo.record.fields.logo).toBe(logo.file.id);
    await expect(setRecordImage(crm.admin, person.id, undefined, { name: "x.pdf", bytes: bytes("%PDF") })).rejects.toThrow(/not an image/);
    await expect(setRecordImage(crm.admin, person.id, "email", { name: "x.png", bytes: PNG })).rejects.toThrow(/not an image field/);
    // Deals have no image field until one is added (the first becomes the avatar).
    const deal = await createRecord(crm.admin, "deals", { name: "Big deal" });
    await expect(setRecordImage(crm.admin, deal.id, undefined, { name: "x.png", bytes: PNG })).rejects.toThrow(/no image field/);
    await createField(crm.admin, "deals", { label: "Cover", type: "image" });
    expect((crm.store.get("objects", "deals") as { imageField?: string }).imageField).toBe("cover");
    await updateObject(crm.admin, "deals", { imageField: null });
    expect((crm.store.get("objects", "deals") as { imageField?: string }).imageField).toBeUndefined();
    await expect(updateObject(crm.admin, "deals", { imageField: "name" })).rejects.toThrow(/image field/);
    // files fields hold arrays of ids; validated as file refs.
    await createField(crm.admin, "people", { label: "Documents", type: "files" });
    const withDocs = await createRecord(crm.admin, "people", { name: "Doc Holder", documents: [logo.file.id] });
    expect(withDocs.fields.documents).toEqual([logo.file.id]);
    await expect(createRecord(crm.admin, "people", { name: "Bad", documents: ["../etc"] })).rejects.toThrow(/file id/);
  });

  it("journal backend: uploaded bytes are encrypted at rest", async () => {
    const connector = createMemoryConnector();
    const store = createJournalStore({ connector, root: "crm", passphrase: "pw", iterations: 1000 });
    await store.ready();
    const ctx = createOpsContext(store, null, { now: () => TEST_NOW });
    await seedCrm(ctx, { admin: { name: "A", email: "a@x.io" } });
    const person = await createRecord(ctx, "people", { name: "Ada Lovelace" });
    const f = await uploadFile(ctx, { name: "medical-report.txt", bytes: bytes("DIAGNOSIS: confidential plaintext"), targets: [person.id] });
    const blob = connector.files.get(`crm/files/${f.id}.bin`)!;
    expect(blob).toBeDefined();
    for (const raw of connector.files.values()) {
      expect(Buffer.from(raw).includes(Buffer.from("confidential plaintext"))).toBe(false);
      expect(Buffer.from(raw).includes(Buffer.from("medical-report"))).toBe(false);
    }
    expect(new TextDecoder().decode(await getFileBytes(ctx, f.id))).toBe("DIAGNOSIS: confidential plaintext");
  });

  it("migrates older workspaces: adds avatar / logo image fields once, keeps user changes", async () => {
    const crm = await setupTestCrm();
    // Simulate a 0.2 workspace: no image fields, no marker.
    for (const id of ["people", "companies"]) {
      const o = crm.store.get("objects", id) as unknown as { fields: { id: string }[] };
      await crm.store.write([{ op: "set", collection: "objects", doc: { ...o, id, fields: o.fields.filter((f) => f.id !== "avatar" && f.id !== "logo"), imageField: undefined, migrations: undefined } as never }]);
    }
    const report = await migrateSchema(crm.admin);
    expect(report.applied.map((a) => [a.object, a.added])).toEqual([
      ["companies", ["logo"]],
      ["people", ["avatar"]],
    ]);
    const people = crm.store.get("objects", "people") as unknown as { imageField: string; fields: { id: string; type: string }[] };
    expect(people.imageField).toBe("avatar");
    expect(people.fields.at(-1)).toMatchObject({ id: "avatar", type: "image" });
    expect((await migrateSchema(crm.admin)).applied).toEqual([]);
    await expect(migrateSchema(crm.as("member"))).rejects.toThrow(/Not allowed/);
  });
});

describe("backup ZIP (data + files)", () => {
  it("round-trips data and file bytes into another backend", async () => {
    const { exportBackupZip, importBackupZip } = await import("./backup");
    const { crm, person } = await crmWithPerson();
    const f = await uploadFile(crm.admin, { name: "a.png", bytes: PNG, targets: [person.id], thumbnail: { bytes: new Uint8Array([7]) } });
    const { zip, report } = await exportBackupZip(crm.admin);
    expect(report).toMatchObject({ files: 1, missing: [] });
    const target = await setupTestCrm();
    const res = await importBackupZip(target.admin, zip);
    expect(res.files).toBe(1);
    expect(await getFileBytes(target.admin, f.id)).toEqual(PNG);
    expect(await getFileBytes(target.admin, f.id, { thumb: true })).toEqual(new Uint8Array([7]));
    expect(listFiles(target.admin, person.id).map((x) => x.id)).toEqual([f.id]);
    await expect(importBackupZip(target.admin, new Uint8Array([1, 2, 3]))).rejects.toThrow(/ZIP/);
    await expect(importBackupZip(target.as("member"), zip)).rejects.toThrow(/Not allowed/);
  });
});

describe("demo files", () => {
  it("demo data gets generated avatars, logos and a note with a chart + PDF (deterministic)", async () => {
    const crm = await setupTestCrm({ demo: true });
    const files = crm.store.list("files") as unknown as FileMeta[];
    expect(files.filter((f) => f.name.endsWith(".svg")).length).toBe(18);
    const people = crm.store.list("records").filter((r) => (r as unknown as { fields: { avatar?: string } }).fields.avatar);
    expect(people.length).toBe(10);
    const chart = files.find((f) => f.name === "pipeline-chart.png")!;
    const png = await getFileBytes(crm.admin, chart.id);
    expect([...png.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const pdf = new TextDecoder().decode(await getFileBytes(crm.admin, files.find((f) => f.name === "proposal.pdf")!.id));
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    const note = crm.store.list("activities").find((a) => (a as unknown as { attachments?: string[] }).attachments?.includes(chart.id)) as unknown as { body: string };
    expect(note.body).toContain(`](file:${chart.id})`);
    // Every generated SVG is well-formed (no undefined colours).
    const { demoAvatarSvg, demoLogoSvg } = await import("./demoFiles");
    for (const n of ["Alan Thompson", "Ada Lovelace", "Zoé Wright", "Octan Energy", "x", "Ünïcödé Name"]) {
      expect(demoAvatarSvg(n)).not.toContain("undefined");
      expect(demoLogoSvg(n)).not.toContain("undefined");
    }
    // Same bytes on every run.
    const again = await setupTestCrm({ demo: true });
    expect((again.store.list("files") as unknown as FileMeta[]).map((f) => f.sha256)).toEqual(files.map((f) => f.sha256));
  });
});
