import { fakePackage } from "../extensions/testing";
import { installExtension } from "../ops/extensions";
import { setupTestCrm } from "../ops/testing";
import { AI_TOOLS, callTool, findTool, listAiTools, registerAiTool } from "./tools";

describe("customisation AI tools", () => {
  it("are in the catalog with correct mutating flags", () => {
    const flags = Object.fromEntries(AI_TOOLS.filter((t) => /module|appearance|extension/.test(t.name)).map((t) => [t.name, t.mutating]));
    expect(flags).toEqual({ list_modules: false, set_module_enabled: true, get_appearance: false, set_appearance: true, apply_appearance_preset: true, list_extensions: false, set_extension_enabled: true });
  });

  it("drive modules, appearance and extensions through src/ops", async () => {
    const crm = await setupTestCrm();
    const modules = (await callTool(crm.admin, "list_modules", {})) as { id: string; enabled: boolean; required?: boolean }[];
    expect(modules.find((m) => m.id === "records")).toMatchObject({ required: true, enabled: true });
    await callTool(crm.admin, "set_module_enabled", { id: "reports", enabled: false });
    expect(((await callTool(crm.admin, "list_modules", {})) as { id: string; enabled: boolean }[]).find((m) => m.id === "reports")?.enabled).toBe(false);
    await expect(callTool(crm.as("member"), "set_module_enabled", { id: "reports", enabled: true })).rejects.toMatchObject({ code: "forbidden" });

    const a = (await callTool(crm.admin, "set_appearance", { accent: "#16a34a", density: "compact" })) as Record<string, unknown>;
    expect(a).toMatchObject({ accent: "#16a34a", density: "compact", hasLogo: false });
    const preset = (await callTool(crm.admin, "apply_appearance_preset", { id: "rose" })) as Record<string, unknown>;
    expect(preset).toMatchObject({ preset: "rose", sidebar: "accent" });
    const got = (await callTool(crm.as("viewer"), "get_appearance", {})) as { appearance: Record<string, unknown>; presets: { id: string }[] };
    expect(got.appearance.preset).toBe("rose");
    expect(got.presets.map((p) => p.id)).toContain("high-contrast");

    await installExtension(crm.admin, fakePackage("hello-module"));
    expect(await callTool(crm.admin, "list_extensions", {})).toMatchObject([{ id: "hello-module", enabled: true }]);
    expect(await callTool(crm.admin, "set_extension_enabled", { id: "hello-module", enabled: false })).toMatchObject({ enabled: false });
  });

  it("extension tools join the dynamic catalog", async () => {
    const crm = await setupTestCrm();
    const off = registerAiTool({ name: "ext_hello", description: "Says hello for tests.", inputSchema: { type: "object" }, mutating: false, handler: () => "hi" });
    try {
      expect(listAiTools().at(-1)?.name).toBe("ext_hello");
      expect(AI_TOOLS.some((t) => t.name === "ext_hello")).toBe(false);
      expect(await callTool(crm.admin, "ext_hello", {})).toBe("hi");
      expect(() => registerAiTool({ ...findTool("ext_hello")! })).toThrow(/already exists/);
      expect(() => registerAiTool({ name: "Bad Name", description: "x", inputSchema: { type: "object" }, mutating: true, handler: () => 1 })).toThrow(/Invalid/);
    } finally {
      off();
    }
    expect(findTool("ext_hello")).toBeUndefined();
  });
});
