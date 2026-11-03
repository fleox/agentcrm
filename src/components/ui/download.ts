// Browser file downloads (CSV / JSON exports). No-op outside a browser.

export function downloadText(filename: string, content: string, mime = "text/plain;charset=utf-8"): void {
  if (typeof document === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return;
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCsv(filename: string, csv: string): void {
  // BOM so Excel opens UTF-8 correctly.
  downloadText(filename.endsWith(".csv") ? filename : `${filename}.csv`, `﻿${csv}`, "text/csv;charset=utf-8");
}

export function downloadJson(filename: string, value: unknown): void {
  downloadText(filename.endsWith(".json") ? filename : `${filename}.json`, JSON.stringify(value, null, 2), "application/json");
}

// RFC 4180 CSV from rows of cells.
export function toCsv(rows: unknown[][]): string {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n");
}

// Date stamp for file names: 2024-06-15.
export function fileStamp(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}
