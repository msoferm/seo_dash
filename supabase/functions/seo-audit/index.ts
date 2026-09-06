/**
 * POST { client_id }
 * Technical on-page SEO audit: fetches the client's top pages and checks titles,
 * meta descriptions, H1s, content depth, schema, and obvious issues.
 * Returns { summary, issues: [{page, issue, severity, fix}] }.
 * Uses a line format (not JSON) so a long list of Hebrew issues can't break parsing.
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";
import { callClaudeAgent, DEFAULT_MODEL, textOf } from "../_shared/anthropic.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const { client_id } = await req.json();
    if (!client_id) return errorResponse("חסר client_id", 400);

    const { data: client } = await sb.from("clients").select("*").eq("id", client_id).maybeSingle();
    if (!client) return errorResponse("לקוח לא נמצא", 404);

    const { data: gscRows } = await sb.from("gsc_metrics").select("page, clicks").eq("client_id", client_id).not("page", "is", null);
    const agg = new Map<string, number>();
    for (const r of gscRows || []) agg.set(r.page, (agg.get(r.page) || 0) + (r.clicks || 0));
    const topPages = [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([p]) => p);
    const home = client.domain?.startsWith("http") ? client.domain : `https://${(client.domain || "").replace(/^sc-domain:/, "")}`;
    const urls = [...new Set([home, ...topPages])].filter(Boolean).slice(0, 4);
    if (urls.length === 0) return errorResponse("אין עמודים לבדיקה. סנכרן GSC תחילה.", 400);

    const system =
      "אתה מבקר SEO טכני מקצועי. משוך את העמודים שסופקו (web_fetch) ובדוק לכל עמוד: כותרת SEO (title) — קיימת, אורך, ייחודיות; " +
      "תיאור Meta — קיים, אורך, מזמין; כותרת H1 יחידה ורלוונטית; מבנה כותרות; עומק ואיכות תוכן; נתוני סכמה; תמונות עם alt; קישורים פנימיים; בעיות אינדוקס בולטות. " +
      "החזר בפורמט המדויק הבא בלבד, בלי JSON ובלי טקסט נוסף. שורה ראשונה:\n" +
      "SUMMARY: <סיכום קצר של מצב האתר במשפט-שניים>\n" +
      "ואז שורה לכל בעיה, בדיוק בפורמט (מופרד בתו |):\n" +
      "ISSUE: <high|medium|low> | <כתובת העמוד> | <תיאור הבעיה> | <התיקון המומלץ>\n" +
      "אל תשתמש בתו | בתוך הטקסט. כתוב בעברית (למעט כתובות/תגיות). רק בעיות אמיתיות שמצאת בעמודים.";

    const userMsg = `עסק: ${client.name} (${client.domain}).\nבדוק את העמודים:\n${urls.map((u) => `- ${u}`).join("\n")}`;

    const resp = await callClaudeAgent({
      model: DEFAULT_MODEL,
      max_tokens: 8000,
      system,
      messages: [{ role: "user", content: userMsg }],
      tools: [{ type: "web_fetch_20250910", name: "web_fetch", max_uses: 5 }],
    });

    const text = textOf(resp);
    const summary = (text.match(/SUMMARY:\s*(.+)/)?.[1] || "").trim();
    const issues: any[] = [];
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*ISSUE:\s*(.+)$/);
      if (!m) continue;
      const parts = m[1].split("|").map((s) => s.trim());
      if (parts.length < 4) continue;
      const severity = ["high", "medium", "low"].includes(parts[0]) ? parts[0] : "medium";
      issues.push({ severity, page: parts[1], issue: parts[2], fix: parts.slice(3).join(" | ") });
    }
    if (!summary && issues.length === 0) {
      return errorResponse(`האודיט לא החזיר תוצאות תקינות. פלט: ${text.slice(0, 250)}`, 502);
    }

    // Persist: a fresh audit replaces the previous findings for this client.
    await sb.from("audit_issues").delete().eq("client_id", client_id);
    if (issues.length > 0) {
      const rows = issues.map((i) => ({ client_id, page: i.page, issue: i.issue, fix: i.fix, severity: i.severity, status: "pending" }));
      const { error } = await sb.from("audit_issues").insert(rows);
      if (error) throw new Error(`insert failed: ${error.message}`);
    }

    return jsonResponse({ summary, count: issues.length, pages_checked: urls.length });
  } catch (e) {
    return errorResponse(`שגיאה באודיט: ${(e as Error).message}`, 500);
  }
});
