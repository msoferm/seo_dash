import { supabase, invokeFn, invokeFnFormData } from "./supabase";
import type { NavEntry } from "./navItems";

export interface Client {
  id: number;
  name: string;
  domain: string;
  gsc_property: string | null;
  ga4_property_id: string | null;
  zefo_site_id: number | null;
  notes: string | null;
  created_at: string;
  google_token_json: string | null;
  link_prefs?: string | null;
  forum_prefs?: string | null;
}

export interface Keyword {
  id: number;
  client_id: number;
  term: string;
  monthly_searches: number;
  competition: string | null;
  competition_index: number | null;
  top_bid_low: number | null;
  top_bid_high: number | null;
  position: number | null;
  source: string;
  monthly_history?: { year: number; month: number; searches: number }[];
}

export interface PageRow {
  id: number;
  client_id: number;
  url: string;
  title: string | null;
  has_faq: boolean;
  last_crawled: string | null;
  content_excerpt?: string | null;
}

export interface FaqItem {
  id: number;
  page_id: number;
  question: string;
  answer: string;
  kind: "general" | "specific" | "cta";
  order: number;
  missing_info: string | null;
}

export interface ChatSession {
  id: number;
  client_id: number;
  title: string;
  messages_json: any[];
  created_at: string;
  updated_at: string;
}

export type TaskStatus = "open" | "done" | "ignored";
export type Level = "high" | "medium" | "low";
export interface Task {
  id: number;
  client_id: number;
  title: string;
  details: string | null;
  status: TaskStatus;
  source: "manual" | "claude" | "upload" | "plan";
  priority: Level | null;
  sort_order: number;
  created_at: string;
  done_at: string | null;
  parent_id: number | null;
  category: string | null;
  is_pillar: boolean;
  kind: "claude" | "manual" | null;
  target_month: number | null;
  impact: Level | null;
  effort: Level | null;
  note: string | null;
  source_type: string | null;
  source_ref: string | null;
  due_date: string | null;
  preview: string | null;
  writes_text: boolean;
  page_url: string | null;
}

export interface SuggestionAttachment {
  name: string;
  path: string;
  type: string;
  size: number;
}

export type SuggestionStatus = "open" | "in_progress" | "done";

export interface SuggestionComment {
  id: number;
  suggestion_id: number;
  author: "moshe" | "mordechai";
  body: string;
  created_at: string;
}

export interface Suggestion {
  id: number;
  client_id: number | null;
  author: "moshe" | "mordechai";
  body: string | null;
  attachments: SuggestionAttachment[];
  status: SuggestionStatus;
  done_at: string | null;
  created_at: string;
  comments?: SuggestionComment[];
}

export interface Ga4ConversionRow {
  channel: string | null;
  source: string | null;
  conversions: number;
  sessions: number;
}

// ===== Clients =====
export async function listClients(): Promise<Client[]> {
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getClient(id: number): Promise<Client | null> {
  const { data, error } = await supabase.from("clients").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createClient(body: Partial<Client>): Promise<Client> {
  const { data, error } = await supabase.from("clients").insert(body).select().single();
  if (error) throw error;
  return data;
}

export async function updateClient(id: number, body: Partial<Client>): Promise<Client> {
  const { data, error } = await supabase.from("clients").update(body).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteClient(id: number): Promise<void> {
  const { error } = await supabase.from("clients").delete().eq("id", id);
  if (error) throw error;
}

// ===== Keywords =====
export async function listKeywords(clientId: number, search?: string): Promise<Keyword[]> {
  let q = supabase
    .from("keywords")
    .select("*, monthly_history:monthly_searches(year, month, searches)")
    .eq("client_id", clientId)
    .order("monthly_searches", { ascending: false })
    .limit(500);
  if (search) q = q.ilike("term", `%${search}%`);
  const { data, error } = await q;
  if (error) throw error;
  return (data as any) || [];
}

export async function uploadKeywordsCsv(clientId: number, file: File): Promise<{ inserted: number; filename: string }> {
  const fd = new FormData();
  fd.append("file", file);
  return await invokeFnFormData("upload-keywords", fd, { client_id: String(clientId) });
}

// ===== Pages =====
export async function listPages(clientId: number): Promise<PageRow[]> {
  const { data, error } = await supabase
    .from("pages")
    .select("*")
    .eq("client_id", clientId)
    .order("url");
  if (error) throw error;
  return data || [];
}

export async function crawlSite(clientId: number, url?: string): Promise<PageRow[]> {
  return await invokeFn("crawl-site", { client_id: clientId, url: url || null });
}

// ===== FAQ =====
export async function listFaqs(pageId: number): Promise<FaqItem[]> {
  const { data, error } = await supabase
    .from("faq_items")
    .select("*")
    .eq("page_id", pageId)
    .order("order");
  if (error) throw error;
  return data || [];
}

export async function generateFaq(pageIds: number[], businessContext: string | null) {
  return await invokeFn("faq-generate", { page_ids: pageIds, business_context: businessContext });
}

export async function refineFaq(pageId: number, additionalInfo: string) {
  return await invokeFn("faq-refine", { page_id: pageId, additional_info: additionalInfo });
}

export async function suggestMoreFaqs(pageId: number) {
  return await invokeFn<{ suggestions: any[] }>("faq-suggest", { page_id: pageId });
}

// ===== Claude chat =====
export async function listChatSessions(clientId: number): Promise<ChatSession[]> {
  const { data, error } = await supabase
    .from("chat_sessions")
    .select("*")
    .eq("client_id", clientId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function deleteChatSession(id: number): Promise<void> {
  const { error } = await supabase.from("chat_sessions").delete().eq("id", id);
  if (error) throw error;
}

export async function sendChat(clientId: number, message: string, sessionId: number | null): Promise<{ session_id: number; reply: string; tool_calls: any[] }> {
  return await invokeFn("claude-chat", { client_id: clientId, session_id: sessionId, message });
}

// ===== Google OAuth =====
export async function gscAuthorize(clientId: number): Promise<{ auth_url: string }> {
  return await invokeFn("gsc-authorize", { client_id: clientId });
}

export async function gscSync(clientId: number, days = 90): Promise<{ synced: number }> {
  return await invokeFn("gsc-sync", { client_id: clientId, days });
}

export interface GscSite { site_url: string; permission_level: string }
export async function gscListSites(clientId: number): Promise<{ sites: GscSite[] }> {
  return await invokeFn("gsc-list-sites", { client_id: clientId });
}

export async function bulkImportGscProperties(sourceClientId: number, properties: string[]) {
  return await invokeFn<{ created: Client[]; skipped: string[]; created_count: number; skipped_count: number }>(
    "clients-bulk-import-gsc",
    { source_client_id: sourceClientId, properties },
  );
}

// ===== GA4 =====
export interface Ga4Property { property_id: string; display_name: string; parent_account: string }
export async function ga4ListProperties(clientId: number): Promise<{ properties: Ga4Property[] }> {
  return await invokeFn("ga4-list-properties", { client_id: clientId });
}
export async function ga4Sync(clientId: number, days = 30): Promise<{ synced: number }> {
  return await invokeFn("ga4-sync", { client_id: clientId, days });
}

// ===== ZEFO =====
export interface ZefoSite {
  id: number;
  domain: string;
  path: string | null;
  name: string | null;
  status: string;
  linked_client: { client_id: number; client_name: string } | null;
}
export async function zefoListSites(): Promise<{ sites: ZefoSite[] }> {
  return await invokeFn("zefo-list-sites", {});
}
export async function zefoLinkSite(clientId: number, zefoSiteId: number | null) {
  return await invokeFn("zefo-link-site", { client_id: clientId, zefo_site_id: zefoSiteId });
}
export async function zefoSync(clientId: number): Promise<{ synced: number }> {
  return await invokeFn("zefo-sync", { client_id: clientId });
}

export interface ZefoKeyword {
  id: number;
  client_id: number;
  zefo_keyword_id: number;
  keyword: string;
  engine: string | null;
  is_mobile: boolean;
  linked_page: string | null;
  rank_page: string | null;
  ranking: number | null;
  previous_ranking: number | null;
  initial_ranking: number | null;
  best_rank: number | null;
  best_rank_date: string | null;
  local_searches: number | null;
  global_searches: number | null;
  difficulty: number | null;
  monthly_history: { month: string; searches: number }[] | null;
}

export async function listZefoKeywords(clientId: number, search?: string): Promise<ZefoKeyword[]> {
  let q = supabase.from("zefo_keywords").select("*").eq("client_id", clientId).order("ranking", { ascending: true, nullsFirst: false }).limit(1000);
  if (search) q = q.ilike("keyword", `%${search}%`);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

// Daily GSC totals for charts — from gsc_daily_totals (accurate date-only totals)
export async function gscDaily(clientId: number, from?: string, to?: string): Promise<{ date: string; clicks: number; impressions: number; avg_position: number }[]> {
  let q = supabase.from("gsc_daily_totals").select("date, clicks, impressions, position").eq("client_id", clientId).order("date");
  if (from) q = q.gte("date", from);
  if (to) q = q.lte("date", to);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map((r: any) => ({ date: r.date, clicks: r.clicks, impressions: r.impressions, avg_position: r.position }));
}

// GSC KPI totals for a date range
export interface GscKpis {
  clicks: number;
  impressions: number;
  avg_position: number;
}

export async function getGscKpis(clientId: number, from: string, to: string): Promise<GscKpis> {
  const { data, error } = await supabase
    .from("gsc_daily_totals")
    .select("date, clicks, impressions, position")
    .eq("client_id", clientId)
    .gte("date", from)
    .lte("date", to);
  if (error) throw error;
  const rows = data || [];
  if (rows.length === 0) return { clicks: 0, impressions: 0, avg_position: 0 };
  let clicks = 0;
  let impressions = 0;
  let weightedPos = 0;
  let posSum = 0;
  for (const r of rows) {
    clicks += r.clicks || 0;
    impressions += r.impressions || 0;
    weightedPos += (r.position || 0) * (r.impressions || 0);
    posSum += r.position || 0;
  }
  const avg_position = impressions > 0 ? weightedPos / impressions : posSum / rows.length;
  return { clicks, impressions, avg_position: Math.round(avg_position * 10) / 10 };
}

// Conversions summary for a date range
export interface ConversionsSummary {
  total: number;          // all channels
  organic: number;        // Organic Search channel only
  total_sessions: number;
  by_source: { label: string; conversions: number; sessions: number }[];
}

function isOrganicChannel(channel: string | null): boolean {
  return !!channel && /organic/i.test(channel);
}

export async function getConversionsSummary(clientId: number, from: string, to: string): Promise<ConversionsSummary> {
  const { data, error } = await supabase
    .from("ga4_conversions")
    .select("source, channel, conversions, sessions, date")
    .eq("client_id", clientId)
    .gte("date", from)
    .lte("date", to);
  if (error) throw error;
  const rows = (data || []) as { source: string | null; channel: string | null; conversions: number; sessions: number }[];
  let total = 0;
  let organic = 0;
  let totalSessions = 0;
  const bySrc = new Map<string, { conversions: number; sessions: number }>();
  for (const r of rows) {
    total += r.conversions || 0;
    if (isOrganicChannel(r.channel)) organic += r.conversions || 0;
    totalSessions += r.sessions || 0;
    const label = r.channel || r.source || "לא ידוע";
    const cur = bySrc.get(label) || { conversions: 0, sessions: 0 };
    cur.conversions += r.conversions || 0;
    cur.sessions += r.sessions || 0;
    bySrc.set(label, cur);
  }
  const by_source = [...bySrc.entries()]
    .map(([label, v]) => ({ label, ...v }))
    .sort((a, b) => b.conversions - a.conversions)
    .slice(0, 8);
  return { total, organic, total_sessions: totalSessions, by_source };
}

// ===== GSC opportunity analyses (for the report) =====
export interface GscQueryStat { term: string; clicks: number; impressions: number; ctr: number; position: number }
export interface GscOpportunities {
  near_first_page: GscQueryStat[];                          // position 8-20 with real impressions
  low_ctr: (GscQueryStat & { expected_ctr: number })[];    // high impressions, CTR low FOR ITS POSITION
}

/** Rough organic CTR-by-position curve (0-1). CTR is only "low" relative to position. */
export function expectedCtr(pos: number): number {
  const t: Record<number, number> = { 1: 0.30, 2: 0.15, 3: 0.10, 4: 0.07, 5: 0.05, 6: 0.04, 7: 0.035, 8: 0.03, 9: 0.025, 10: 0.02 };
  const p = Math.round(pos);
  if (p <= 1) return 0.30;
  if (p >= 11) return 0.012;
  return t[p] ?? 0.02;
}

export async function getGscOpportunities(clientId: number, from: string, to: string): Promise<GscOpportunities> {
  const { data, error } = await supabase.rpc("gsc_query_opportunities", { p_client_id: clientId, p_from: from, p_to: to });
  if (error) throw error;
  const rows = (data || []) as GscQueryStat[];
  const near_first_page = rows
    .filter((r) => r.position >= 8 && r.position <= 20 && r.impressions >= 30)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 15);
  const low_ctr = rows
    .filter((r) => r.impressions >= 50 && r.ctr < expectedCtr(r.position) * 0.6)
    .map((r) => ({ ...r, expected_ctr: expectedCtr(r.position) }))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 15);
  return { near_first_page, low_ctr };
}

// ===== Query map per page (cannibalization / content sharpening) =====
export interface PageMapEntry {
  page: string;
  primary: string;
  secondary: string[];
  clicks: number;
  impressions: number;
  position: number;
  ctr: number;
  action: string;
  cannibalized: boolean;
}
export interface CannibalTerm { term: string; pages: { page: string; impressions: number; position: number }[] }
export interface PageQueryMap { pages: PageMapEntry[]; cannibalization: CannibalTerm[] }

export async function getPageQueryMap(clientId: number, from: string, to: string): Promise<PageQueryMap> {
  const { data, error } = await supabase.rpc("gsc_page_query_map", { p_client_id: clientId, p_from: from, p_to: to });
  if (error) throw error;
  const rows = (data || []) as { page: string; term: string; clicks: number; impressions: number; ctr: number; position: number }[];

  // term -> pages (for cannibalization: one query ranking on several pages)
  const termPages = new Map<string, { page: string; impressions: number; position: number }[]>();
  for (const r of rows) {
    const arr = termPages.get(r.term) || [];
    arr.push({ page: r.page, impressions: r.impressions, position: r.position });
    termPages.set(r.term, arr);
  }
  const cannibalTerms = new Set<string>();
  const cannibalization: CannibalTerm[] = [];
  for (const [term, pages] of termPages) {
    const strong = pages.filter((p) => p.impressions >= 20);
    if (strong.length >= 2) {
      cannibalTerms.add(term);
      cannibalization.push({ term, pages: strong.sort((a, b) => b.impressions - a.impressions) });
    }
  }
  cannibalization.sort((a, b) => b.pages.reduce((s, p) => s + p.impressions, 0) - a.pages.reduce((s, p) => s + p.impressions, 0));

  // group by page
  const byPage = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = byPage.get(r.page) || [];
    arr.push(r);
    byPage.set(r.page, arr);
  }
  const pages: PageMapEntry[] = [];
  for (const [page, prows] of byPage) {
    const sorted = [...prows].sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
    const primary = sorted[0]?.term || "";
    const secondary = sorted.slice(1, 4).map((r) => r.term);
    let clicks = 0, impressions = 0, wPos = 0;
    for (const r of prows) { clicks += r.clicks; impressions += r.impressions; wPos += r.position * r.impressions; }
    const position = impressions > 0 ? Math.round((wPos / impressions) * 10) / 10 : 0;
    const ctr = impressions > 0 ? clicks / impressions : 0;
    const cannibalized = cannibalTerms.has(primary);
    let action: string;
    if (cannibalized) action = "קניבליזציה — כמה עמודים על אותו ביטוי, אחד ראשי";
    else if (position <= 3) action = "מדורג היטב — לשמר ולחזק";
    else if (position <= 10) action = "להרחיב תוכן סביב הביטוי המרכזי";
    else if (position <= 20) action = "פוטנציאל עלייה — שיפור תוכן/כותרות/קישורים פנימיים";
    else action = "לשפר משמעותית או לבדוק התאמת כוונת חיפוש";
    pages.push({ page, primary, secondary, clicks, impressions, position, ctr, action, cannibalized });
  }
  pages.sort((a, b) => b.impressions - a.impressions);
  return { pages: pages.slice(0, 30), cannibalization: cannibalization.slice(0, 15) };
}

/** Internal (team) SEO recommendations from the GSC opportunities — NOT the client report. */
export async function generateSeoRecommendations(clientId: number, from: string, to: string): Promise<{ recommendations: string }> {
  return await invokeFn("seo-recommendations", { client_id: clientId, from, to });
}

// ===== Agents: link prospecting + outreach + SEO tools =====
export type ProspectStatus = "new" | "approved" | "in_progress" | "done" | "rejected";
export type ProspectType = "directory" | "blog" | "forum" | "mention" | "local" | "other";

export interface LinkProspect {
  id: number;
  client_id: number;
  type: ProspectType;
  url: string;
  title: string | null;
  reason: string | null;
  suggested_action: string | null;
  contact: string | null;
  score: number;
  status: ProspectStatus;
  notes: string | null;
  created_at: string;
}

/** Kick off the research agent (runs in the background; poll the list for results). */
export async function runLinkProspector(clientId: number): Promise<{ started: boolean }> {
  return await invokeFn("link-prospector", { client_id: clientId });
}

/** Free-text preferences the prospecting agent always respects (learning). */
export async function updateClientLinkPrefs(clientId: number, prefs: string): Promise<void> {
  const { error } = await supabase.from("clients").update({ link_prefs: prefs }).eq("id", clientId);
  if (error) throw error;
}

export async function listLinkProspects(clientId: number): Promise<LinkProspect[]> {
  const { data, error } = await supabase
    .from("link_prospects")
    .select("*")
    .eq("client_id", clientId)
    .order("score", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function setProspectStatus(id: number, status: ProspectStatus): Promise<void> {
  const { error } = await supabase.from("link_prospects").update({ status }).eq("id", id);
  if (error) throw error;
}

export async function deleteProspect(id: number): Promise<void> {
  const { error } = await supabase.from("link_prospects").delete().eq("id", id);
  if (error) throw error;
}

const PROSPECT_TYPE_LABEL: Record<ProspectType, string> = {
  directory: "אינדקס עסקים", blog: "פוסט בבלוג", forum: "פורום", mention: "אזכור מותג", local: "רישום מקומי", other: "אחר",
};

/** Approve a prospect into the manual link bank + mark it done. */
export async function promoteProspectToBank(p: LinkProspect): Promise<void> {
  await createReportLink(p.client_id, { link_type: PROSPECT_TYPE_LABEL[p.type] || "אחר", url: p.url, notes: p.title || null });
  await setProspectStatus(p.id, "done");
}

/** Phase 2 — draft outreach for a prospect. */
export async function draftOutreach(prospectId: number): Promise<{ subject: string; body: string }> {
  return await invokeFn("outreach-draft", { prospect_id: prospectId });
}

// ===== Forum outreach (URL-specific link finding) =====
export interface ForumSite {
  id: number;
  client_id: number;
  url: string;
  name: string | null;
  max_pages: number;
  max_threads: number;
  active: boolean;
  last_scanned_at: string | null;
  last_scan_note: string | null;
  last_scan_found: number | null;
  parent_url: string | null;
  created_at: string;
}
export interface ForumLead {
  id: number;
  client_id: number;
  forum_site_id: number | null;
  thread_url: string;
  thread_title: string | null;
  question: string | null;
  suggested_reply: string | null;
  target_url: string | null;
  score: number;
  status: ProspectStatus;
  notes: string | null;
  created_at: string;
}

export async function listForumSites(clientId: number): Promise<ForumSite[]> {
  const { data, error } = await supabase.from("forum_sites").select("*")
    .eq("client_id", clientId).order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}
export async function createForumSite(clientId: number, body: { url: string; name?: string | null; max_pages?: number; max_threads?: number }): Promise<ForumSite> {
  const { data, error } = await supabase.from("forum_sites")
    .insert({ client_id: clientId, ...body }).select().single();
  if (error) throw error;
  return data;
}
export async function updateForumSite(id: number, body: Partial<Pick<ForumSite, "url" | "name" | "max_pages" | "max_threads" | "active">>): Promise<void> {
  const { error } = await supabase.from("forum_sites").update(body).eq("id", id);
  if (error) throw error;
}
export async function deleteForumSite(id: number): Promise<void> {
  const { error } = await supabase.from("forum_sites").delete().eq("id", id);
  if (error) throw error;
}

/** Kick off the forum scan (runs in the background; poll the leads list for results). */
export async function runForumScan(clientId: number): Promise<{ started: boolean; remaining: number; note?: string }> {
  return await invokeFn("forum-scan", { client_id: clientId });
}

/** Discover sub-forums under a parent forum URL; add=true also registers them as sites. */
export async function discoverSubforums(clientId: number, url: string, add: boolean): Promise<{ found: { url: string; title: string }[]; added: number; note?: string }> {
  return await invokeFn("forum-discover", { client_id: clientId, url, add });
}

export async function listForumLeads(clientId: number): Promise<ForumLead[]> {
  const { data, error } = await supabase.from("forum_leads").select("*")
    .eq("client_id", clientId)
    .order("score", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}
export async function setForumLeadStatus(id: number, status: ProspectStatus): Promise<void> {
  const { error } = await supabase.from("forum_leads").update({ status }).eq("id", id);
  if (error) throw error;
}
export async function updateForumLead(id: number, body: Partial<Pick<ForumLead, "suggested_reply" | "target_url" | "notes" | "status">>): Promise<void> {
  const { error } = await supabase.from("forum_leads").update(body).eq("id", id);
  if (error) throw error;
}
export async function deleteForumLead(id: number): Promise<void> {
  const { error } = await supabase.from("forum_leads").delete().eq("id", id);
  if (error) throw error;
}

/** Per-client guidance the forum agent always respects. */
export async function updateClientForumPrefs(clientId: number, prefs: string): Promise<void> {
  const { error } = await supabase.from("clients").update({ forum_prefs: prefs }).eq("id", clientId);
  if (error) throw error;
}

// ===== Unified recommendation engine =====
export type RecType = "title_meta" | "improve_page" | "add_keywords" | "new_content" | "cannibalization" | "internal_link" | "performance_drop" | "technical";
export type RecStatus = "pending" | "applied" | "ignored" | "done";
export interface Recommendation {
  id: number;
  client_id: number;
  type: RecType;
  source: string | null;
  page: string | null;
  keyword: string | null;
  title: string;
  opportunity: string | null;
  whats_missing: string | null;
  action: string | null;
  potential: "high" | "medium" | "low";
  est_visits: number;
  effort: "low" | "medium" | "high";
  confidence: string;
  score: number;
  status: RecStatus;
  example: string | null;
  applied_note: string | null;
  applied_at: string | null;
  clicks_before: number | null;
  created_at: string;
}

export async function generateRecommendations(clientId: number, months: 3 | 6 | 12): Promise<{ count: number; months: number }> {
  return await invokeFn("recommendations-generate", { client_id: clientId, months });
}
export async function listRecommendations(clientId: number): Promise<Recommendation[]> {
  const { data, error } = await supabase.from("recommendations").select("*").eq("client_id", clientId).order("score", { ascending: false });
  if (error) throw error;
  return data || [];
}
export async function generateRecExample(recId: number): Promise<{ example: string }> {
  return await invokeFn("recommendation-example", { rec_id: recId });
}
export async function applyRecommendation(recId: number, modification?: string): Promise<{ applied: boolean; note: string }> {
  return await invokeFn("recommendation-apply", { rec_id: recId, modification: modification || undefined });
}
export async function setRecommendationStatus(recId: number, status: RecStatus): Promise<void> {
  const { error } = await supabase.from("recommendations").update({ status }).eq("id", recId);
  if (error) throw error;
}

// ===== Generic data uploads =====
export interface UploadedDataset {
  id: number; client_id: number; filename: string | null; source: string | null; data_type: string | null;
  date_from: string | null; date_to: string | null; row_count: number; mapping: Record<string, string> | null; created_at: string;
}
export async function uploadData(clientId: number, filename: string, content: string): Promise<{ dataset_id: number; source: string; data_type: string; row_count: number; columns: Record<string, string>; date_from: string | null; date_to: string | null; routed_to?: string | null }> {
  return await invokeFn("data-upload", { client_id: clientId, filename, content });
}
export async function listDatasets(clientId: number): Promise<UploadedDataset[]> {
  const { data, error } = await supabase.from("uploaded_datasets").select("*").eq("client_id", clientId).order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}
export interface UploadedRow {
  id: number; dataset_id: number; page: string | null; query: string | null; keyword: string | null;
  clicks: number | null; impressions: number | null; ctr: number | null; position: number | null;
  sessions: number | null; conversions: number | null;
}
export async function listUploadedRows(datasetId: number, limit = 50): Promise<UploadedRow[]> {
  const { data, error } = await supabase.from("uploaded_rows").select("*").eq("dataset_id", datasetId).limit(limit);
  if (error) throw error;
  return data || [];
}

export async function deleteDataset(id: number): Promise<void> {
  const { error } = await supabase.from("uploaded_datasets").delete().eq("id", id);
  if (error) throw error;
}

// ===== Site crawl =====
export interface CrawledPage {
  url: string; title: string | null; page_type: string | null; word_count: number | null;
  meta_description: string | null; h1: string | null; images_missing_alt: number | null;
  internal_links_out: number | null; last_full_crawl: string | null;
}
export async function runSiteCrawl(clientId: number): Promise<{ started: boolean }> {
  return await invokeFn("site-crawl", { client_id: clientId });
}
export async function listCrawledPages(clientId: number): Promise<CrawledPage[]> {
  const { data, error } = await supabase
    .from("pages")
    .select("url, title, page_type, word_count, meta_description, h1, images_missing_alt, internal_links_out, last_full_crawl")
    .eq("client_id", clientId)
    .not("last_full_crawl", "is", null);
  if (error) throw error;
  return (data || []) as CrawledPage[];
}

// ===== Impact tracking (computed from GSC history) =====
export interface ImpactRow {
  rec_id: number; page: string | null; title: string; applied_note: string | null; applied_at: string;
  clicks_before: number; clicks_now: number; impressions_before: number; impressions_now: number;
}
export async function getImpactStats(clientId: number): Promise<ImpactRow[]> {
  const { data, error } = await supabase.rpc("impact_stats", { p_client_id: clientId });
  if (error) throw error;
  return (data || []).map((r: any) => ({
    ...r,
    clicks_before: +r.clicks_before, clicks_now: +r.clicks_now,
    impressions_before: +r.impressions_before, impressions_now: +r.impressions_now,
  }));
}

// ===== Activity log (what was done) — for the annual client report =====
export interface ActivityEntry {
  id: string; date: string | null; area: string; title: string; page: string | null; note: string | null;
  kind: "recommendation" | "audit" | "task";
  clicks_before?: number; clicks_now?: number; impressions_before?: number; impressions_now?: number;
}
const REC_AREA: Record<string, string> = {
  title_meta: "תוכן על-עמודי", improve_page: "תוכן על-עמודי", add_keywords: "תוכן על-עמודי",
  new_content: "תוכן חדש", internal_link: "קישורים פנימיים", cannibalization: "קניבליזציה",
  performance_drop: "שחזור ביצועים", technical: "טכני",
};
const PILLAR_AREA: Record<string, string> = {
  technical: "תשתית טכנית", speed: "מהירות", content: "תוכן על-עמודי", traffic: "הרחבת תנועה",
  authority: "סמכות וקישורים", conversions: "המרות ו-UX",
};

/** Unified log of everything done (applied recs, applied audit fixes, completed manual tasks). */
export async function getActivityLog(clientId: number): Promise<ActivityEntry[]> {
  const [recsR, auditsR, tasksR, impact] = await Promise.all([
    supabase.from("recommendations").select("id, type, title, page, applied_note, applied_at").eq("client_id", clientId).in("status", ["applied", "done"]),
    supabase.from("audit_issues").select("id, issue, page, applied_note, created_at").eq("client_id", clientId).eq("status", "applied"),
    supabase.from("tasks").select("*").eq("client_id", clientId).eq("status", "done"),
    getImpactStats(clientId).catch(() => [] as ImpactRow[]),
  ]);
  if (recsR.error) throw recsR.error;
  const impByRec = new Map<number, ImpactRow>((impact || []).map((r) => [r.rec_id, r]));
  const out: ActivityEntry[] = [];

  for (const r of recsR.data || []) {
    const im = impByRec.get(r.id);
    out.push({
      id: `rec:${r.id}`, date: r.applied_at, area: REC_AREA[r.type] || "תוכן", title: r.title, page: r.page, note: r.applied_note,
      kind: "recommendation",
      clicks_before: im?.clicks_before, clicks_now: im?.clicks_now, impressions_before: im?.impressions_before, impressions_now: im?.impressions_now,
    });
  }
  for (const a of auditsR.data || []) {
    out.push({ id: `audit:${a.id}`, date: a.created_at, area: "אודיט טכני", title: a.issue, page: a.page, note: a.applied_note, kind: "audit" });
  }
  for (const t of tasksR.data || []) {
    if (t.source_type === "recommendation" || t.source_type === "audit") continue; // covered above
    out.push({ id: `task:${t.id}`, date: t.done_at || t.due_date, area: PILLAR_AREA[t.category || ""] || "משימה", title: t.title, page: t.page_url, note: t.note, kind: "task" });
  }
  return out.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

// ===== All-pages master =====
export interface PageStat { page: string; clicks: number; impressions: number; ctr: number; position: number }
export async function getPageStats(clientId: number, from: string, to: string): Promise<PageStat[]> {
  const { data, error } = await supabase.rpc("gsc_page_stats", { p_client_id: clientId, p_from: from, p_to: to });
  if (error) throw error;
  return (data || []) as PageStat[];
}

// Phase 3 — SEO tools
export type AuditSeverity = "high" | "medium" | "low";
export type AuditStatus = "pending" | "applied" | "rejected";
export interface AuditIssueRow {
  id: number;
  client_id: number;
  page: string;
  issue: string;
  fix: string;
  severity: AuditSeverity;
  status: AuditStatus;
  applied_note: string | null;
  created_at: string;
}

/** Run the audit — it persists the findings and returns a summary. */
export async function runSeoAudit(clientId: number): Promise<{ summary: string; count: number; pages_checked: number }> {
  return await invokeFn("seo-audit", { client_id: clientId });
}

/** Persisted audit findings (survive refresh; each keeps its status until acted on). */
export async function listAuditIssues(clientId: number): Promise<AuditIssueRow[]> {
  const { data, error } = await supabase.from("audit_issues").select("*").eq("client_id", clientId).order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

/** Apply a fix (optionally with a user modification). Reversible via WP revisions. */
export async function applyAuditFix(issueId: number, modification?: string): Promise<{ applied: boolean; target: string; note: string }> {
  return await invokeFn("audit-fix", { issue_id: issueId, modification: modification || undefined });
}

export async function rejectAuditIssue(id: number): Promise<void> {
  const { error } = await supabase.from("audit_issues").update({ status: "rejected" }).eq("id", id);
  if (error) throw error;
}

export async function resetAuditIssue(id: number): Promise<void> {
  const { error } = await supabase.from("audit_issues").update({ status: "pending", applied_note: null }).eq("id", id);
  if (error) throw error;
}

export async function setAuditStatus(id: number, status: "pending" | "applied" | "rejected", note?: string): Promise<void> {
  const patch: any = { status };
  if (note !== undefined) patch.applied_note = note;
  const { error } = await supabase.from("audit_issues").update(patch).eq("id", id);
  if (error) throw error;
}

// ===== EEAT / relevance analyzer =====
export interface EeatScore { score: number; note: string }
export interface EeatResult {
  page_url: string; keyword: string; title: string; h1: string; meta_description: string;
  overall_score: number;
  relevance: { score: number; verdict: string };
  direct_answer: { answers_directly: boolean; early: boolean; explanation: string; suggested_snippet: string };
  eeat: { experience: EeatScore; expertise: EeatScore; authoritativeness: EeatScore; trust: EeatScore };
  fixes: string[];
}
export async function analyzeEeat(clientId: number, pageUrl: string, keyword: string): Promise<EeatResult> {
  return await invokeFn("eeat-analyze", { client_id: clientId, page_url: pageUrl, keyword });
}
/** Push the analyzer's fixes into the recommendation engine (→ flows to tasks + impact). */
export async function addFixesAsRecommendations(clientId: number, pageUrl: string, keyword: string, fixes: string[]): Promise<number> {
  const rows = fixes.map((f) => ({
    client_id: clientId, type: "improve_page", page: pageUrl, keyword,
    title: f.slice(0, 200), action: f, opportunity: `EEAT/רלוונטיות: ${keyword}`,
    potential: "medium", status: "pending", source: "eeat",
  }));
  const { data, error } = await supabase.from("recommendations").insert(rows).select("id");
  if (error) throw error;
  return data?.length || 0;
}

// ===== Auto-blog (WordPress) =====
export interface ClientWordpress {
  client_id: number;
  site_url: string;
  username: string;
  mode: "publish" | "draft";
  enabled: boolean;
  require_approval: boolean;
  blog_instructions: string | null;
  last_published_at: string | null;
  bridge_enabled: boolean;
  created_at: string;
}
export interface BlogPost {
  id: number;
  client_id: number;
  title: string;
  keyword: string | null;
  reason: string | null;
  wp_post_id: number | null;
  url: string | null;
  status: string | null;
  error: string | null;
  created_at: string;
}

/** Read the WP connection WITHOUT the app password. */
export async function getWordpress(clientId: number): Promise<ClientWordpress | null> {
  const { data, error } = await supabase
    .from("client_wordpress")
    .select("client_id, site_url, username, mode, enabled, require_approval, blog_instructions, last_published_at, bridge_enabled, created_at")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function connectWordpress(
  clientId: number,
  body: { site_url: string; username: string; app_password: string; mode: "publish" | "draft"; enabled?: boolean },
): Promise<{ ok: boolean; wp_user: string; site: string }> {
  return await invokeFn("wp-connect", { client_id: clientId, ...body });
}

export async function updateWordpressSettings(clientId: number, patch: { mode?: "publish" | "draft"; enabled?: boolean; require_approval?: boolean; blog_instructions?: string; bridge_secret?: string; bridge_enabled?: boolean }): Promise<void> {
  const { error } = await supabase.from("client_wordpress").update(patch).eq("client_id", clientId);
  if (error) throw error;
}

/** Semi-auto step 1: propose a topic + rationale (no article written yet). */
export async function proposeBlog(clientId: number): Promise<{ keyword: string; title: string; reason: string }> {
  return await invokeFn("blog-propose", { client_id: clientId });
}

/** Semi-auto step 2: approve a proposal → write & publish it. */
export async function approveBlogProposal(proposalId: number): Promise<{ title: string; url: string; status: string; keyword: string }> {
  return await invokeFn("blog-approve", { proposal_id: proposalId });
}

export async function rejectBlogProposal(id: number): Promise<void> {
  const { error } = await supabase.from("blog_posts").update({ status: "rejected" }).eq("id", id);
  if (error) throw error;
}

export async function deleteBlogPost(id: number): Promise<void> {
  const { error } = await supabase.from("blog_posts").delete().eq("id", id);
  if (error) throw error;
}

export async function disconnectWordpress(clientId: number): Promise<void> {
  const { error } = await supabase.from("client_wordpress").delete().eq("client_id", clientId);
  if (error) throw error;
}

export async function publishBlogNow(clientId: number): Promise<{ title: string; url: string; status: string; keyword: string }> {
  return await invokeFn("blog-publish", { client_id: clientId });
}

/** Generate a SAMPLE article draft (no publishing). Returns the title + a preview. */
export async function sampleBlog(clientId: number, keyword?: string): Promise<{ title: string; keyword: string; preview?: string; image?: boolean }> {
  return await invokeFn("blog-publish", { client_id: clientId, dry_run: true, keyword: keyword || undefined });
}

export async function listBlogPosts(clientId: number): Promise<BlogPost[]> {
  const { data, error } = await supabase.from("blog_posts").select("*").eq("client_id", clientId).order("created_at", { ascending: false }).limit(50);
  if (error) throw error;
  return data || [];
}

export interface ContentBrief {
  keyword: string;
  suggested_title: string;
  search_intent: string;
  outline: string[];
  questions: string[];
  entities: string[];
  internal_links: string;
  word_count: string;
  notes: string;
}
export async function generateContentBrief(clientId: number, keyword: string): Promise<ContentBrief> {
  return await invokeFn("content-brief", { client_id: clientId, keyword });
}

/**
 * Sync GSC + GA4 for an exact period so the report reflects real, current numbers.
 * Best-effort per source — one failing shouldn't block the other.
 */
export async function syncReportPeriod(clientId: number, from: string, to: string): Promise<{ gsc?: string; ga4?: string }> {
  const result: { gsc?: string; ga4?: string } = {};
  const [gsc, ga4] = await Promise.allSettled([
    invokeFn("gsc-sync", { client_id: clientId, from, to }),
    invokeFn("ga4-sync", { client_id: clientId, from, to }),
  ]);
  if (gsc.status === "rejected") result.gsc = (gsc.reason as Error)?.message || "שגיאת GSC";
  if (ga4.status === "rejected") result.ga4 = (ga4.reason as Error)?.message || "שגיאת GA4";
  return result;
}

// GA4 daily totals for charts (organic only — server-side filtered already)
export async function ga4Daily(clientId: number, from?: string, to?: string): Promise<{ date: string; sessions: number; users: number }[]> {
  let q = supabase
    .from("ga4_metrics")
    .select("date, sessions, total_users")
    .eq("client_id", clientId);
  if (from) q = q.gte("date", from);
  if (to) q = q.lte("date", to);
  const { data, error } = await q;
  if (error) throw error;
  // Aggregate client-side per date
  const agg = new Map<string, { sessions: number; users: number }>();
  for (const r of data || []) {
    const cur = agg.get(r.date) || { sessions: 0, users: 0 };
    cur.sessions += r.sessions || 0;
    cur.users += r.total_users || 0;
    agg.set(r.date, cur);
  }
  return [...agg.entries()].map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date));
}

export interface RankBuckets { top3: number; top10: number; top30: number; top100: number; unranked: number; total: number }
export async function zefoRankBuckets(clientId: number): Promise<RankBuckets | null> {
  const { data, error } = await supabase.from("zefo_rank_buckets").select("*").eq("client_id", clientId).maybeSingle();
  if (error) throw error;
  return data;
}

// ===== Tasks =====
export async function listTasks(clientId: number): Promise<Task[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("client_id", clientId)
    .order("status", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createTask(
  clientId: number,
  title: string,
  details?: string | null,
  priority?: Task["priority"],
): Promise<Task> {
  const { data, error } = await supabase
    .from("tasks")
    .insert({ client_id: clientId, title, details: details ?? null, priority: priority ?? null, source: "manual", status: "open" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Log a task that was already completed (flows into the activity log + reports). */
export async function createCompletedTask(
  clientId: number,
  body: { title: string; note?: string | null; page_url?: string | null; done_on?: string | null },
): Promise<Task> {
  const done_at = body.done_on ? new Date(body.done_on + "T12:00:00").toISOString() : new Date().toISOString();
  const { data, error } = await supabase.from("tasks")
    .insert({ client_id: clientId, title: body.title, note: body.note || null, page_url: body.page_url || null, source: "manual", status: "done", done_at })
    .select().single();
  if (error) throw error;
  return data;
}

export async function setTaskDone(id: number, done: boolean): Promise<void> {
  const { error } = await supabase
    .from("tasks")
    .update({ status: done ? "done" : "open", done_at: done ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteTask(id: number): Promise<void> {
  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) throw error;
}

export async function bulkCreateTasks(clientId: number, titles: string[]): Promise<number> {
  if (titles.length === 0) return 0;
  const rows = titles.map((title) => ({ client_id: clientId, title, source: "upload", status: "open" }));
  const { data, error } = await supabase.from("tasks").insert(rows).select("id");
  if (error) throw error;
  return data?.length || 0;
}

export async function suggestTasks(clientId: number): Promise<{ created: number; tasks: Task[] }> {
  return await invokeFn("tasks-suggest", { client_id: clientId });
}

/** Build the strategic 3-month plan (pillars + subtasks) from all the system's data. */
export async function generateWorkPlan(clientId: number): Promise<{ created: number; pillars: number; note?: string }> {
  return await invokeFn("work-plan", { client_id: clientId });
}

/** Generate step-by-step guidance for a manual subtask (stores it + marks done). */
export async function guideTask(taskId: number): Promise<{ note: string }> {
  return await invokeFn("task-guide", { task_id: taskId });
}

/** Preview (read-only): a draft text to review, or detailed how-to steps. Changes nothing. */
export async function previewTask(taskId: number): Promise<{ mode: "draft" | "guidance"; text: string }> {
  return await invokeFn("task-preview", { task_id: taskId });
}

export async function setTaskStatus(id: number, status: TaskStatus, note?: string): Promise<void> {
  const patch: any = { status, done_at: status === "done" ? new Date().toISOString() : null };
  if (note !== undefined) patch.note = note;
  const { error } = await supabase.from("tasks").update(patch).eq("id", id);
  if (error) throw error;
}

// ===== Suggestions (הצעות ייעול) — a single shared board across the whole team =====
export async function listSuggestions(): Promise<Suggestion[]> {
  const { data, error } = await supabase
    .from("suggestions")
    .select("*, comments:suggestion_comments(id, suggestion_id, author, body, created_at)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  // Sort each suggestion's comments oldest-first for a natural thread order.
  return (data || []).map((s: any) => ({
    ...s,
    comments: (s.comments || []).sort((a: SuggestionComment, b: SuggestionComment) =>
      a.created_at.localeCompare(b.created_at),
    ),
  }));
}

/** Edit a suggestion's body text. */
export async function updateSuggestion(id: number, body: string): Promise<void> {
  const { error } = await supabase.from("suggestions").update({ body: body.trim() || null }).eq("id", id);
  if (error) throw error;
}

/** Set workflow status (open / in_progress / done). Stamps done_at on 'done'. */
export async function setSuggestionStatus(id: number, status: SuggestionStatus): Promise<void> {
  const { error } = await supabase
    .from("suggestions")
    .update({ status, done_at: status === "done" ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) throw error;
}

// --- Comments ---
export async function addSuggestionComment(
  suggestionId: number,
  author: "moshe" | "mordechai",
  body: string,
): Promise<SuggestionComment> {
  const { data, error } = await supabase
    .from("suggestion_comments")
    .insert({ suggestion_id: suggestionId, author, body: body.trim() })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateSuggestionComment(id: number, body: string): Promise<void> {
  const { error } = await supabase.from("suggestion_comments").update({ body: body.trim() }).eq("id", id);
  if (error) throw error;
}

export async function deleteSuggestionComment(id: number): Promise<void> {
  const { error } = await supabase.from("suggestion_comments").delete().eq("id", id);
  if (error) throw error;
}

export async function createSuggestion(
  author: "moshe" | "mordechai",
  body: string | null,
  files: File[],
): Promise<Suggestion> {
  const attachments: SuggestionAttachment[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const path = `global/${Date.now()}_${i}_${file.name.replace(/[^\w.\-]+/g, "_")}`;
    const { error: upErr } = await supabase.storage.from("suggestions").upload(path, file);
    if (upErr) throw upErr;
    attachments.push({ name: file.name, path, type: file.type, size: file.size });
  }
  const trimmed = (body ?? "").trim();
  const { data, error } = await supabase
    .from("suggestions")
    .insert({ author, body: trimmed || null, attachments })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteSuggestion(s: Suggestion): Promise<void> {
  if (s.attachments && s.attachments.length > 0) {
    await supabase.storage.from("suggestions").remove(s.attachments.map((a) => a.path));
  }
  const { error } = await supabase.from("suggestions").delete().eq("id", s.id);
  if (error) throw error;
}

export async function suggestionFileUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from("suggestions").createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}

// ===== Dashboard KPIs =====
export interface DashboardData {
  client: Client;
  stats: {
    keyword_count: number;
    page_count: number;
    pages_with_faq: number;
    gsc_clicks: number;
    gsc_impressions: number;
    avg_position: number;
  };
  top_keywords: { id: number; term: string; monthly_searches: number; competition: string | null }[];
  top_pages: { url: string; clicks: number }[];
  top_zefo_keywords: { zefo_keyword_id: number; keyword: string; ranking: number | null; previous_ranking: number | null }[];
  conversions: {
    total: number;
    total_sessions: number;
    by_source: { label: string; conversions: number; sessions: number }[];
  };
}

export async function getDashboard(clientId: number): Promise<DashboardData> {
  const [{ data: client }, { data: stats }, { data: topKw }, { data: gscRows }, { data: zefoRows }, { data: convRows }] = await Promise.all([
    supabase.from("clients").select("*").eq("id", clientId).maybeSingle(),
    supabase.from("client_stats").select("*").eq("client_id", clientId).maybeSingle(),
    supabase
      .from("keywords")
      .select("id, term, monthly_searches, competition")
      .eq("client_id", clientId)
      .order("monthly_searches", { ascending: false })
      .limit(10),
    supabase
      .from("gsc_metrics")
      .select("page, clicks")
      .eq("client_id", clientId)
      .not("page", "is", null),
    supabase
      .from("zefo_keywords")
      .select("zefo_keyword_id, keyword, ranking, previous_ranking")
      .eq("client_id", clientId)
      .gt("ranking", 0) // exclude -1 / null (= not ranked in the first pages), which sort first
      .order("ranking", { ascending: true, nullsFirst: false })
      .limit(10),
    supabase
      .from("ga4_conversions")
      .select("channel, source, conversions, sessions")
      .eq("client_id", clientId),
  ]);

  // Aggregate top pages client-side
  const agg = new Map<string, number>();
  for (const r of gscRows || []) agg.set(r.page!, (agg.get(r.page!) || 0) + (r.clicks || 0));
  const topPages = [...agg.entries()]
    .map(([url, clicks]) => ({ url, clicks }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 10);

  // Aggregate conversions by source client-side
  const conv = (convRows || []) as Ga4ConversionRow[];
  const total = conv.reduce((s, r) => s + (r.conversions || 0), 0);
  const totalSessions = conv.reduce((s, r) => s + (r.sessions || 0), 0);
  const bySrc = new Map<string, { conversions: number; sessions: number }>();
  for (const r of conv) {
    const label = r.source || r.channel || "לא ידוע";
    const cur = bySrc.get(label) || { conversions: 0, sessions: 0 };
    cur.conversions += r.conversions || 0;
    cur.sessions += r.sessions || 0;
    bySrc.set(label, cur);
  }
  const bySource = [...bySrc.entries()]
    .map(([label, v]) => ({ label, ...v }))
    .sort((a, b) => b.conversions - a.conversions)
    .slice(0, 6);

  return {
    client: client as Client,
    stats: {
      keyword_count: stats?.keyword_count || 0,
      page_count: stats?.page_count || 0,
      pages_with_faq: stats?.pages_with_faq || 0,
      gsc_clicks: stats?.gsc_clicks || 0,
      gsc_impressions: stats?.gsc_impressions || 0,
      avg_position: stats?.avg_position || 0,
    },
    top_keywords: topKw || [],
    top_pages: topPages,
    top_zefo_keywords: zefoRows || [],
    conversions: {
      total,
      total_sessions: totalSessions,
      by_source: bySource,
    },
  };
}

// ===== Reports (דוח קידום חודשי) =====
export interface ReportLink {
  id: number;
  client_id: number;
  link_type: string;
  url: string;
  notes: string | null;
  done_on: string;
  created_at: string;
}

export interface Report {
  id: number;
  client_id: number;
  title: string | null;
  period_from: string;
  period_to: string;
  summary_text: string | null;
  recommendations_text: string | null;
  created_at: string;
  updated_at: string;
}

// --- Manual link-building log ---
export async function listReportLinks(clientId: number, from?: string, to?: string): Promise<ReportLink[]> {
  let q = supabase.from("report_links").select("*").eq("client_id", clientId).order("done_on", { ascending: false });
  if (from) q = q.gte("done_on", from);
  if (to) q = q.lte("done_on", to);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function createReportLink(
  clientId: number,
  link: { link_type: string; url: string; notes?: string | null; done_on?: string },
): Promise<ReportLink> {
  const { data, error } = await supabase
    .from("report_links")
    .insert({ client_id: clientId, link_type: link.link_type, url: link.url, notes: link.notes || null, done_on: link.done_on || undefined })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Bulk add pasted links. Each item is "type<TAB or comma>url" or just a url. */
export async function bulkCreateReportLinks(
  clientId: number,
  rows: { link_type: string; url: string; done_on?: string }[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const payload = rows.map((r) => ({ client_id: clientId, link_type: r.link_type, url: r.url, done_on: r.done_on || undefined }));
  const { data, error } = await supabase.from("report_links").insert(payload).select("id");
  if (error) throw error;
  return (data || []).length;
}

export async function deleteReportLink(id: number): Promise<void> {
  const { error } = await supabase.from("report_links").delete().eq("id", id);
  if (error) throw error;
}

// --- Custom link-type presets (team-wide) ---
export interface LinkTypePreset { id: number; name: string }
export async function listLinkTypePresets(): Promise<LinkTypePreset[]> {
  const { data, error } = await supabase.from("link_type_presets").select("id, name").order("name");
  if (error) throw error;
  return data || [];
}
export async function addLinkTypePreset(name: string): Promise<void> {
  const { error } = await supabase.from("link_type_presets").insert({ name: name.trim() });
  if (error && !String(error.message).includes("duplicate")) throw error;
}
export async function deleteLinkTypePreset(id: number): Promise<void> {
  const { error } = await supabase.from("link_type_presets").delete().eq("id", id);
  if (error) throw error;
}

// --- Saved reports ---
export async function listReports(clientId: number): Promise<Report[]> {
  const { data, error } = await supabase
    .from("reports")
    .select("*")
    .eq("client_id", clientId)
    .order("period_to", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getReport(id: number): Promise<Report | null> {
  const { data, error } = await supabase.from("reports").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createReport(body: {
  client_id: number;
  title?: string | null;
  period_from: string;
  period_to: string;
  summary_text?: string | null;
  recommendations_text?: string | null;
}): Promise<Report> {
  const { data, error } = await supabase.from("reports").insert(body).select().single();
  if (error) throw error;
  return data;
}

export async function updateReport(id: number, body: Partial<Report>): Promise<Report> {
  const { data, error } = await supabase.from("reports").update(body).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteReport(id: number): Promise<void> {
  const { error } = await supabase.from("reports").delete().eq("id", id);
  if (error) throw error;
}

// --- Per-client report branding (logo + accent color) ---
export interface ClientBranding { client_id: number; logo_url: string | null; brand_color: string | null }
export async function getBranding(clientId: number): Promise<ClientBranding | null> {
  const { data, error } = await supabase.from("client_branding").select("client_id, logo_url, brand_color").eq("client_id", clientId).maybeSingle();
  if (error) throw error;
  return data;
}
export async function saveBranding(clientId: number, body: { logo_url?: string | null; brand_color?: string | null }): Promise<void> {
  const { error } = await supabase.from("client_branding").upsert({ client_id: clientId, ...body, updated_at: new Date().toISOString() }, { onConflict: "client_id" });
  if (error) throw error;
}

// --- Customizable sidebar menu layout (team-wide) ---
export async function getNavConfig(): Promise<NavEntry[] | null> {
  const { data, error } = await supabase.from("app_settings").select("value").eq("key", "client_nav").maybeSingle();
  if (error) throw error;
  return (data?.value as NavEntry[]) || null;
}
export async function saveNavConfig(value: NavEntry[]): Promise<void> {
  const { error } = await supabase.from("app_settings").upsert({ key: "client_nav", value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw error;
}

// --- Report items (completed actions inside a report) ---
export interface ReportItem {
  id: number; report_id: number; client_id: number;
  title: string; why: string | null; page_url: string | null; category: string | null; custom_group: string | null;
  source_type: string | null; source_ref: string | null; sort_order: number; created_at: string;
}
/** Merge several items under one custom heading (or pass null to un-merge). */
export async function setReportItemsGroup(ids: number[], label: string | null): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from("report_items").update({ custom_group: label }).in("id", ids);
  if (error) throw error;
}
export async function listReportItems(reportId: number): Promise<ReportItem[]> {
  const { data, error } = await supabase.from("report_items").select("*").eq("report_id", reportId).order("sort_order", { ascending: true });
  if (error) throw error;
  return data || [];
}
export async function createReportItem(reportId: number, clientId: number, body: { title: string; why?: string | null; page_url?: string | null }): Promise<ReportItem> {
  const { data, error } = await supabase.from("report_items")
    .insert({ report_id: reportId, client_id: clientId, title: body.title, why: body.why || null, page_url: body.page_url || null, source_type: "manual" })
    .select().single();
  if (error) throw error;
  return data;
}
export async function updateReportItem(id: number, body: Partial<Pick<ReportItem, "title" | "why" | "page_url">>): Promise<void> {
  const { error } = await supabase.from("report_items").update(body).eq("id", id);
  if (error) throw error;
}
export async function deleteReportItem(id: number): Promise<void> {
  const { error } = await supabase.from("report_items").delete().eq("id", id);
  if (error) throw error;
}
/** Pull all completed actions (any tab) into the report with client-facing explanations. */
export async function syncReportItems(reportId: number): Promise<{ added: number; note?: string }> {
  return await invokeFn("report-items-sync", { report_id: reportId });
}
/** AI redraft of one item's title + explanation (returns a draft; not saved). */
export async function improveReportItem(itemId: number, instructions?: string): Promise<{ title: string; why: string }> {
  return await invokeFn("report-item-improve", { item_id: itemId, instructions });
}
/** Add all new completed actions to the client's most recent report. */
export async function addToLatestReport(clientId: number): Promise<{ report_id: number; added: number } | null> {
  const reps = await listReports(clientId);
  if (!reps.length) return null;
  const res = await syncReportItems(reps[0].id);
  return { report_id: reps[0].id, added: res.added };
}

/**
 * Ask Claude to draft the narrative for a period. Pass `opts.instructions` (plus the
 * current text) to revise an existing draft instead of writing from scratch.
 */
export async function generateReportNarrative(
  clientId: number,
  from: string,
  to: string,
  opts?: { instructions?: string; current_summary?: string; current_recommendations?: string },
): Promise<{ summary: string; recommendations: string }> {
  return await invokeFn("report-generate", {
    client_id: clientId,
    from,
    to,
    instructions: opts?.instructions,
    current_summary: opts?.current_summary,
    current_recommendations: opts?.current_recommendations,
  });
}
