/** Minimal Anthropic Messages API wrapper for Deno. */

const API_URL = "https://api.anthropic.com/v1/messages";
const VERSION = "2023-06-01";

export type ContentBlock =
  | { type: "text"; text: string; cache_control?: { type: "ephemeral" } }
  | { type: "tool_use"; id: string; name: string; input: any }
  | { type: "tool_result"; tool_use_id: string; content: string };

export interface Message {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: any;
}

export interface MessagesRequest {
  model: string;
  max_tokens: number;
  system?: string | ContentBlock[];
  messages: Message[];
  tools?: ToolDefinition[];
}

export interface MessagesResponse {
  id: string;
  content: ContentBlock[];
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
}

export async function callClaude(req: MessagesRequest): Promise<MessagesResponse> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY לא הוגדר ב-Supabase secrets");
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${errBody}`);
  }
  return await res.json();
}

export const DEFAULT_MODEL = Deno.env.get("CLAUDE_MODEL") || "claude-sonnet-4-6";

/** Web search + web fetch server tools (Claude runs them on Anthropic's side).
 *  Budgets kept modest so a single agent run stays under the 150s edge-function limit. */
// Basic variants (no code-exec dynamic filtering) — much faster, which matters for the
// 150s edge-function limit.
export const WEB_TOOLS = [
  { type: "web_search_20250305", name: "web_search", max_uses: 3 },
];

export interface AgentRequest {
  model: string;
  max_tokens: number;
  system?: string;
  messages: Message[];
  tools?: any[];
}

/**
 * Call Claude with server tools (e.g. web search) and follow the internal loop:
 * on `pause_turn` we resend the accumulated assistant content until the turn ends.
 * Server tools execute on Anthropic's side, so there's no client tool execution here.
 */
export async function callClaudeAgent(req: AgentRequest, maxRounds = 8): Promise<MessagesResponse> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY לא הוגדר ב-Supabase secrets");
  const messages: Message[] = [...req.messages];
  let last: MessagesResponse | null = null;
  for (let round = 0; round < maxRounds; round++) {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": VERSION, "content-type": "application/json" },
      // thinking disabled — these are search+extract tasks; disabling it cuts latency a lot.
      body: JSON.stringify({ model: req.model, max_tokens: req.max_tokens, system: req.system, messages, tools: req.tools, thinking: { type: "disabled" } }),
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
    last = await res.json();
    if (last!.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: last!.content });
      continue;
    }
    break;
  }
  return last!;
}

/** Concatenate all text blocks from a response. */
export function textOf(resp: MessagesResponse): string {
  return (resp.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
}

/** Extract the last balanced JSON object/array from free text (tolerates web-search prose). */
export function extractJson(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates: string[] = [];
  if (fenced) candidates.push(fenced[1]);
  // last {...} or [...] block
  const objStart = text.lastIndexOf("{");
  const arrStart = text.lastIndexOf("[");
  const start = Math.max(objStart, arrStart);
  if (start >= 0) candidates.push(text.slice(start));
  candidates.push(text);
  for (const c of candidates) {
    try { return JSON.parse(c.trim()); } catch { /* try next */ }
    // try trimming to first balanced brace
    const open = c.indexOf("{") >= 0 ? "{" : "[";
    const close = open === "{" ? "}" : "]";
    const s = c.indexOf(open);
    const e = c.lastIndexOf(close);
    if (s >= 0 && e > s) {
      try { return JSON.parse(c.slice(s, e + 1)); } catch { /* next */ }
    }
  }
  throw new Error("no valid JSON found in response");
}
