import { supabase, invokeFn, invokeFnFormData } from "./supabase";

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

// Daily aggregated GSC for charts
export async function gscDaily(clientId: number): Promise<{ date: string; clicks: number; impressions: number; avg_position: number }[]> {
  const { data, error } = await supabase.from("gsc_daily").select("date, clicks, impressions, avg_position").eq("client_id", clientId).order("date");
  if (error) throw error;
  return data || [];
}

// GA4 daily totals for charts (organic only — server-side filtered already)
export async function ga4Daily(clientId: number): Promise<{ date: string; sessions: number; users: number }[]> {
  const { data, error } = await supabase
    .from("ga4_metrics")
    .select("date, sessions, total_users")
    .eq("client_id", clientId);
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
}

export async function getDashboard(clientId: number): Promise<DashboardData> {
  const [{ data: client }, { data: stats }, { data: topKw }, { data: gscRows }] = await Promise.all([
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
  ]);

  // Aggregate top pages client-side
  const agg = new Map<string, number>();
  for (const r of gscRows || []) agg.set(r.page!, (agg.get(r.page!) || 0) + (r.clicks || 0));
  const topPages = [...agg.entries()]
    .map(([url, clicks]) => ({ url, clicks }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 10);

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
  };
}
