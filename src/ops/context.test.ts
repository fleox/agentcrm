import { describe, expect, it } from "vitest";
import { assertCan, can, OpsError, PERMISSIONS } from "./context";
import type { CrmUser } from "../core/types";

const user = (role: CrmUser["role"], disabled = false): CrmUser => ({ id: role, email: `${role}@x.io`, name: role, role, disabled });

describe("permissions", () => {
  it("admin > member > viewer", () => {
    expect(can(user("admin"), "schema.write")).toBe(true);
    expect(can(user("member"), "schema.write")).toBe(false);
    expect(can(user("member"), "records.write")).toBe(true);
    expect(can(user("member"), "views.writeOwn")).toBe(true);
    expect(can(user("member"), "views.writeShared")).toBe(false);
    expect(can(user("viewer"), "records.read")).toBe(true);
    expect(can(user("viewer"), "records.write")).toBe(false);
    for (const a of PERMISSIONS.viewer) expect(PERMISSIONS.member.has(a)).toBe(true);
    for (const a of PERMISSIONS.member) expect(PERMISSIONS.admin.has(a)).toBe(true);
  });

  it("system context can do everything, disabled users nothing", () => {
    expect(can(null, "compact")).toBe(true);
    expect(can(user("admin", true), "records.read")).toBe(false);
  });

  it("assertCan throws a forbidden OpsError", () => {
    expect(() => assertCan({ user: user("viewer") }, "records.delete")).toThrow(OpsError);
    try {
      assertCan({ user: user("viewer") }, "records.delete");
    } catch (e) {
      expect((e as OpsError).code).toBe("forbidden");
    }
  });
});
