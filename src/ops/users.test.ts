import { recordOf } from "./store";
import { describe, expect, it } from "vitest";
import { setupTestCrm } from "./testing";
import { createUser, deleteUser, listUsers, setUserRole, updateUser } from "./users";
import { getConfigDoc, getSettings, setConfigDoc, updateSettings } from "./settings";
import { createRecord } from "./records";

describe("users ops", () => {
  it("creates, updates and protects the last admin", async () => {
    const crm = await setupTestCrm();
    const u = await createUser(crm.admin, { email: "New@Example.com", role: "viewer" });
    expect(u).toMatchObject({ email: "new@example.com", name: "new", role: "viewer" });
    await expect(createUser(crm.admin, { email: "new@example.com" })).rejects.toMatchObject({ code: "conflict" });
    await expect(createUser(crm.admin, { email: "bad" })).rejects.toMatchObject({ code: "validation" });
    await expect(createUser(crm.as("member"), { email: "x@y.io" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(setUserRole(crm.admin, "owner", "member")).rejects.toThrow(/at least one active admin/);
    await expect(updateUser(crm.admin, "owner", { disabled: true })).rejects.toThrow(/admin/);
    expect(listUsers(crm.admin).map((x) => x.id)).toContain(u.id);
  });

  it("self service for name only; delete reassigns ownership", async () => {
    const crm = await setupTestCrm();
    const member = crm.as("member");
    expect((await updateUser(member, "u-member", { name: "Mel M." })).name).toBe("Mel M.");
    await expect(updateUser(member, "u-member", { role: "admin" })).rejects.toMatchObject({ code: "forbidden" });
    const c = await createRecord(member, "companies", { name: "Owned" });
    const res = await deleteUser(crm.admin, "u-member", { reassignTo: "owner" });
    expect(res.reassigned).toBe(1);
    expect(recordOf(crm.store, c.id)!.ownerId).toBe("owner");
  });
});

describe("settings ops", () => {
  it("defaults, validation, config docs refuse secrets", async () => {
    const crm = await setupTestCrm();
    expect(getSettings(crm.admin)).toMatchObject({ name: "Test CRM", defaultCurrency: "USD", ownerUserId: "owner", staleDealDays: 14 });
    expect((await updateSettings(crm.admin, { defaultCurrency: "eur" })).defaultCurrency).toBe("EUR");
    await expect(updateSettings(crm.admin, { defaultCurrency: "euro" })).rejects.toMatchObject({ code: "validation" });
    await expect(updateSettings(crm.as("member"), { name: "x" })).rejects.toMatchObject({ code: "forbidden" });
    // Unknown keys (typos from the CLI `--set`) and bad values are refused, nothing stored.
    await expect(updateSettings(crm.admin, { bogusKey: 1 } as never)).rejects.toThrow(/Unknown setting "bogusKey"/);
    await expect(updateSettings(crm.admin, { weekStartsOn: 3 as never })).rejects.toMatchObject({ code: "validation" });
    await expect(updateSettings(crm.admin, { locale: "not a locale" })).rejects.toMatchObject({ code: "validation" });
    await expect(updateSettings(crm.admin, { timezone: "Mars/Olympus" })).rejects.toMatchObject({ code: "validation" });
    await expect(updateSettings(crm.admin, { name: " " })).rejects.toMatchObject({ code: "validation" });
    expect(getSettings(crm.admin)).not.toHaveProperty("bogusKey");
    expect(await updateSettings(crm.admin, { locale: "fr-FR", timezone: "Europe/Paris", weekStartsOn: 0 })).toMatchObject({ locale: "fr-FR", timezone: "Europe/Paris", weekStartsOn: 0 });
    await setConfigDoc(crm.admin, "hosting", { connectorId: "s3", settings: { bucket: "b" } });
    expect(getConfigDoc(crm.admin, "hosting")).toMatchObject({ connectorId: "s3" });
    await expect(setConfigDoc(crm.admin, "hosting", { settings: { secretAccessKey: "SK" } })).rejects.toThrow(/secret/);
  });
});
