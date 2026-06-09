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
