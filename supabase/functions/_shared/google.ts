/** Google OAuth + Search Console + Analytics helpers (Deno). */

export const SCOPES = [
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/analytics.readonly",
];

function getClientId() { return Deno.env.get("GOOGLE_CLIENT_ID") || ""; }
function getClientSecret() { return Deno.env.get("GOOGLE_CLIENT_SECRET") || ""; }
function getRedirectUri() { return Deno.env.get("GOOGLE_OAUTH_REDIRECT_URI") || ""; }

export function buildAuthUrl(state: string): string {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", getClientId());
  u.searchParams.set("redirect_uri", getRedirectUri());
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", SCOPES.join(" "));
  u.searchParams.set("state", state);
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("include_granted_scopes", "true");
  return u.toString();
}

export interface TokenSet {
  token: string;
  refresh_token?: string;
  expiry?: number;  // unix seconds
}

export async function exchangeCode(code: string): Promise<TokenSet> {
  const params = new URLSearchParams({
    code,
    client_id: getClientId(),
    client_secret: getClientSecret(),
    redirect_uri: getRedirectUri(),
    grant_type: "authorization_code",
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!r.ok) throw new Error(`Google token exchange failed: ${await r.text()}`);
  const data = await r.json();
  return {
    token: data.access_token,
    refresh_token: data.refresh_token,
    expiry: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
  };
}

async function refreshToken(refresh: string): Promise<TokenSet> {
  const params = new URLSearchParams({
    refresh_token: refresh,
    client_id: getClientId(),
    client_secret: getClientSecret(),
    grant_type: "refresh_token",
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!r.ok) throw new Error(`Google token refresh failed: ${await r.text()}`);
  const data = await r.json();
  return {
    token: data.access_token,
    refresh_token: refresh,
    expiry: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
  };
}

export async function getValidAccessToken(tokenJson: string): Promise<{ token: string; updatedJson: string }> {
  const ts: TokenSet = JSON.parse(tokenJson);
  const now = Math.floor(Date.now() / 1000);
  if (ts.expiry && ts.expiry > now + 60) {
    return { token: ts.token, updatedJson: tokenJson };
  }
  if (!ts.refresh_token) throw new Error("Token expired and no refresh_token available - reconnect Google");
  const fresh = await refreshToken(ts.refresh_token);
  return { token: fresh.token, updatedJson: JSON.stringify(fresh) };
}

export async function gscQuery(accessToken: string, siteUrl: string, days: number): Promise<any[]> {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - days);
  const body = {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    dimensions: ["query", "page", "date"],
    rowLimit: 1000,
  };
  const r = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!r.ok) throw new Error(`GSC API ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return (data.rows || []).map((row: any) => ({
    term: row.keys[0],
    page: row.keys[1],
    date: row.keys[2],
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: row.ctr,
    position: row.position,
  }));
}

export async function ga4Report(accessToken: string, propertyId: string, days: number): Promise<any> {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - days);
  const body = {
    dimensions: [{ name: "sessionSource" }, { name: "sessionMedium" }],
    metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "engagedSessions" }],
    dateRanges: [{ startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) }],
  };
  const r = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!r.ok) throw new Error(`GA4 API ${r.status}: ${await r.text()}`);
  return await r.json();
}
