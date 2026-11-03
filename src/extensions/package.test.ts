import JSZip from "jszip";
import { bundleImports, ExtensionPackageError, fingerprint, packExtension, readExtensionZip, rewriteRuntimeImports, validateManifest } from "./package";
import { compareVersions, EXTENSION_API_VERSION, isCompatibleApiVersion } from "./api";
import { fakePackage } from "./testing";

describe("extension packages", () => {
  it("packs and reads back a package", async () => {
    const pkg = { ...fakePackage("hello-module"), files: { "bundle.js": "export default {};", "style.css": ".a{}" } };
    pkg.manifest.style = "style.css";
    const zip = await packExtension(pkg);
    const back = await readExtensionZip(zip);
    expect(back).toEqual(pkg);
  });

  it("accepts a ZIP wrapped in one folder (macOS Compress)", async () => {
    const zip = new JSZip();
    const pkg = fakePackage("wrapped-ext");
    zip.file("wrapped-ext/manifest.json", JSON.stringify(pkg.manifest));
    zip.file("wrapped-ext/bundle.js", pkg.files["bundle.js"]);
    zip.file("__MACOSX/wrapped-ext/._bundle.js", "junk");
    const back = await readExtensionZip(await zip.generateAsync({ type: "uint8array" }));
    expect(back.manifest.id).toBe("wrapped-ext");
  });

  it("reports precise errors", async () => {
    await expect(readExtensionZip(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({ code: "invalidZip" });
    const empty = new JSZip();
    empty.file("readme.txt", "hi");
    await expect(readExtensionZip(await empty.generateAsync({ type: "uint8array" }))).rejects.toMatchObject({ code: "missingManifest" });
    const noBundle = new JSZip();
    noBundle.file("manifest.json", JSON.stringify(fakePackage("x-ext").manifest));
    await expect(readExtensionZip(await noBundle.generateAsync({ type: "uint8array" }))).rejects.toMatchObject({ code: "missingEntry" });
    const err = (() => {
      try {
        validateManifest({ id: "A", kind: "plugin", version: "1", apiVersion: "1.0.0", entry: "main.js", extra: true });
      } catch (e) {
        return e as ExtensionPackageError;
      }
    })()!;
    expect(err.code).toBe("invalidManifest");
    expect(err.details!.length).toBeGreaterThanOrEqual(5);
    expect(() => validateManifest({ ...fakePackage("x-ext").manifest, apiVersion: "0.1.0" })).toThrow(/not supported/);
  });

  it("lists bare imports and rewrites only the runtime ones", () => {
    const code = `import{jsx as e}from"react/jsx-runtime";import * as R from '@agent-crm/runtime';import { a } from "./local.js";export { b } from "lucide-react";const m = import("react");import x from "dayjs";`;
    expect(bundleImports(code)).toEqual(["@agent-crm/runtime", "dayjs", "lucide-react", "react", "react/jsx-runtime"]);
    const out = rewriteRuntimeImports(code, (s) => `/rt/${s}.js`);
    expect(out).toContain('from"/rt/react/jsx-runtime.js"');
    expect(out).toContain("from '/rt/@agent-crm/runtime.js'");
    expect(out).toContain('from "/rt/lucide-react.js"');
    expect(out).toContain('import("/rt/react.js")');
    expect(out).toContain('from "dayjs"');
    expect(out).toContain('from "./local.js"');
  });

  it("versions and fingerprints", () => {
    expect(compareVersions("1.2.0", "1.10.0")).toBe(-1);
    expect(compareVersions("2.0.0-beta.1", "2.0.0")).toBe(0);
    expect(isCompatibleApiVersion(EXTENSION_API_VERSION)).toBe(true);
    expect(isCompatibleApiVersion("1.0")).toBe(false);
    const p = fakePackage("a-ext");
    expect(fingerprint(p.manifest, p.files)).toBe(fingerprint(p.manifest, { ...p.files }));
    expect(fingerprint(p.manifest, p.files)).not.toBe(fingerprint(p.manifest, { "bundle.js": `${p.files["bundle.js"]} ` }));
  });
});
