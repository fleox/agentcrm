import { describe, expect, it } from "vitest";
import { createMemoryStore } from "../data/memory";
import { resolveCrmUser } from "./auth";

async function store(users: object[], settings?: object) {
  const s = createMemoryStore({ initial: { users: users as never, settings: settings ? [settings as never] : [] } });
  await s.ready();
  return s;
}

describe("resolveCrmUser", () => {
  it("maps the single-user identity to the owner", async () => {
    const s = await store([{ id: "u1", email: "a@x.io", name: "A", role: "member" }, { id: "boss", email: "b@x.io", name: "B", role: "admin" }], { id: "general", ownerUserId: "boss" });
    expect(resolveCrmUser(s, { uid: "local", email: "", displayName: "", role: "admin" })!.id).toBe("boss");
  });

  it("matches by id then email, else synthesizes", async () => {
    const s = await store([{ id: "u1", email: "a@x.io", name: "A", role: "viewer" }]);
    expect(resolveCrmUser(s, { uid: "u1", email: "", displayName: "", role: "admin" })!.role).toBe("viewer");
    expect(resolveCrmUser(s, { uid: "fb-123", email: "A@x.io", displayName: "", role: "admin" })!.id).toBe("u1");
    expect(resolveCrmUser(s, { uid: "fb-9", email: "new@x.io", displayName: "New", role: "member" })).toEqual({ id: "fb-9", email: "new@x.io", name: "New", role: "member" });
    expect(resolveCrmUser(s, null)).toBeNull();
  });
});
