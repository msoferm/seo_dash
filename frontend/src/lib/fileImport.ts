/**
 * Turn any supported upload (CSV / TSV / TXT / XLSX / XLS / ZIP, single files, many files,
 * or a dropped folder) into a flat list of CSV-text "files". Each result is fed to the
 * existing `data-upload` edge function, which auto-detects the source (GSC / ZEFO / …),
 * normalizes the columns and stores deduped rows. XLSX/XLS workbooks are expanded one CSV
 * per sheet (a GSC export has Queries / Pages / … sheets); ZIPs are expanded recursively.
 */
import * as XLSX from "xlsx";
import JSZip from "jszip";

export interface ParsedFile { name: string; text: string }

const RE_TEXT = /\.(csv|tsv|txt)$/i;
const RE_SHEET = /\.(xlsx|xls|xlsm)$/i;
const RE_ZIP = /\.zip$/i;

export function isSupported(name: string): boolean {
  return RE_TEXT.test(name) || RE_SHEET.test(name) || RE_ZIP.test(name);
}

function sheetsToCsv(buf: ArrayBuffer, baseName: string): ParsedFile[] {
  const wb = XLSX.read(buf, { type: "array" });
  const out: ParsedFile[] = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const csv = XLSX.utils.sheet_to_csv(ws);
    if (!csv.trim()) continue;
    const label = wb.SheetNames.length > 1 ? `${baseName} — ${sheetName}.csv` : `${baseName}.csv`;
    out.push({ name: label, text: csv });
  }
  return out;
}

async function expandOne(name: string, getText: () => Promise<string>, getBuf: () => Promise<ArrayBuffer>): Promise<ParsedFile[]> {
  if (RE_TEXT.test(name)) return [{ name, text: await getText() }];
  if (RE_SHEET.test(name)) return sheetsToCsv(await getBuf(), name.replace(RE_SHEET, ""));
  return [];
}

async function expandZip(buf: ArrayBuffer): Promise<{ files: ParsedFile[]; skipped: string[] }> {
  const zip = await JSZip.loadAsync(buf);
  const files: ParsedFile[] = [];
  const skipped: string[] = [];
  const entries = Object.values(zip.files).filter((e) => !e.dir);
  for (const entry of entries) {
    const n = entry.name.split("/").pop() || entry.name;
    if (RE_TEXT.test(n)) files.push({ name: n, text: await entry.async("string") });
    else if (RE_SHEET.test(n)) files.push(...sheetsToCsv(await entry.async("arraybuffer"), n.replace(RE_SHEET, "")));
    else skipped.push(n);
  }
  return { files, skipped };
}

/** Expand a single browser File into one or more CSV-text files. */
export async function expandFile(file: File): Promise<{ files: ParsedFile[]; skipped: string[] }> {
  if (RE_ZIP.test(file.name)) return await expandZip(await file.arrayBuffer());
  const files = await expandOne(file.name, () => file.text(), () => file.arrayBuffer());
  return { files, skipped: files.length ? [] : [file.name] };
}
