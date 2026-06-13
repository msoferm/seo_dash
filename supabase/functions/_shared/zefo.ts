/** ZEFO API helper. ZEFO auth: ?apiKey=... query param (account-wide key). */

const BASE = "https://api.zefo.com/v2";

function apiKey(): string {
  const k = Deno.env.get("ZEFO_API_KEY");
  if (!k) throw new Error("ZEFO_API_KEY לא הוגדר ב-Supabase secrets");
  return k;
}

async function zget(path: string, params: Record<string, string | number> = {}): Promise<any> {
  const url = new URL(BASE + path);
  url.searchParams.set("apiKey", apiKey());
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const r = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`ZEFO ${path} ${r.status}: ${body}`);
  }
  return await r.json();
}

export interface ZefoSite {
  id: number;
  domain: string;
  path: string | null;
  name: string | null;
  status: string;
  dstCountry?: string;
  lastFullRanks?: string;
  numWords?: number;
}

export interface ZefoKeyword {
  id: number;
  siteId: number;
  keyword: string;
  engine: { engine: string; isMobile: boolean };
  countryCode?: string;
  linkedPage?: string | null;
  rankpage?: string | null;
  ranking: number | null;
  previousRanking: number | null;
  initialRanking: number | null;
  initialRankingDate?: string | null;
  bestrank: number | null;
  bestrankdate?: string | null;
  localSearches: number | null;
  globalSearches: number | null;
  difficulty: number | null;
  numResults: number | null;
  richResults?: any;
  localSearchesHistory?: Array<{ month: string; searches: number }>;
  "(?bool)cannibalization"?: number;
}

export async function listSites(): Promise<ZefoSite[]> {
  return await zget("/sites", { limit: 200 });
}

export async function listKeywords(siteId: number, limit = 500): Promise<ZefoKeyword[]> {
  return await zget("/keywords", { siteId, limit });
}
