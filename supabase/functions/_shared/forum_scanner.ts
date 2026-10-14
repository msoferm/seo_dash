/**
 * Forum outreach scanner (deterministic fetch + Claude for judgment).
 *
 * 1. We fetch the forum listing pages ourselves with a browser User-Agent (bypasses the
 *    Cloudflare/bot 403 that blocks Anthropic's web_fetch), parse thread titles+links.
 * 2. Claude picks the threads relevant to the business (one cheap call).
 * 3. We fetch each selected thread and extract the opening question.
 * 4. Claude drafts a helpful reply + picks the best business URL to link (one call).
 *
 * Every scan records a diagnostic note on the forum_sites row so empty results are explainable.
 */
import { callClaude, DEFAULT_MODEL, textOf, extractJson } from "./anthropic.ts";
import { fetchHtml, nextPageUrl, extractThreadLinks, extractFirstPost } from "./forum_html.ts";

function normUrl(u: string): string {
  return (u || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
}
function homepageOf(client: any): string {
  const d = (client.domain || "").replace(/^sc-domain:/, "").trim();
  if (!d) return "";
  return /^https?:\/\//i.test(d) ? d.replace(/\/+$/, "") : `https://${d.replace(/\/+$/, "")}`;
}

async function buildBusinessContext(sb: any, client: any): Promise<{ text: string; pageCount: number }> {
  const [pagesRes, kwRes] = await Promise.all([
    sb.from("pages").select("url, title, h1, meta_description, content_excerpt")
      .eq("client_id", client.id).order("word_count", { ascending: false, nullsFirst: false }).limit(25),
    sb.from("keywords").select("term").eq("client_id", client.id)
      .order("monthly_searches", { ascending: false }).limit(20),
  ]);
  const pages = pagesRes.data || [];
  const keywords = (kwRes.data || []).map((k: any) => k.term);
  const home = homepageOf(client);

  let pagesBlock: string;
  if (pages.length) {
    pagesBlock = "עמודים באתר העסק שאפשר לקשר אליהם (בחר את המתאים ביותר לכל שאלה):\n" +
      pages.map((p: any) => {
        const desc = (p.meta_description || p.content_excerpt || "").toString().replace(/\s+/g, " ").slice(0, 160);
        return `- ${p.url}\n  כותרת: ${p.h1 || p.title || "(ללא)"}${desc ? `\n  תקציר: ${desc}` : ""}`;
      }).join("\n");
  } else {
    pagesBlock = `האתר עדיין לא נסרק לעומק, אז אין רשימת עמודים מפורטת. קשר לעמוד הבית (${home || client.domain}) או לעמוד רלוונטי באתר אם קיים. אל תמציא כתובות.`;
  }
  const text =
    `עסק: ${client.name}\nדומיין: ${client.domain}\nעמוד הבית: ${home || "—"}\nתחום/הערות: ${client.notes || "לא צוין"}\n` +
    `מילות מפתח מרכזיות: ${keywords.join(", ") || "—"}\n\n${pagesBlock}`;
  return { text, pageCount: pages.length };
}

export interface ForumScanResult { forum_site_id: number; inserted: number; note: string }

export async function scanForumSite(sb: any, forumSiteId: number): Promise<ForumScanResult> {
  const { data: site } = await sb.from("forum_sites").select("*").eq("id", forumSiteId).maybeSingle();
  if (!site) return { forum_site_id: forumSiteId, inserted: 0, note: "forum site not found" };
  const { data: client } = await sb.from("clients").select("*").eq("id", site.client_id).maybeSingle();
  if (!client) return { forum_site_id: forumSiteId, inserted: 0, note: "client not found" };

  const finish = async (inserted: number, note: string) => {
    await sb.from("forum_sites").update({
      last_scanned_at: new Date().toISOString(), last_scan_found: inserted, last_scan_note: note.slice(0, 500),
    }).eq("id", site.id);
    return { forum_site_id: site.id, inserted, note };
  };

  try {
    const maxPages = Math.max(1, Math.min(10, site.max_pages || 3));
    const maxThreads = Math.max(1, Math.min(15, site.max_threads || 5));

    // ---- 1) Collect thread links from the listing pages (browser UA) ----
    const threads: { url: string; title: string }[] = [];
    const seenThread = new Set<string>();
    let pageUrl: string | null = site.url;
    let firstStatus = 0;
    for (let p = 0; p < maxPages && pageUrl; p++) {
      const { status, html, finalUrl } = await fetchHtml(pageUrl);
      if (p === 0) firstStatus = status;
      if (!html) break;
      for (const t of extractThreadLinks(html, finalUrl)) {
        const key = normUrl(t.url);
        if (seenThread.has(key)) continue;
        seenThread.add(key);
        threads.push(t);
      }
      pageUrl = nextPageUrl(html, finalUrl);
    }

    if (threads.length === 0) {
      if (firstStatus === 403 || firstStatus === 401) return finish(0, `האתר חוסם גישה אוטומטית (status ${firstStatus}). ייתכן שצריך סריקה דרך דפדפן.`);
      if (firstStatus === 0) return finish(0, "לא ניתן להגיע לכתובת הפורום (שגיאת רשת/כתובת שגויה).");
      return finish(0, `לא נמצאו אשכולות בעמוד הפורום (status ${firstStatus}). ייתכן שהכתובת אינה עמוד רשימת אשכולות.`);
    }

    // Skip threads we already captured for this client.
    const { data: existingLeads } = await sb.from("forum_leads").select("thread_url").eq("client_id", client.id);
    const existing = new Set<string>((existingLeads || []).map((r: any) => normUrl(r.thread_url)));
    const candidates = threads.filter((t) => !existing.has(normUrl(t.url))).slice(0, 50);
    if (candidates.length === 0) return finish(0, `כל ${threads.length} האשכולות שנמצאו כבר קיימים במערכת.`);

    const { text: context, pageCount } = await buildBusinessContext(sb, client);
    const crawlHint = pageCount === 0 ? " (האתר לא נסרק — הרץ 'סרוק אתר' לתוצאות מדויקות יותר)" : "";
    const prefs = (client.forum_prefs || "").trim();

    // ---- 2) Claude selects the most relevant threads ----
    const indexed = candidates.map((t, i) => `${i}. ${t.title}`).join("\n");
    const selSystem =
      "אתה מומחה SEO. בהינתן תחום העסק ורשימת כותרות אשכולות מפורום, בחר את האשכולות שבהם יש הזדמנות אמיתית לתת ערך ולקשר באופן טבעי לאתר העסק — ישירות או בחיבור יצירתי. היה נדיב: גם קשר עקיף נחשב. " +
      `החזר אך ורק JSON: {"selected":[אינדקסים מספריים, עד ${maxThreads}],"note":"אם לא נבחר כלום — הסבר קצר"}. התחל ישירות ב-{.` +
      (prefs ? `\nהנחיות הצוות: ${prefs}` : "");
    const selResp = await callClaude({
      model: DEFAULT_MODEL, max_tokens: 700, system: selSystem,
      messages: [{ role: "user", content: `${context}\n\nכותרות אשכולות:\n${indexed}` }],
    });
    let sel: any; try { sel = extractJson(textOf(selResp)); } catch { sel = {}; }
    const idxs: number[] = Array.isArray(sel?.selected) ? sel.selected.map((n: any) => parseInt(n)).filter((n: number) => n >= 0 && n < candidates.length) : [];
    const picked = [...new Set(idxs)].slice(0, maxThreads).map((i) => candidates[i]);
    if (picked.length === 0) {
      return finish(0, `נמצאו ${candidates.length} אשכולות אך אף אחד לא נמצא רלוונטי מספיק${sel?.note ? `: ${sel.note}` : ""}.${crawlHint}`);
    }

    // ---- 3) Fetch each picked thread and extract the question ----
    const detailed: { url: string; title: string; question: string }[] = [];
    for (const t of picked) {
      const { html } = await fetchHtml(t.url);
      const question = html ? extractFirstPost(html) : "";
      detailed.push({ url: t.url, title: t.title, question });
    }

    // ---- 4) Claude drafts replies + picks the link target ----
    const draftSystem =
      "אתה מומחה SEO ותוכן. לכל אשכול שסופק, כתוב תגובה אמיתית ומועילה שעונה על שאלת הגולש ונותנת ערך אמיתי, ומשלבת באופן טבעי קישור לעמוד המתאים ביותר באתר העסק. " +
      "התגובה צריכה להישמע אנושית, לא שיווקית ולא ספאם. אל תמציא עובדות על העסק. דלג על אשכול שבאמת אין בו הזדמנות. " +
      'החזר אך ורק JSON במבנה: {"leads":[{"thread_url":"...","thread_title":"...","question":"תקציר השאלה","suggested_reply":"טקסט התגובה כולל הקישור","target_url":"https://אתר-העסק/עמוד","score":0}]}. ' +
      "score 0-100 לפי מידת ההתאמה. כתוב בעברית (למעט כתובות). התחל ישירות ב-{." +
      (prefs ? `\nהנחיות הצוות: ${prefs}` : "");
    const threadsBlock = detailed.map((d, i) =>
      `--- אשכול ${i} ---\nכותרת: ${d.title}\nURL: ${d.url}\nתוכן השאלה: ${d.question || "(לא נמשך תוכן — השתמש בכותרת)"}`,
    ).join("\n\n");
    const draftResp = await callClaude({
      model: DEFAULT_MODEL, max_tokens: 6000, system: draftSystem,
      messages: [{ role: "user", content: `${context}\n\nאשכולות לטיפול:\n${threadsBlock}` }],
    });
    let parsed: any; try { parsed = extractJson(textOf(draftResp)); } catch { return finish(0, `הסוכן לא החזיר JSON תקין לתגובות.${crawlHint}`); }
    const list: any[] = Array.isArray(parsed) ? parsed : (parsed.leads || []);

    // Map drafts back to the real thread URLs (trust our fetched URLs over the model's).
    const byUrl = new Map(detailed.map((d) => [normUrl(d.url), d]));
    const seen = new Set(existing);
    const rows: any[] = [];
    for (const l of list) {
      const modelUrl = String(l.thread_url || "").trim();
      const match = byUrl.get(normUrl(modelUrl)) || detailed.find((d) => d.title === l.thread_title);
      const threadUrl = match ? match.url : modelUrl;
      if (!/^https?:\/\//i.test(threadUrl)) continue;
      const key = normUrl(threadUrl);
      if (seen.has(key)) continue; seen.add(key);
      const targetUrl = String(l.target_url || "").trim();
      rows.push({
        client_id: client.id, forum_site_id: site.id, thread_url: threadUrl,
        thread_title: (l.thread_title || match?.title || "").toString().slice(0, 500) || null,
        question: (l.question || match?.question || "").toString().slice(0, 4000) || null,
        suggested_reply: (l.suggested_reply || "").toString().slice(0, 4000) || null,
        target_url: /^https?:\/\//i.test(targetUrl) ? targetUrl.slice(0, 1000) : (homepageOf(client) || null),
        score: Math.max(0, Math.min(100, parseInt(l.score) || 0)),
        status: "new",
      });
    }

    let inserted = 0;
    if (rows.length > 0) {
      const { error } = await sb.from("forum_leads").upsert(rows, { onConflict: "client_id,thread_url", ignoreDuplicates: true });
      if (error) return finish(0, `שגיאת שמירה: ${error.message}`);
      inserted = rows.length;
    }
    const note = inserted > 0
      ? `נוספו ${inserted} הזדמנויות (מתוך ${threads.length} אשכולות שנסרקו).${crawlHint}`
      : `נבחרו ${picked.length} אשכולות אך לא נוצרו תגובות מתאימות.${crawlHint}`;
    return finish(inserted, note);
  } catch (e) {
    return finish(0, `שגיאה: ${(e as Error).message}`);
  }
}
