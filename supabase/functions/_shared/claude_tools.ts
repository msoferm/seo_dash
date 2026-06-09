/** Tool definitions + executor for Claude chat over SEO data. */
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { ToolDefinition } from "./anthropic.ts";

export const SEO_TOOLS: ToolDefinition[] = [
  {
    name: "get_keyword_stats",
    description: "מחזיר נתוני חיפוש חודשיים, רמת תחרות, ומיקום ממוצע למילת מפתח של הלקוח.",
    input_schema: {
      type: "object",
      properties: { term: { type: "string", description: "מילת המפתח" } },
      required: ["term"],
    },
  },
  {
    name: "get_organic_traffic",
    description: "מחזיר נתוני תנועה אורגנית מ-Google Search Console (קליקים, חשיפות, CTR, מיקום).",
    input_schema: {
      type: "object",
      properties: {
        term: { type: "string", description: "מילת המפתח. ריק = אגרגציה כללית" },
        days: { type: "integer", default: 30 },
      },
    },
  },
  {
    name: "get_top_keywords",
    description: "מחזיר את מילות המפתח המובילות של הלקוח לפי נפח חיפוש או קליקים.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "integer", default: 10 },
        sort_by: { type: "string", enum: ["searches", "clicks"], default: "searches" },
      },
    },
  },
  {
    name: "get_page_performance",
    description: "ביצועי עמוד ספציפי - קליקים, חשיפות, ומילות מפתח מובילות.",
    input_schema: {
      type: "object",
      properties: { url: { type: "string" }, days: { type: "integer", default: 30 } },
      required: ["url"],
    },
  },
  {
    name: "list_pages",
    description: "רשימת עמודי האתר של הלקוח שנסרקו.",
    input_schema: {
      type: "object",
      properties: { limit: { type: "integer", default: 50 } },
    },
  },
];

export async function runTool(
  sb: SupabaseClient,
  clientId: number,
  name: string,
  args: Record<string, any>,
): Promise<any> {
  switch (name) {
    case "get_keyword_stats": return getKeywordStats(sb, clientId, args.term || "");
    case "get_organic_traffic": return getOrganicTraffic(sb, clientId, args.term, args.days || 30);
    case "get_top_keywords": return getTopKeywords(sb, clientId, args.limit || 10, args.sort_by || "searches");
    case "get_page_performance": return getPagePerformance(sb, clientId, args.url || "", args.days || 30);
    case "list_pages": return listPages(sb, clientId, args.limit || 50);
    default: return { error: `כלי לא ידוע: ${name}` };
  }
}

async function getKeywordStats(sb: SupabaseClient, clientId: number, term: string) {
  const { data: kw } = await sb
    .from("keywords")
    .select("id, term, monthly_searches, competition, competition_index, position, history:monthly_searches(year, month, searches)")
    .eq("client_id", clientId)
    .ilike("term", `%${term}%`)
    .limit(1)
    .maybeSingle();
  if (!kw) return { found: false, message: `לא נמצאו נתונים למילה '${term}'.` };
  const history = ((kw as any).history || []).sort((a: any, b: any) => a.year - b.year || a.month - b.month);
  return {
    found: true,
    term: kw.term,
    monthly_searches_avg: kw.monthly_searches,
    competition: kw.competition,
    competition_index: kw.competition_index,
    position: kw.position,
    monthly_history: history,
  };
}

async function getOrganicTraffic(sb: SupabaseClient, clientId: number, term: string | undefined, _days: number) {
  let query = sb.from("gsc_metrics").select("clicks, impressions, position").eq("client_id", clientId);
  if (term) query = query.ilike("term", `%${term}%`);
  const { data } = await query;
  if (!data || data.length === 0) {
    return { found: false, message: "אין נתוני GSC ללקוח. צריך לחבר Google Search Console ולסנכרן." };
  }
  const clicks = data.reduce((s, r) => s + (r.clicks || 0), 0);
  const impressions = data.reduce((s, r) => s + (r.impressions || 0), 0);
  const avgPos = data.reduce((s, r) => s + (r.position || 0), 0) / data.length;
  return {
    found: true,
    term: term || null,
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    average_position: Math.round(avgPos * 100) / 100,
  };
}

async function getTopKeywords(sb: SupabaseClient, clientId: number, limit: number, sortBy: string) {
  if (sortBy === "clicks") {
    const { data } = await sb
      .from("gsc_metrics")
      .select("term, clicks, impressions")
      .eq("client_id", clientId)
      .not("term", "is", null);
    if (!data) return { sort_by: "clicks", results: [] };
    const agg = new Map<string, { clicks: number; impressions: number }>();
    for (const r of data) {
      const cur = agg.get(r.term) || { clicks: 0, impressions: 0 };
      cur.clicks += r.clicks || 0;
      cur.impressions += r.impressions || 0;
      agg.set(r.term, cur);
    }
    const results = [...agg.entries()]
      .map(([term, v]) => ({ term, ...v }))
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, limit);
    return { sort_by: "clicks", results };
  }
  const { data } = await sb
    .from("keywords")
    .select("term, monthly_searches, competition")
    .eq("client_id", clientId)
    .order("monthly_searches", { ascending: false })
    .limit(limit);
  return { sort_by: "searches", results: data || [] };
}

async function getPagePerformance(sb: SupabaseClient, clientId: number, url: string, _days: number) {
  const { data } = await sb
    .from("gsc_metrics")
    .select("term, clicks, impressions")
    .eq("client_id", clientId)
    .eq("page", url)
    .not("term", "is", null);
  if (!data || data.length === 0) return { found: false, url, message: "אין נתונים לעמוד הזה." };
  const agg = new Map<string, { clicks: number; impressions: number }>();
  for (const r of data) {
    const cur = agg.get(r.term) || { clicks: 0, impressions: 0 };
    cur.clicks += r.clicks || 0;
    cur.impressions += r.impressions || 0;
    agg.set(r.term, cur);
  }
  const top_queries = [...agg.entries()]
    .map(([term, v]) => ({ term, ...v }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 20);
  return { found: true, url, top_queries };
}

async function listPages(sb: SupabaseClient, clientId: number, limit: number) {
  const { data } = await sb
    .from("pages")
    .select("id, url, title, has_faq")
    .eq("client_id", clientId)
    .limit(limit);
  return { count: data?.length || 0, pages: data || [] };
}
