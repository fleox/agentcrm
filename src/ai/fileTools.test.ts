import { describe, expect, it } from "vitest";
import { addActivity } from "../ops/activities";
import { uploadFile } from "../ops/files";
import { createRecord } from "../ops/records";
import { setupTestCrm } from "../ops/testing";
import { callTool, findTool } from "./tools";

describe("file AI tools", () => {
  it("list_files / describe_attachments return metadata only", async () => {
    const crm = await setupTestCrm();
    const p = await createRecord(crm.admin, "people", { name: "Ada Lovelace" });
    const img = await uploadFile(crm.admin, { name: "board.png", bytes: new Uint8Array([1, 2, 3]), width: 640, height: 480 });
    const pdf = await uploadFile(crm.admin, { name: "deal.pdf", bytes: new TextEncoder().encode("%PDF secret contents") });
    const note = await addActivity(crm.admin, { type: "note", title: "Meeting", body: `![board](file:${img.id})`, targets: [{ object: "people", id: p.id }], attachments: [pdf.id] });
    expect(findTool("list_files")?.mutating).toBe(false);
    const listed = (await callTool(crm.as("viewer"), "list_files", { recordId: p.id })) as { total: number; files: { name: string; kind: string }[] };
    expect(listed.total).toBe(1);
    expect(listed.files[0]).toMatchObject({ name: "deal.pdf", kind: "pdf", sizeLabel: "20 B" });
    expect(JSON.stringify(listed)).not.toContain("secret contents");
    const all = (await callTool(crm.admin, "list_files", { kind: "image" })) as { usage: { count: number }; files: unknown[] };
    expect(all.usage.count).toBe(2);
    expect(all.files).toHaveLength(1);
    const described = (await callTool(crm.admin, "describe_attachments", { activityId: note.id })) as { activities: { inline: string[]; files: { name: string; dimensions?: string }[] }[] };
    expect(described.activities[0].inline).toEqual([img.id]);
    expect(described.activities[0].files.map((f) => f.name).sort()).toEqual(["board.png", "deal.pdf"]);
    expect(described.activities[0].files.find((f) => f.name === "board.png")?.dimensions).toBe("640×480");
    await expect(callTool(crm.admin, "describe_attachments", {})).rejects.toThrow(/activityId or recordId/);
  });
});
