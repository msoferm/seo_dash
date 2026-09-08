/**
 * POST { client_id, filename, content }   (content = raw CSV/TSV text)
 * Auto-detects the source, columns and date range with Claude (from the header + a few
 * sample rows), normalizes all rows in code, and stores them for cross-source joining.
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";
import { callClaude, DEFAULT_MODEL, textOf, extractJson } from "../_shared/anthropic.ts";

function parseDelimited(text: string): string[][] {
  const t = text.replace(/^﻿/, "");
  const delim = (t.split("\n")[0].match(/\t/g) || []).length > (t.split("\n")[0].match(/,/g) || []).length ? "\t" : ",";
  const rows: string[][] = []; let field = ""; let row: string[] = []; let q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"') { if (t[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch === "\r") { /* skip */ }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}
function num(v: string): number | null {
  if (v == null) return null;
  let s = String(v).replace(/[,%\s₪$]/g, "").trim();
  if (s === "" || s === "-") return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const { client_id, filename, content } = await req.json();
    if (!client_id || !content) return errorResponse("חסר קובץ", 400);

    const table = parseDelimited(content);
    if (table.length < 2) return errorResponse("הקובץ ריק או לא תקין", 400);
    const headers = table[0].map((h) => h.trim());
    const dataRows = table.slice(1);

    // Detect source + column mapping from header + samples
    const sample = dataRows.slice(0, 5).map((r) => headers.map((h, i) => `${h}: ${r[i] ?? ""}`).join(" | ")).join("\n");
    const system =
      "אתה מזהה מקור של קובץ נתוני SEO. בהינתן שמות העמודות ודוגמאות שורות, זהה את המקור ומפה עמודות. " +
      "החזר אך ורק JSON: {\"source\":\"Google Search Console|Google Analytics 4|ZEFO|Google Keyword Planner|אחר\",\"data_type\":\"תיאור קצר\",\"date_from\":\"YYYY-MM-DD או null\",\"date_to\":\"YYYY-MM-DD או null\",\"columns\":{\"page\":\"שם עמודה או null\",\"query\":\"...\",\"keyword\":\"...\",\"clicks\":\"...\",\"impressions\":\"...\",\"ctr\":\"...\",\"position\":\"...\",\"sessions\":\"...\",\"conversions\":\"...\"}}. " +
      "מפה כל שדה לשם העמודה בקובץ (בדיוק כפי שמופיע) או null אם אין. התחל ישירות ב-{.";
    const resp = await callClaude({ model: DEFAULT_MODEL, max_tokens: 800, system, messages: [{ role: "user", content: `עמודות: ${headers.join(" | ")}\n\nדוגמאות:\n${sample}` }] });
    let det: any;
    try { det = extractJson(textOf(resp)); } catch { return errorResponse("לא הצלחתי לזהות את מבנה הקובץ. נסה קובץ אחר.", 502); }

    const cols = det.columns || {};
    const idx = (name: string | null | undefined) => (name ? headers.findIndex((h) => h.toLowerCase() === String(name).toLowerCase()) : -1);
    const map = { page: idx(cols.page), query: idx(cols.query), keyword: idx(cols.keyword), clicks: idx(cols.clicks), impressions: idx(cols.impressions), ctr: idx(cols.ctr), position: idx(cols.position), sessions: idx(cols.sessions), conversions: idx(cols.conversions) };

    const { data: ds, error: dsErr } = await sb.from("uploaded_datasets").insert({
      client_id, filename: filename || null, source: det.source || "אחר", data_type: det.data_type || null,
      date_from: det.date_from && det.date_from !== "null" ? det.date_from : null,
      date_to: det.date_to && det.date_to !== "null" ? det.date_to : null,
      row_count: dataRows.length, mapping: det.columns || {},
    }).select("id").single();
    if (dsErr) throw new Error(dsErr.message);

    const rows = dataRows.map((r) => ({
      dataset_id: ds.id, client_id,
      page: map.page >= 0 ? (r[map.page] || null) : null,
      query: map.query >= 0 ? (r[map.query] || null) : null,
      keyword: map.keyword >= 0 ? (r[map.keyword] || null) : null,
      clicks: map.clicks >= 0 ? num(r[map.clicks]) : null,
      impressions: map.impressions >= 0 ? num(r[map.impressions]) : null,
      ctr: map.ctr >= 0 ? (() => { const n = num(r[map.ctr]); return n != null && n > 1 ? n / 100 : n; })() : null,
      position: map.position >= 0 ? num(r[map.position]) : null,
      sessions: map.sessions >= 0 ? num(r[map.sessions]) : null,
      conversions: map.conversions >= 0 ? num(r[map.conversions]) : null,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await sb.from("uploaded_rows").insert(rows.slice(i, i + 500));
      if (error) throw new Error(error.message);
    }

    return jsonResponse({ dataset_id: ds.id, source: det.source, data_type: det.data_type, row_count: dataRows.length, columns: det.columns, date_from: det.date_from, date_to: det.date_to });
  } catch (e) {
    return errorResponse(`שגיאה בהעלאה: ${(e as Error).message}`, 500);
  }
});
