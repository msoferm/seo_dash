/**
 * SEO Dash Bridge client — talks to the companion WordPress plugin's endpoints
 * (seodash/v1/*) when a site has it installed and enabled. This unlocks edits the core
 * REST API can't do: targeted text changes inside Elementor content, reliable Yoast/
 * RankMath meta, Additional CSS, and (if enabled on the site) theme files.
 *
 * Nothing here runs on its own — these are called only from an explicit user action
 * (an audit/recommendation "apply" click).
 */
import { callClaude, DEFAULT_MODEL, textOf, extractJson } from "./anthropic.ts";

function normSite(u: string): string {
  let s = (u || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  return s;
}
export function hasBridge(cw: any): boolean {
  return !!(cw && cw.bridge_enabled && cw.bridge_secret && cw.username && cw.app_password);
}
function headers(cw: any): Record<string, string> {
  return {
    "Authorization": "Basic " + btoa(`${cw.username}:${cw.app_password}`),
    "X-SEODASH-KEY": cw.bridge_secret,
    "Content-Type": "application/json",
  };
}

export async function bridgePing(cw: any): Promise<any> {
  const r = await fetch(`${normSite(cw.site_url)}/wp-json/seodash/v1/ping`, { headers: headers(cw) });
  if (!r.ok) throw new Error(`bridge ping ${r.status}`);
  return r.json();
}

export async function bridgeElementorGet(cw: any, id: number): Promise<{ uses_elementor: boolean; data: string }> {
  const r = await fetch(`${normSite(cw.site_url)}/wp-json/seodash/v1/elementor/${id}`, { headers: headers(cw) });
  if (!r.ok) throw new Error(`bridge elementor get ${r.status}`);
  const j = await r.json();
  const data = typeof j.data === "string" ? j.data : JSON.stringify(j.data ?? "");
  return { uses_elementor: !!j.uses_elementor, data };
}

export async function bridgeElementorReplace(cw: any, id: number, replacements: { find: string; replace: string }[]): Promise<number> {
  const r = await fetch(`${normSite(cw.site_url)}/wp-json/seodash/v1/elementor/${id}/replace`, {
    method: "POST", headers: headers(cw), body: JSON.stringify({ replacements }),
  });
  if (!r.ok) throw new Error(`bridge elementor replace ${r.status} ${(await r.text()).slice(0, 160)}`);
  const j = await r.json();
  return j.replacements || 0;
}

export async function bridgeSetMeta(cw: any, id: number, title: string | null, description: string | null): Promise<void> {
  const body: any = {};
  if (title != null) body.title = title;
  if (description != null) body.description = description;
  if (Object.keys(body).length === 0) return;
  const r = await fetch(`${normSite(cw.site_url)}/wp-json/seodash/v1/meta/${id}`, {
    method: "POST", headers: headers(cw), body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`bridge meta ${r.status}`);
}

/** Readable text snippets from Elementor data (stripped of tags), deduped, capped. */
export function elementorTextSnippets(dataStr: string): string[] {
  let data: any;
  try { data = JSON.parse(dataStr); } catch { return []; }
  const out: string[] = []; const seen = new Set<string>();
  const walk = (n: any) => {
    if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === "object") for (const k in n) walk(n[k]);
    else if (typeof n === "string") {
      const t = n.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (t.length >= 6 && !seen.has(t)) { seen.add(t); out.push(t.slice(0, 200)); }
    }
  };
  walk(data);
  return out.slice(0, 60);
}

/**
 * Apply a single SEO fix to an Elementor page via the bridge, as minimal exact-text
 * replacements. Returns null if the page is NOT Elementor (caller should fall back to the
 * classic REST flow). Otherwise returns an honest applied/verified result.
 */
export async function applyElementorFix(
  cw: any, id: number, instruction: string, opts?: { modification?: string },
): Promise<{ applied: boolean; note: string } | null> {
  const el = await bridgeElementorGet(cw, id);
  if (!el.uses_elementor) return null;

  const snippets = elementorTextSnippets(el.data);
  if (snippets.length === 0) return { applied: false, note: "לא נמצא טקסט לעריכה בעמוד ה-Elementor." };

  const system =
    "אתה מבצע תיקון SEO נקודתי בעמוד שבנוי ב-Elementor, באמצעות החלפות טקסט מדויקות בלבד. " +
    "קיבלת רשימת קטעי טקסט קיימים מהעמוד. בחר רק את מה שצריך לשנות לפי התיקון המבוקש, ובצע שינוי מינימלי. " +
    "כל 'find' חייב להיות מחרוזת מדויקת שמופיעה באחד הקטעים שסופקו (העתק מילה-במילה). " +
    "אל תמציא תוכן ואל תשנה דברים שלא נדרשים. " +
    "אם ההנחיה כוללת קישור פנימי לעמוד מסוים — השתמש בכתובת ה-URL המדויקת שסופקה ועגן את הקישור על טקסט העוגן המבוקש, לא על עמוד הבית. " +
    "אם אין מה לשנות, החזר replacements ריק עם הסבר קצר ב-note. " +
    'החזר אך ורק JSON: {"replacements":[{"find":"טקסט קיים מדויק","replace":"הטקסט החדש"}],"meta_description":"<תיאור מטא חדש או KEEP>","note":"<הסבר קצר אם לא בוצע שינוי>"}. התחל ישירות ב-{.';
  const userMsg =
    `התיקון המבוקש: ${instruction}\n` +
    (opts?.modification ? `הנחיית המשתמש (לכבד): ${opts.modification}\n` : "") +
    `\nקטעי הטקסט בעמוד (בחר מתוכם ל-find):\n` + snippets.map((s, i) => `${i + 1}. ${s}`).join("\n");

  const resp = await callClaude({ model: DEFAULT_MODEL, max_tokens: 2000, system, messages: [{ role: "user", content: userMsg }] });
  let parsed: any; try { parsed = extractJson(textOf(resp)); } catch { return { applied: false, note: "לא התקבלה תשובה תקינה מהמנוע." }; }

  const snippetSet = new Set(snippets);
  const reps: { find: string; replace: string }[] = [];
  for (const r of (parsed.replacements || [])) {
    const find = String(r.find || "");
    const replace = String(r.replace || "");
    if (!find || find === replace) continue;
    // find must actually exist in the page's raw data (guards against hallucinated anchors)
    if (!el.data.includes(find) && !snippetSet.has(find)) continue;
    reps.push({ find, replace });
  }
  const metaDesc = parsed.meta_description && parsed.meta_description !== "KEEP" ? String(parsed.meta_description) : null;

  if (reps.length === 0 && !metaDesc) {
    return { applied: false, note: `לא בוצע שינוי${parsed.note ? `: ${parsed.note}` : " — המנוע קבע שאין מה לתקן או לא נמצאה התאמה מדויקת."}` };
  }

  let replaced = 0;
  if (reps.length) replaced = await bridgeElementorReplace(cw, id, reps);
  if (metaDesc) { try { await bridgeSetMeta(cw, id, null, metaDesc); } catch { /* best-effort */ } }

  // Verify by re-reading the Elementor data.
  let verifiedParts: string[] = [];
  let failed = 0;
  if (reps.length) {
    const after = await bridgeElementorGet(cw, id);
    for (const r of reps) { if (after.data.includes(r.replace)) verifiedParts.push(r.replace.slice(0, 30)); else failed++; }
  }
  const okCount = verifiedParts.length;
  const applied = okCount > 0 || !!metaDesc;
  if (reps.length && okCount === 0) {
    return { applied: false, note: "השינוי נשלח אך לא אומת בעמוד ה-Elementor. ייתכן שהטקסט מנוהל במקום אחר — בדוק ידנית." };
  }
  const note = `עודכן ב-Elementor${okCount ? ` (${okCount} החלפות מאומתות${failed ? `, ${failed} לא אומתו` : ""})` : ""}${metaDesc ? " + תיאור מטא" : ""}. הקאש של Elementor נוקה; ניתן לשחזר מהיסטוריית הגרסאות.`;
  return { applied, note };
}
