/**
 * POST { client_id }
 * Technical on-page SEO audit: fetches the client's top pages and checks titles,
 * meta descriptions, H1s, content depth, schema, and obvious issues.
 * Returns { summary, issues: [{page, issue, severity, fix}] }.
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";
import { callClaudeAgent, DEFAULT_MODEL, textOf, extractJson } from "../_shared/anthropic.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const { client_id } = await req.json();
    if (!client_id) return errorResponse("חסר client_id", 400);

    const { data: client } = await sb.from("clients").select("*").eq("id", client_id).maybeSingle();
    if (!client) return errorResponse("לקוח לא נמצא", 404);

    // Top pages by clicks (real traffic) + homepage
    const { data: gscRows } = await sb.from("gsc_metrics").select("page, clicks").eq("client_id", client_id).not("page", "is", null);
    const agg = new Map<string, number>();
    for (const r of gscRows || []) agg.set(r.page, (agg.get(r.page) || 0) + (r.clicks || 0));
    const topPages = [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([p]) => p);
    const home = client.domain?.startsWith("http") ? client.domain : `https://${(client.domain || "").replace(/^sc-domain:/, "")}`;
    const urls = [...new Set([home, ...topPages])].filter(Boolean).slice(0, 4);
    if (urls.length === 0) return errorResponse("אין עמודים לבדיקה. סנכרן GSC תחילה.", 400);

    const system =
      "אתה מבקר SEO טכני מקצועי. משוך את העמודים שסופקו (web_fetch) ובדוק לכל עמוד: " +
      "כותרת SEO (title) — קיימת, אורך, ייחודיות; תיאור Meta — קיים, אורך, מזמין; כותרת H1 יחידה ורלוונטית; " +
      "מבנה כותרות; עומק ואיכות תוכן; נתוני סכמה (structured data); תמונות עם alt; קישורים פנימיים; בעיות אינדוקס בולטות. " +
      "לכל בעיה ציין חומרה: high/medium/low, ותיקון קונקרטי. " +
      "אחרי הבדיקה החזר אך ורק JSON: " +
      `{"summary":"סיכום קצר של מצב האתר","issues":[{"page":"url","issue":"תיאור הבעיה","severity":"high|medium|low","fix":"התיקון המומלץ"}]}. ` +
      "כתוב בעברית (למעט כתובות/תגיות). התמקד בבעיות אמיתיות שמצאת בעמודים.";

    const userMsg =
      `עסק: ${client.name} (${client.domain}).\nבדוק את העמודים הבאים:\n${urls.map((u) => `- ${u}`).join("\n")}`;

    const resp = await callClaudeAgent({
      model: DEFAULT_MODEL,
      max_tokens: 4500,
      system,
      messages: [{ role: "user", content: userMsg }],
      tools: [{ type: "web_fetch_20250910", name: "web_fetch", max_uses: 5 }],
    });

    let parsed: any;
    try {
      parsed = extractJson(textOf(resp));
    } catch {
      return errorResponse("לא ניתן היה לפענח את תוצאות האודיט. נסה שוב.", 502);
    }
    const issues = (Array.isArray(parsed.issues) ? parsed.issues : []).map((i: any) => ({
      page: String(i.page || ""),
      issue: String(i.issue || ""),
      severity: ["high", "medium", "low"].includes(i.severity) ? i.severity : "medium",
      fix: String(i.fix || ""),
    }));
    return jsonResponse({ summary: String(parsed.summary || "").trim(), issues, pages_checked: urls.length });
  } catch (e) {
    return errorResponse(`שגיאה באודיט: ${(e as Error).message}`, 500);
  }
});
