import { describe, expect, it } from "vitest";
import { demoChartPng } from "../ops/demoFiles";
import { fileImageMarkdown, fileKind, formatBytes, guessMime, imageDimensions, inlineFileIds, isPreviewable, sanitizeFileName } from "./files";

describe("core/files", () => {
  it("guesses MIME types and kinds", () => {
    expect(guessMime("a.PDF")).toBe("application/pdf");
    expect(guessMime("a.bin", "image/png; charset=x")).toBe("image/png");
    expect(guessMime("noext")).toBe("application/octet-stream");
    expect(fileKind("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe("spreadsheet");
    expect(fileKind("", "deck.pptx")).toBe("presentation");
    expect(fileKind("image/svg+xml")).toBe("image");
    expect(isPreviewable("image/svg+xml")).toBe(false);
    expect(isPreviewable("text/html")).toBe(false);
    expect(isPreviewable("application/pdf")).toBe(true);
  });

  it("formats sizes, sanitizes names, finds inline images", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(25 * 1024 * 1024)).toBe("25 MB");
    expect(sanitizeFileName("../../etc/pass<wd>.txt")).toBe("passwd.txt");
    expect(sanitizeFileName("")).toBe("file");
    const md = `Hello ${fileImageMarkdown("a [b].png", "f1")} and ![x](file:f2) ![y](https://x.io/a.png) ${fileImageMarkdown("dup", "f1")}`;
    expect(md).toContain("![a b.png](file:f1)");
    expect(inlineFileIds(md)).toEqual(["f1", "f2"]);
  });

  it("reads image dimensions from headers", () => {
    expect(imageDimensions(demoChartPng().bytes)).toEqual({ width: 360, height: 200 });
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 10, 0, 20, 0, 0, 0]);
    expect(imageDimensions(gif)).toEqual({ width: 10, height: 20 });
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 50, 0, 100, 3, 0, 0, 0]);
    expect(imageDimensions(jpeg)).toEqual({ width: 100, height: 50 });
    expect(imageDimensions(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
