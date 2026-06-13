/**
 * POST { client_id: number }
 * Sync all ZEFO keywords for the client's linked ZEFO site into zefo_keywords.
 * Upserts by (client_id, zefo_keyword_id).
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";
import { listKeywords } from "../_shared/zefo.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const { client_id } = await req.json();
    const { data: client } = await sb.from("clients").select("id, zefo_site_id").eq("id", client_id).maybeSingle();
    if (!client) return errorResponse("לקוח לא נמצא", 404);
    if (!client.zefo_site_id) return errorResponse("הלקוח לא מקושר לאתר ZEFO", 400);

    const kws = await listKeywords(client.zefo_site_id, 1000);
    const now = new Date().toISOString();
    const rows = kws.map((k) => ({
      client_id,
      zefo_keyword_id: k.id,
      keyword: k.keyword,
      engine: k.engine?.engine,
      is_mobile: !!k.engine?.isMobile,
      country_code: k.countryCode || null,
      linked_page: k.linkedPage || null,
      rank_page: k.rankpage || null,
      ranking: k.ranking,
      previous_ranking: k.previousRanking,
      initial_ranking: k.initialRanking,
      initial_ranking_date: k.initialRankingDate || null,
      best_rank: k.bestrank,
      best_rank_date: k.bestrankdate || null,
      local_searches: k.localSearches,
      global_searches: k.globalSearches,
      difficulty: k.difficulty,
      num_results: k.numResults,
      cannibalization: (k as any)["(?bool)cannibalization"] ?? 0,
      rich_results: k.richResults || null,
      monthly_history: k.localSearchesHistory || [],
      last_synced: now,
    }));

    if (rows.length === 0) return jsonResponse({ synced: 0 });

    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const { error } = await sb.from("zefo_keywords").upsert(chunk, {
        onConflict: "client_id,zefo_keyword_id",
      });
      if (error) throw new Error(`upsert failed: ${error.message}`);
    }
    return jsonResponse({ synced: rows.length });
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
