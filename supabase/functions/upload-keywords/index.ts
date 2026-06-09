/**
 * POST multipart/form-data with `file` (CSV/TSV from Google Keyword Planner)
 * Query param: client_id, replace (boolean, default false)
 * Parses UTF-16 LE tab-separated Keyword Planner exports.
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";

const MONTH_ABBR: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

function decodeBytes(bytes: Uint8Array): string {
  // Try UTF-16 LE/BE then UTF-8
  for (const enc of ["utf-16le", "utf-16be", "utf-8"]) {
    try {
      const text = new TextDecoder(enc, { fatal: false }).decode(bytes);
      if (text.includes("\t") || text.includes("Keyword")) {
        return text.replace(/^﻿/, "");
      }
    } catch { /* try next */ }
  }
  return new TextDecoder("utf-8").decode(bytes);
}

function safeInt(v: string | undefined): number | null {
  if (v == null) return null;
  const s = v.trim().replace(/,/g, "");
  if (!s || s === "-" || s === "--") return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : Math.round(n);
}

function safeFloat(v: string | undefined): number | null {
  if (v == null) return null;
  const s = v.trim().replace(/,/g, "");
  if (!s || s === "-" || s === "--") return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

interface KeywordRow {
  term: string;
  monthly_searches: number;
  competition: string | null;
  competition_index: number | null;
  top_bid_low: number | null;
  top_bid_high: number | null;
  monthly_history: { year: number; month: number; searches: number }[];
}

function parseCsv(text: string): KeywordRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  // Find header row
  const headerIdx = lines.findIndex((l) => l.split("\t")[0] === "Keyword");
  if (headerIdx === -1) return [];
  const headers = lines[headerIdx].split("\t");
  const monthRe = /Searches:\s+(\w{3})\s+(\d{4})/;
  const monthCols: { idx: number; year: number; month: number }[] = [];
  for (let i = 0; i < headers.length; i++) {
    const m = monthRe.exec(headers[i]);
    if (m) {
      const month = MONTH_ABBR[m[1].slice(0, 3)];
      if (month) monthCols.push({ idx: i, year: parseInt(m[2]), month });
    }
  }
  const col = (name: string) => headers.indexOf(name);
  const rows: KeywordRow[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cells = lines[i].split("\t");
    const term = (cells[col("Keyword")] || "").trim();
    if (!term) continue;
    rows.push({
      term,
      monthly_searches: safeInt(cells[col("Avg. monthly searches")]) || 0,
      competition: (cells[col("Competition")] || "").trim() || null,
      competition_index: safeInt(cells[col("Competition (indexed value)")]),
      top_bid_low: safeFloat(cells[col("Top of page bid (low range)")]),
      top_bid_high: safeFloat(cells[col("Top of page bid (high range)")]),
      monthly_history: monthCols.map((mc) => ({
        year: mc.year,
        month: mc.month,
        searches: safeInt(cells[mc.idx]) || 0,
      })),
    });
  }
  return rows;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const url = new URL(req.url);
    const clientId = parseInt(url.searchParams.get("client_id") || "0");
    const replace = url.searchParams.get("replace") === "true";
    if (!clientId) return errorResponse("חסר client_id", 400);

    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return errorResponse("חסר קובץ", 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const text = decodeBytes(bytes);
    const rows = parseCsv(text);
    if (rows.length === 0) return errorResponse("לא נמצאו מילות מפתח בקובץ", 400);

    if (replace) {
      await sb.from("keywords").delete().eq("client_id", clientId);
    }

    let inserted = 0;
    for (const row of rows) {
      const { data: kw } = await sb
        .from("keywords")
        .insert({
          client_id: clientId,
          term: row.term,
          monthly_searches: row.monthly_searches,
          competition: row.competition,
          competition_index: row.competition_index,
          top_bid_low: row.top_bid_low,
          top_bid_high: row.top_bid_high,
          source: "csv",
        })
        .select("id")
        .single();
      if (!kw) continue;
      if (row.monthly_history.length > 0) {
        await sb.from("monthly_searches").insert(
          row.monthly_history.map((h) => ({
            keyword_id: kw.id,
            year: h.year,
            month: h.month,
            searches: h.searches,
          })),
        );
      }
      inserted++;
    }
    return jsonResponse({ inserted, filename: file.name });
  } catch (e) {
    console.error(e);
    return errorResponse((e as Error).message, 500);
  }
});
