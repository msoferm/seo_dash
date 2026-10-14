/**
 * Forum outreach scanner.
 * For a single registered forum/community URL: use web_fetch to read the first few
 * listing pages, pick the threads most relevant to the business (directly or creatively),
 * open them to read the real question, and draft a helpful reply that naturally links to
 * the best-matching page on the business site. Results go into forum_leads for manual review.
 *
 * The agent is given real context about the business site (top crawled pages + keywords),
 * so its replies and chosen target URLs are grounded in actual content.
 */
import { callClaudeAgent, DEFAULT_MODEL, textOf, extractJson } from "./anthropic.ts";

function normUrl(u: string): string {
  return (u || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
}

/** Build a compact description of the business site the agent can link to. */
async function buildBusinessContext(sb: any, client: any): Promise<string> {
  const [pagesRes, kwRes] = await Promise.all([
    sb.from("pages").select("url, title, h1, meta_description, content_excerpt, page_type")
      .eq("client_id", client.id).order("word_count", { ascending: false, nullsFirst: false }).limit(25),
    sb.from("keywords").select("term").eq("client_id", client.id)
      .order("monthly_searches", { ascending: false }).limit(20),
  ]);
  const pages = pagesRes.data || [];
  const keywords = (kwRes.data || []).map((k: any) => k.term);

  const pageLines = pages.map((p: any) => {
    const desc = (p.meta_description || p.content_excerpt || "").toString().replace(/\s+/g, " ").slice(0, 160);
    return `- ${p.url}\n  כותרת: ${p.h1 || p.title || "(ללא)"}${desc ? `\n  תקציר: ${desc}` : ""}`;
  }).join("\n");

  return (
    `עסק: ${client.name}\nדומיין: ${client.domain}\nתחום/הערות: ${client.notes || "לא צוין"}\n` +
    `מילות מפתח מרכזיות: ${keywords.join(", ") || "—"}\n\n` +
    `עמודים באתר העסק שאפשר לקשר אליהם (בחר את המתאים ביותר לכל שאלה):\n${pageLines || "(לא נסרקו עמודים — הרץ 'סרוק אתר' תחילה)"}`
  );
}

export interface ForumScanResult { forum_site_id: number; inserted: number; error?: string }

export async function scanForumSite(sb: any, forumSiteId: number): Promise<ForumScanResult> {
  const { data: site } = await sb.from("forum_sites").select("*").eq("id", forumSiteId).maybeSingle();
  if (!site) return { forum_site_id: forumSiteId, inserted: 0, error: "forum site not found" };
  const { data: client } = await sb.from("clients").select("*").eq("id", site.client_id).maybeSingle();
  if (!client) return { forum_site_id: forumSiteId, inserted: 0, error: "client not found" };

  const maxPages = Math.max(1, Math.min(10, site.max_pages || 3));
  const maxThreads = Math.max(1, Math.min(15, site.max_threads || 5));
  const context = await buildBusinessContext(sb, client);

  // Avoid re-proposing threads we already captured for this client.
  const { data: existingLeads } = await sb.from("forum_leads").select("thread_url").eq("client_id", client.id);
  const existing = new Set<string>((existingLeads || []).map((r: any) => normUrl(r.url || r.thread_url)));

  const prefs = (client.forum_prefs || "").trim();
  const system =
    "אתה מומחה קידום אורגני (SEO) ותוכן, שעוזר לצוות למצוא הזדמנויות אמיתיות לתת ערך בפורומים ולקשר באופן טבעי לאתר של בעל העסק. " +
    "קיבלת כתובת של פורום/קהילה שבה הצוות רשום ופעיל. עבוד כך: " +
    `(1) משוך (web_fetch) את עמוד הפורום ועד ${maxPages} עמודי רשימה (pagination) ואסוף כותרות של אשכולות/שאלות אחרונות עם הקישורים שלהן. ` +
    "(2) בחר את האשכולות שהכי רלוונטיים לתחום של בעל העסק — ישירות, או בחיבור יצירתי לאחד מעמודי האתר. " +
    `(3) משוך (web_fetch) את עמודי האשכולות הנבחרים (עד ${maxThreads}) וקרא את השאלה המלאה של המשתמש כדי להבין לעומק את הצורך. ` +
    "(4) לכל אשכול מתאים כתוב תגובה אמיתית ומועילה שעונה על השאלה של הגולש ונותנת ערך אמיתי, ומשלבת באופן טבעי קישור לעמוד המתאים ביותר באתר העסק (בחר מתוך רשימת העמודים שסופקה). " +
    "התגובה צריכה להישמע אנושית, לא שיווקית, ולא ספאם. אל תמציא עובדות על העסק. " +
    "בחר אשכולות פתוחים לתגובה (שאלות של גולשים), לא פרסומות או אשכולות נעולים. " +
    "החזר אך ורק JSON במבנה: " +
    `{"leads":[{"thread_url":"https://...","thread_title":"...","question":"השאלה המלאה של הגולש","suggested_reply":"טקסט התגובה המוצעת כולל הקישור","target_url":"https://אתר-העסק/עמוד","score":0}]}. ` +
    "score בין 0-100 לפי מידת ההתאמה וההזדמנות. כתוב בעברית (למעט כתובות). " +
    "אם לא נמצאו אשכולות מתאימים החזר {\"leads\":[]}. " +
    "קריטי: החזר אך ורק את אובייקט ה-JSON — בלי טקסט, הקדמה, הסבר או בלוק קוד. התחל ישירות ב-{." +
    (prefs ? `\n\nהנחיות קבועות של הצוות (חובה לכבד): ${prefs}` : "");

  const userMsg =
    `${context}\n\n` +
    `כתובת הפורום לסריקה: ${site.url}\n` +
    `סרוק עד ${maxPages} עמודי רשימה, והחזר עד ${maxThreads} הזדמנויות איכותיות.` +
    (existing.size ? `\n\nאל תחזיר אשכולות שכבר טיפלנו בהם: ${[...existing].slice(0, 40).join(", ")}.` : "");

  // web_fetch budget: listing pages + opened threads + a little slack.
  const maxUses = maxPages + maxThreads + 2;
  const resp = await callClaudeAgent({
    model: DEFAULT_MODEL,
    max_tokens: 6000,
    system,
    messages: [{ role: "user", content: userMsg }],
    tools: [{ type: "web_fetch_20250910", name: "web_fetch", max_uses: maxUses }],
  }, maxUses + 4);

  const raw = textOf(resp);
  let parsed: any;
  try { parsed = extractJson(raw); } catch { throw new Error(`no valid JSON. raw: ${raw.slice(0, 400)}`); }
  const list: any[] = Array.isArray(parsed) ? parsed : (parsed.leads || []);

  const seen = new Set(existing);
  const rows: any[] = [];
  for (const l of list) {
    const threadUrl = String(l.thread_url || "").trim();
    if (!/^https?:\/\//i.test(threadUrl)) continue;
    const key = normUrl(threadUrl);
    if (seen.has(key)) continue;
    seen.add(key);
    const targetUrl = String(l.target_url || "").trim();
    rows.push({
      client_id: client.id,
      forum_site_id: site.id,
      thread_url: threadUrl,
      thread_title: (l.thread_title || "").toString().slice(0, 500) || null,
      question: (l.question || "").toString().slice(0, 4000) || null,
      suggested_reply: (l.suggested_reply || "").toString().slice(0, 4000) || null,
      target_url: /^https?:\/\//i.test(targetUrl) ? targetUrl.slice(0, 1000) : null,
      score: Math.max(0, Math.min(100, parseInt(l.score) || 0)),
      status: "new",
    });
  }

  let inserted = 0;
  if (rows.length > 0) {
    // upsert on (client_id, thread_url) so re-scans don't duplicate.
    const { error, count } = await sb.from("forum_leads")
      .upsert(rows, { onConflict: "client_id,thread_url", ignoreDuplicates: true, count: "exact" });
    if (error) throw new Error(`insert failed: ${error.message}`);
    inserted = count ?? rows.length;
  }
  await sb.from("forum_sites").update({ last_scanned_at: new Date().toISOString() }).eq("id", site.id);
  return { forum_site_id: site.id, inserted };
}
