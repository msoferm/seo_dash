/**
 * Core link-prospecting logic, shared by the user-triggered function and the weekly
 * cron. Learns from the team's past decisions: prefers approved types, avoids rejected
 * domains, and respects the client's free-text link preferences.
 */
import { callClaudeAgent, DEFAULT_MODEL, textOf, extractJson } from "./anthropic.ts";

// Search-only, tight budget — each web_search round-trip is a full resend, so keeping
// this small is what lets one client's run finish under the 150s edge-function limit.
const PROSPECT_TOOLS = [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }];

const VALID_TYPES = ["directory", "blog", "forum", "mention", "local", "other"];

function normUrl(u: string): string {
  return (u || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
}
function domainOf(u: string): string {
  return normUrl(u).split("/")[0];
}

export async function prospectForClient(sb: any, clientId: number): Promise<number> {
  const { data: client } = await sb.from("clients").select("*").eq("id", clientId).maybeSingle();
  if (!client) return 0;

  const [kwRes, linksRes, prospectsRes] = await Promise.all([
    sb.from("keywords").select("term").eq("client_id", clientId).order("monthly_searches", { ascending: false }).limit(15),
    sb.from("report_links").select("url").eq("client_id", clientId),
    sb.from("link_prospects").select("url, type, status").eq("client_id", clientId),
  ]);
  const keywords = (kwRes.data || []).map((k: any) => k.term);
  const priorProspects = prospectsRes.data || [];
  const existing = new Set<string>(
    [...(linksRes.data || []), ...priorProspects].map((r: any) => normUrl(r.url)),
  );

  // ----- Learning signal from past decisions -----
  const approved = priorProspects.filter((p: any) => p.status === "approved" || p.status === "done");
  const rejected = priorProspects.filter((p: any) => p.status === "rejected");
  const likedTypes = [...new Set(approved.map((p: any) => p.type))];
  const rejectedDomains = [...new Set(rejected.map((p: any) => domainOf(p.url)))].filter(Boolean);
  const approvedDomains = [...new Set(approved.map((p: any) => domainOf(p.url)))].filter(Boolean);

  let learning = "";
  if (client.link_prefs && client.link_prefs.trim()) {
    learning += `\n\nהעדפות קבועות של הצוות ללקוח זה (חובה לכבד): ${client.link_prefs.trim()}`;
  }
  if (likedTypes.length) learning += `\n\nבעבר הצוות אישר בעיקר סוגים אלה — העדף אותם: ${likedTypes.join(", ")}.`;
  if (approvedDomains.length) learning += `\nדוגמאות למקורות שאושרו (חפש דומים באיכות): ${approvedDomains.slice(0, 15).join(", ")}.`;
  if (rejectedDomains.length) learning += `\nהצוות דחה את המקורות הבאים — אל תציע אותם או דומים להם: ${rejectedDomains.slice(0, 20).join(", ")}.`;

  const system =
    "אתה מומחה קידום אורגני (SEO) המתמחה בבניית קישורים לבנה (white-hat) בלבד. " +
    "מצא הזדמנויות קישור לגיטימיות ואיכותיות עבור העסק, על בסיס חיפוש אמיתי באינטרנט. " +
    "התמקד ב: (directory) אינדקסים/דירקטוריות עסקים ומקומיים רלוונטיים; (blog) בלוגים/אתרים בתחום עם עמוד 'כתבו לנו'/'guest post'; (forum) פורומים וקהילות; (local) ציטוטים מקומיים; (mention) אזכורי מותג ללא קישור. " +
    "אל תציע: רכישת קישורים ספאמית, PBN, אתרים לא רלוונטיים, או כל דבר שמפר את הנחיות גוגל. " +
    "לכל הזדמנות דרג עדיפות (score 0-100). אם מצאת עמוד קשר/אימייל — כלול אותו. " +
    "אחרי המחקר החזר אך ורק JSON במבנה: " +
    `{"prospects":[{"type":"directory|blog|forum|mention|local|other","url":"https://...","title":"...","reason":"...","suggested_action":"...","contact":"אימייל/עמוד קשר או null","score":0}]}. ` +
    "החזר בין 6 ל-8 הזדמנויות, כל שדה טקסט קצר (משפט). כתוב בעברית (למעט כתובות). " +
    "קריטי: החזר אך ורק את אובייקט ה-JSON — בלי שום טקסט, הקדמה, הסבר או בלוק קוד לפניו או אחריו. התחל ישירות ב-{." + learning;

  const userMsg =
    `עסק: ${client.name}\nדומיין: ${client.domain}\nתחום/הערות: ${client.notes || "לא צוין"}\n` +
    `מילות מפתח מרכזיות: ${keywords.join(", ") || "—"}\n\n` +
    `חפש באינטרנט הזדמנויות קישור רלוונטיות (העדף מקורות ישראליים/בעברית אם רלוונטי). ` +
    `אל תכלול כתובות שכבר קיימות אצלנו: ${[...existing].slice(0, 40).join(", ") || "(אין)"}.`;

  const resp = await callClaudeAgent({
    model: DEFAULT_MODEL,
    max_tokens: 4000,
    system,
    messages: [{ role: "user", content: userMsg }],
    tools: PROSPECT_TOOLS,
  }, 5);

  const raw = textOf(resp);
  let parsed: any;
  try {
    parsed = extractJson(raw);
  } catch {
    throw new Error(`no valid JSON. raw: ${raw.slice(0, 500)}`);
  }
  const list: any[] = Array.isArray(parsed) ? parsed : (parsed.prospects || []);

  const seen = new Set(existing);
  const rejectedSet = new Set(rejectedDomains);
  const rows: any[] = [];
  for (const p of list) {
    const url = String(p.url || "").trim();
    if (!/^https?:\/\//i.test(url)) continue;
    const key = normUrl(url);
    if (seen.has(key)) continue;
    if (rejectedSet.has(domainOf(url))) continue; // honor past rejections
    seen.add(key);
    const type = VALID_TYPES.includes(p.type) ? p.type : "other";
    rows.push({
      client_id: clientId,
      type,
      url,
      title: (p.title || "").toString().slice(0, 300) || null,
      reason: (p.reason || "").toString().slice(0, 1000) || null,
      suggested_action: (p.suggested_action || "").toString().slice(0, 1000) || null,
      contact: p.contact && p.contact !== "null" ? String(p.contact).slice(0, 300) : null,
      score: Math.max(0, Math.min(100, parseInt(p.score) || 0)),
      status: "new",
    });
  }

  if (rows.length > 0) {
    const { error } = await sb.from("link_prospects").insert(rows);
    if (error) throw new Error(`insert failed: ${error.message}`);
  }
  return rows.length;
}
