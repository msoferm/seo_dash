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
  {
    name: "get_analytics_traffic",
    description: "מחזיר נתוני Google Analytics 4 (תנועה אורגנית): סשנים, משתמשים, סשנים מעורבים, והמרות, עבור X הימים האחרונים.",
    input_schema: {
      type: "object",
      properties: { days: { type: "integer", default: 30 } },
    },
  },
  {
    name: "get_traffic_sources",
    description: "מחזיר את מקורות התנועה וההמרות מ-Google Analytics 4 (כל הערוצים) - לכל מקור: כמות ההמרות והסשנים. שימושי לשאלות 'מאיפה מגיעות ההמרות / התנועה'.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "integer", default: 10 },
        days: { type: "integer", default: 30 },
      },
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
    case "get_analytics_traffic": return getAnalyticsTraffic(sb, clientId, args.days || 30);
    case "get_traffic_sources": return getTrafficSources(sb, clientId, args.limit || 10, args.days || 30);
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

function ymdDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

async function getAnalyticsTraffic(sb: SupabaseClient, clientId: number, days: number) {
  const cutoff = ymdDaysAgo(days);
  const { data } = await sb
    .from("ga4_metrics")
    .select("sessions, total_users, engaged_sessions, conversions")
    .eq("client_id", clientId)
    .gte("date", cutoff);
  if (!data || data.length === 0) {
    return { found: false, message: "אין נתוני Google Analytics 4 ללקוח בטווח הזה. צריך לחבר GA4 ולסנכרן." };
  }
  const sessions = data.reduce((s, r) => s + (r.sessions || 0), 0);
  const users = data.reduce((s, r) => s + (r.total_users || 0), 0);
  const engaged = data.reduce((s, r) => s + (r.engaged_sessions || 0), 0);
  const conversions = data.reduce((s, r) => s + (Number(r.conversions) || 0), 0);
  return { found: true, days, sessions, users, engaged_sessions: engaged, conversions, note: "תנועה אורגנית בלבד" };
}

async function getTrafficSources(sb: SupabaseClient, clientId: number, limit: number, days: number) {
  const cutoff = ymdDaysAgo(days);
  const { data } = await sb
    .from("ga4_conversions")
    .select("source, channel, conversions, sessions, date")
    .eq("client_id", clientId);
  if (!data || data.length === 0) {
    return { found: false, message: "אין נתוני המרות מ-GA4. צריך לחבר Google Analytics 4 ולסנכרן." };
  }
  // include rows in range, plus undated legacy rows
  const inRange = data.filter((r: any) => !r.date || r.date >= cutoff);
  const agg = new Map<string, { conversions: number; sessions: number }>();
  for (const r of inRange) {
    const key = (r as any).source || (r as any).channel || "(ישיר)";
    const cur = agg.get(key) || { conversions: 0, sessions: 0 };
    cur.conversions += Number((r as any).conversions) || 0;
    cur.sessions += (r as any).sessions || 0;
    agg.set(key, cur);
  }
  const sources = [...agg.entries()]
    .map(([source, v]) => ({ source, conversions: Math.round(v.conversions * 100) / 100, sessions: v.sessions }))
    .sort((a, b) => b.conversions - a.conversions)
    .slice(0, limit);
  const total = Math.round(sources.reduce((s, x) => s + x.conversions, 0) * 100) / 100;
  return { found: true, days, total_conversions: total, sources };
}
