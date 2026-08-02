/**
 * POST { client_id: number, from: string (YYYY-MM-DD), to: string (YYYY-MM-DD) }
 * Gathers the client's SEO metrics for the period (GSC clicks, GA4 conversions, ZEFO
 * rankings, manual links, keyword research) and asks Claude to draft two Hebrew
 * narrative blocks for the monthly report: "סיכום פעילות" and "המלצות להמשך".
 * Returns { summary, recommendations }. The frontend saves/edits them.
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";
import { callClaude, DEFAULT_MODEL } from "../_shared/anthropic.ts";
import { stripJsonFence } from "../_shared/faq_prompts.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const { client_id, from, to } = await req.json();
    if (!client_id) return errorResponse("חסר client_id", 400);
    if (!from || !to) return errorResponse("חסר טווח תאריכים", 400);

    const { data: client } = await sb.from("clients").select("*").eq("id", client_id).maybeSingle();
    if (!client) return errorResponse("לקוח לא נמצא", 404);

    // Gather everything for the period in parallel
    const [gscRes, convRes, zefoRes, linksRes, kwRes] = await Promise.all([
      sb.from("gsc_daily").select("clicks, impressions, avg_position").eq("client_id", client_id).gte("date", from).lte("date", to),
      sb.from("ga4_conversions").select("source, channel, conversions, sessions").eq("client_id", client_id).gte("date", from).lte("date", to),
      sb.from("zefo_keywords").select("keyword, ranking, previous_ranking, initial_ranking, best_rank, local_searches").eq("client_id", client_id).order("ranking", { ascending: true, nullsFirst: false }).limit(40),
      sb.from("report_links").select("link_type, url").eq("client_id", client_id).gte("done_on", from).lte("done_on", to),
      sb.from("keywords").select("term, monthly_searches").eq("client_id", client_id).order("monthly_searches", { ascending: false }).limit(12),
    ]);

    const gsc = gscRes.data || [];
    const conv = convRes.data || [];
    const zefo = zefoRes.data || [];
    const links = linksRes.data || [];
    const kw = kwRes.data || [];

    // Aggregate GSC
    let clicks = 0, impressions = 0, wPos = 0;
    for (const r of gsc) { clicks += r.clicks || 0; impressions += r.impressions || 0; wPos += (r.avg_position || 0) * (r.impressions || 0); }
    const avgPos = impressions > 0 ? Math.round((wPos / impressions) * 10) / 10 : "—";

    // Aggregate conversions
    let totalConv = 0, totalSess = 0;
    const bySrc = new Map<string, number>();
    for (const r of conv) {
      totalConv += r.conversions || 0;
      totalSess += r.sessions || 0;
      const label = r.source || r.channel || "לא ידוע";
      bySrc.set(label, (bySrc.get(label) || 0) + (r.conversions || 0));
    }
    const topSrc = [...bySrc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

    // Link types breakdown
    const linkTypes = new Map<string, number>();
    for (const l of links) linkTypes.set(l.link_type, (linkTypes.get(l.link_type) || 0) + 1);

    const fmt = (arr: any[], f: (x: any) => string) => (arr.length ? arr.map(f).join("\n") : "אין נתונים");

    const context = `לקוח: ${client.name} (דומיין: ${client.domain})
הערות על העסק: ${client.notes || "אין"}
תקופת הדוח: ${from} עד ${to}

תנועה אורגנית (Google Search Console):
- קליקים אורגניים: ${clicks.toLocaleString()}
- חשיפות: ${impressions.toLocaleString()}
- מיקום ממוצע: ${avgPos}

המרות (GA4) בתקופה: ${totalConv.toLocaleString()} (מתוך ${totalSess.toLocaleString()} סשנים)
המרות לפי מקור:
${fmt(topSrc, ([s, c]) => `- ${s}: ${c}`)}

מיקומים אורגניים בגוגל (ZEFO) — מילה | מיקום נוכחי | מיקום התחלתי | הכי טוב | חיפושים:
${fmt(zefo.slice(0, 25), (z) => `- ${z.keyword} | ${z.ranking ?? "—"} | ${z.initial_ranking ?? "—"} | ${z.best_rank ?? "—"} | ${z.local_searches ?? "—"}`)}

קישורים חיצוניים שבוצעו בתקופה: ${links.length} קישורים
פילוח לפי סוג:
${fmt([...linkTypes.entries()], ([t, c]) => `- ${t}: ${c}`)}

מילות מפתח מרכזיות לפי נפח חיפוש:
${fmt(kw, (k) => `- ${k.term} (${k.monthly_searches})`)}`;

    const system =
      "אתה מנהל קידום אורגני (SEO) מקצועי שכותב דוח חודשי ללקוח. בהינתן נתוני הלקוח לתקופה, כתוב שני חלקים בעברית, בגוף שלישי/ראשון-רבים ובטון מקצועי וברור, ללא סימני מרקדאון: " +
      "1) 'summary' — סיכום פעילות החודש: מה בוצע (קישורים חיצוניים, תוכן/מאמרים, אופטימיזציה, שיפור מיקומים והמרות), עם התייחסות למספרים האמיתיים שקיבלת. 2-4 פסקאות קצרות. " +
      "2) 'recommendations' — המלצות להמשך: צעדים קונקרטיים לחודש הבא (מילים לחיזוק, תוכן, קישורים, שאלות ותשובות). 3-6 המלצות. " +
      "החזר אך ורק JSON תקין: {\"summary\":\"...\",\"recommendations\":\"...\"}. " +
      "אל תמציא נתונים שאינם בקלט; אם אין נתונים לתחום מסוים, אל תתייחס אליו כאילו יש.";

    const resp = await callClaude({
      model: DEFAULT_MODEL,
      max_tokens: 2000,
      system,
      messages: [{ role: "user", content: context }],
    });

    const raw = resp.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    let parsed: any;
    try {
      parsed = JSON.parse(stripJsonFence(raw));
    } catch {
      return errorResponse(`קלוד החזיר תשובה שלא ניתן לפענח: ${raw.slice(0, 200)}`, 502);
    }

    return jsonResponse({
      summary: String(parsed.summary || "").trim(),
      recommendations: String(parsed.recommendations || "").trim(),
    });
  } catch (e) {
    return errorResponse(`שגיאה ביצירת הדוח: ${(e as Error).message}`, 500);
  }
});
