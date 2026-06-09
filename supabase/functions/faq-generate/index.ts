/**
 * POST { page_ids: number[], business_context?: string }
 * For each page: ensure content is fetched, then ask Claude to generate the
 * 3-section FAQ (general/specific/cta) + missing_info flags.
 * Overwrites any existing FAQs for those pages.
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";
import { callClaude, DEFAULT_MODEL } from "../_shared/anthropic.ts";
import { SYSTEM_FAQ, stripJsonFence } from "../_shared/faq_prompts.ts";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.46/deno-dom-wasm.ts";

async function ensureContent(sb: any, page: any): Promise<{ title: string; excerpt: string }> {
  if (page.content_excerpt) return { title: page.title || "", excerpt: page.content_excerpt };
  let title = page.title || "";
  let excerpt = "";
  try {
    const r = await fetch(page.url, { headers: { "User-Agent": "SEO-Dashboard/1.0" }, redirect: "follow" });
    if (r.ok) {
      const html = await r.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      if (doc) {
        title = doc.querySelector("title")?.textContent?.trim() || title;
        doc.querySelectorAll("script, style, noscript").forEach((el) => el.remove());
        const text = (doc.body?.textContent || "").replace(/\s+/g, " ").trim();
        excerpt = text.slice(0, 8000);
      }
    }
  } catch { /* swallow */ }
  await sb.from("pages").update({
    title,
    content_excerpt: excerpt,
    last_crawled: new Date().toISOString(),
  }).eq("id", page.id);
  return { title, excerpt };
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const { page_ids, business_context } = await req.json();
    if (!Array.isArray(page_ids) || page_ids.length === 0) return errorResponse("חסר page_ids", 400);

    const { data: pages } = await sb.from("pages").select("*").in("id", page_ids);
    if (!pages || pages.length === 0) return errorResponse("עמודים לא נמצאו", 404);
    const { data: client } = await sb.from("clients").select("*").eq("id", pages[0].client_id).maybeSingle();
    if (!client) return errorResponse("לקוח לא נמצא", 404);

    const results: any[] = [];
    for (const page of pages) {
      const { title, excerpt } = await ensureContent(sb, page);
      const userText = `לקוח: ${client.name}
דומיין: ${client.domain}
הערות על העסק: ${client.notes || "אין"}
מידע נוסף שסופק: ${business_context || "אין"}

עמוד יעד: ${page.url}
כותרת: ${title || "לא זמין"}
תוכן העמוד (תקציר):
${excerpt || "[אין תוכן זמין]"}

צור FAQ במבנה ה-3 חלקים. החזר אך ורק JSON במבנה הבא:
{
  "general": [{"question": "...", "answer": "..."}],
  "specific": [{"question": "...", "answer": "..."}],
  "cta": {"question": "...", "answer": "..."},
  "missing_info": ["שאלה שאם נדע עליה התשובה תהיה הרבה יותר טובה", "..."]
}

חשוב:
- תשובות באורך 2-5 משפטים, מקצועיות ומדויקות
- אל תמציא עובדות שאינך יודע - אם חסר מידע, רשום אותו ב-missing_info
- שאלות בעברית טבעית כפי שגולשים מחפשים בגוגל`;

      const resp = await callClaude({
        model: DEFAULT_MODEL,
        max_tokens: 3000,
        system: SYSTEM_FAQ,
        messages: [{ role: "user", content: userText }],
      });
      const raw = resp.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
      let data: any;
      try {
        data = JSON.parse(stripJsonFence(raw));
      } catch {
        results.push({ page_id: page.id, url: page.url, items_count: 0, missing_info: [`פענוח נכשל: ${raw.slice(0, 200)}`] });
        continue;
      }

      // Wipe existing
      await sb.from("faq_items").delete().eq("page_id", page.id);

      const items: any[] = [];
      let order = 0;
      const missingStr = (data.missing_info && data.missing_info.length > 0) ? data.missing_info.join("\n") : null;
      for (const it of (data.general || [])) {
        items.push({ page_id: page.id, kind: "general", question: it.question, answer: it.answer, order: order++, missing_info: missingStr });
      }
      for (const it of (data.specific || [])) {
        items.push({ page_id: page.id, kind: "specific", question: it.question, answer: it.answer, order: order++, missing_info: missingStr });
      }
      if (data.cta) {
        items.push({ page_id: page.id, kind: "cta", question: data.cta.question, answer: data.cta.answer, order: order++, missing_info: missingStr });
      }
      if (items.length > 0) {
        await sb.from("faq_items").insert(items);
        await sb.from("pages").update({ has_faq: true }).eq("id", page.id);
      }
      results.push({ page_id: page.id, url: page.url, items_count: items.length, missing_info: data.missing_info || [] });
    }
    return jsonResponse({ results });
  } catch (e) {
    console.error(e);
    return errorResponse((e as Error).message, 500);
  }
});
