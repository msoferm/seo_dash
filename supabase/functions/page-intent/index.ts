/**
 * Part 3 ("כוונת המשתמש") AI analysis. POST { client_id, page_url, action, ... }:
 *   action "intent"  → characterize the SEARCH INTENT behind the page's keywords (who the user
 *                      is, what they need) using the question framework. Returns { intent_analysis }.
 *   action "page"    → fetch the live page and analyze it fully against that intent. Returns
 *                      { page_analysis, conclusions, quality_score, title, meta_description }.
 *   action "consult" → free-form Q&A about the analysis. Returns { answer }.
 * This function only generates text; the frontend persists results to page_intent.
 * rev: 2026-11-03a
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";
import { callClaude, DEFAULT_MODEL, textOf, extractJson } from "../_shared/anthropic.ts";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.46/deno-dom-wasm.ts";

const UA = "SEO-Dashboard/1.0";

const FRAMEWORK =
  "אפיין את כוונת החיפוש לפי השאלות הבאות וענה על כל אחת בקצרה וברור:\n" +
  "1. מי הגולש? (לקוח פרטי/עסקי, מתחיל/בעל ידע, מה המצב שהוביל אותו לחפש)\n" +
  "2. מה הוא מנסה להשיג? (ללמוד / לפתור בעיה / להשוות / לבדוק מחיר / לרכוש)\n" +
  "3. מה הוא מצפה למצוא בדף? (תשובה קצרה / מדריך / טבלת מחירים / דוגמאות / מוצר / קביעת פגישה)\n" +
  "4. באיזה שלב הוא נמצא? (מזהה צורך / בוחן פתרונות / מחפש ספק)\n" +
  "5. מה הוא כבר יודע? (מושגים שאפשר להניח מול מה שצריך להסביר)\n" +
  "6. מה התשובה שחשוב לתת מיד בתחילת הדף?\n" +
  "7. מה משפיע על ההחלטה שלו? (מחיר / זמן / התאמה / ניסיון / מיקום / תנאי שירות)\n" +
  "8. מה החששות והחסמים שלו?\n" +
  "9. אילו הוכחות הוא צריך? (עבודות קודמות / ביקורות / הסמכות / נתונים / הסבר התהליך)\n" +
  "10. מה השאלה הבאה שתעלה לו אחרי התשובה הראשונית?\n" +
  "11. מה הצעד הבא המתאים? (להמשיך לקרוא / להשוות / לבדוק התאמה / ליצור קשר / לקנות)";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const body = await req.json();
    const { client_id, page_url, action } = body;
    if (!client_id || !action) return errorResponse("חסר client_id או action", 400);

    const { data: client } = await sb.from("clients").select("name, domain, notes").eq("id", client_id).maybeSingle();
    const biz = client ? `עסק: ${client.name} (${client.domain}). הערות: ${client.notes || "—"}.` : "";
    const primary: string[] = (body.primary_keywords || []).filter(Boolean);
    const secondary: string[] = (body.secondary_keywords || []).filter(Boolean);
    const kwLine = `מילות מפתח עיקריות: ${primary.join(", ") || "—"}.\nמילות מפתח משניות: ${secondary.join(", ") || "—"}.`;

    if (action === "intent") {
      const system =
        "אתה אסטרטג SEO ותוכן בעברית. נתח את כוונת המשתמש והצורך שלו מאחורי מילות המפתח של העמוד. " +
        "אם יש הבדלי כוונה בין מילים שונות — ציין זאת. כתוב בעברית, בפסקאות וכותרות ברורות, בלי מלל מיותר.";
      const userMsg = `${biz}\nכתובת העמוד: ${page_url}\n${kwLine}\n\n${FRAMEWORK}\n\nבסיום, סכם ב-2-3 משפטים את "מי המשתמש ומה הוא צריך" לעמוד הזה.`;
      const resp = await callClaude({ model: DEFAULT_MODEL, max_tokens: 2500, system, messages: [{ role: "user", content: userMsg }] });
      return jsonResponse({ intent_analysis: textOf(resp).trim() });
    }

    if (action === "page") {
      // Fetch the live page.
      let pageText = ""; let title = ""; let metaDesc = ""; let fetched = false;
      try {
        const r = await fetch(page_url, { headers: { "User-Agent": UA }, redirect: "follow" });
        if (r.ok) {
          const html = await r.text();
          const doc = new DOMParser().parseFromString(html, "text/html");
          if (doc) {
            title = doc.querySelector("title")?.textContent?.trim() || "";
            metaDesc = doc.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() || "";
            doc.querySelectorAll("script, style, noscript").forEach((el) => el.remove());
            pageText = (doc.body?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 9000);
            fetched = pageText.length > 50;
          }
        }
      } catch { /* page may not exist yet */ }

      const intent = (body.intent_analysis || "").trim();
      const system =
        "אתה מבקר SEO ותוכן בכיר בעברית. נתח עמוד מול כוונת המשתמש ומילות המפתח. " +
        "אם סופק תוכן העמוד — נתח אותו מלמעלה למטה (כותרת, מטא, H1, מבנה, כיסוי הנושא, מענה לכוונה, הוכחות, CTA). " +
        "אם לא סופק תוכן (עמוד חדש שטרם נכתב) — תאר מה העמוד צריך לכלול כדי לענות על הכוונה. " +
        'החזר JSON תקין בלבד בפורמט: {"page_analysis":"<ניתוח מפורט>","conclusions":"<מסקנות + הזדמנויות ותוספות שחסרות בעמוד, כרשימה>","quality_score":<1-10 או null אם העמוד לא קיים>}. התחל ישירות ב-{.';
      const userMsg =
        `${biz}\nכתובת העמוד: ${page_url}\n${kwLine}\n\n` +
        (intent ? `=== ניתוח כוונת המשתמש (שלב קודם) ===\n${intent}\n=== סוף ===\n\n` : "") +
        (fetched ? `=== תוכן העמוד הקיים ===\nTITLE: ${title}\nMETA: ${metaDesc}\n${pageText}\n=== סוף תוכן העמוד ===` : "לא נמצא תוכן לעמוד (ייתכן שהוא עדיין לא נכתב). נתח מה צריך להופיע בו.");
      const resp = await callClaude({ model: DEFAULT_MODEL, max_tokens: 3000, system, messages: [{ role: "user", content: userMsg }] });
      let parsed: any = {};
      try { parsed = extractJson(textOf(resp)); } catch { parsed = { page_analysis: textOf(resp).trim(), conclusions: "", quality_score: null }; }
      const score = Number(parsed.quality_score);
      return jsonResponse({
        page_analysis: String(parsed.page_analysis || "").trim(),
        conclusions: String(parsed.conclusions || "").trim(),
        quality_score: Number.isFinite(score) && score >= 1 && score <= 10 ? Math.round(score) : null,
        title, meta_description: metaDesc, fetched,
      });
    }

    if (action === "consult") {
      const question = (body.question || "").trim();
      if (!question) return errorResponse("חסרה שאלה", 400);
      const ctx = [
        body.intent_analysis ? `ניתוח כוונת המשתמש:\n${body.intent_analysis}` : "",
        body.page_analysis ? `ניתוח העמוד:\n${body.page_analysis}` : "",
        body.conclusions ? `מסקנות נוכחיות:\n${body.conclusions}` : "",
      ].filter(Boolean).join("\n\n");
      const system = "אתה יועץ SEO ותוכן בעברית. ענה ענייני וממוקד על שאלת המשתמש, בהתבסס על הניתוח שסופק. אם חסר מידע — אמור זאת.";
      const userMsg = `${biz}\nכתובת העמוד: ${page_url}\n${kwLine}\n\n${ctx}\n\nשאלה: ${question}`;
      const resp = await callClaude({ model: DEFAULT_MODEL, max_tokens: 1500, system, messages: [{ role: "user", content: userMsg }] });
      return jsonResponse({ answer: textOf(resp).trim() });
    }

    return errorResponse("action לא מוכר", 400);
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
