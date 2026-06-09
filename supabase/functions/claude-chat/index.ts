/**
 * POST { client_id: number, session_id?: number, message: string }
 * Streams a multi-turn conversation with Claude, executing SEO data tools.
 * Persists the session in chat_sessions.
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";
import { callClaude, DEFAULT_MODEL, type Message } from "../_shared/anthropic.ts";
import { SEO_TOOLS, runTool } from "../_shared/claude_tools.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const body = await req.json();
    const { client_id, session_id, message } = body;
    if (!client_id || !message) return errorResponse("חסר client_id או message", 400);

    const { data: client } = await sb.from("clients").select("*").eq("id", client_id).maybeSingle();
    if (!client) return errorResponse("לקוח לא נמצא", 404);

    let session = session_id
      ? (await sb.from("chat_sessions").select("*").eq("id", session_id).maybeSingle()).data
      : null;

    const history: Message[] = (session?.messages_json || [])
      .filter((m: any) => typeof m.content === "string")
      .map((m: any) => ({ role: m.role, content: m.content }));

    const systemPrompt = [{
      type: "text" as const,
      text:
        "אתה אנליסט SEO מומחה שעוזר לנתח נתונים של לקוחות. ענה בעברית, תמציתי ומקצועי. " +
        "השתמש בכלים כדי לשלוף נתונים אמיתיים מה-DB - אל תמציא מספרים. " +
        "כשמשתמש שואל שאלה עם נתונים, תמיד תקרא לכלי המתאים קודם. " +
        "כשאתה מציג מספרים, הצג גם תובנה - מה זה אומר ומה כדאי לעשות.\n\n" +
        `לקוח נוכחי: ${client.name} (דומיין: ${client.domain}).`,
      cache_control: { type: "ephemeral" as const },
    }];

    const messages: Message[] = [...history, { role: "user", content: message }];
    const toolLog: any[] = [];

    let finalText = "";
    for (let iter = 0; iter < 5; iter++) {
      const resp = await callClaude({
        model: DEFAULT_MODEL,
        max_tokens: 2048,
        system: systemPrompt,
        tools: SEO_TOOLS,
        messages,
      });

      // Push assistant turn
      messages.push({ role: "assistant", content: resp.content });

      if (resp.stop_reason !== "tool_use") {
        finalText = resp.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("\n")
          .trim();
        break;
      }

      // Execute tool calls
      const toolResults: any[] = [];
      for (const block of resp.content) {
        if (block.type !== "tool_use") continue;
        const tu = block as any;
        const result = await runTool(sb, client_id, tu.name, tu.input || {});
        toolLog.push({ name: tu.name, input: tu.input, result_summary: JSON.stringify(result).slice(0, 200) });
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify(result),
        });
      }
      messages.push({ role: "user", content: toolResults });
    }

    if (!finalText) finalText = "לא הצלחתי להגיע לתשובה מלאה — נסה לפרט.";

    // Persist
    const newMsgs = [
      { role: "user", content: message },
      { role: "assistant", content: finalText, tool_calls: toolLog },
    ];
    if (!session) {
      const title = message.slice(0, 60) + (message.length > 60 ? "…" : "");
      const { data: created } = await sb
        .from("chat_sessions")
        .insert({ client_id, title, messages_json: newMsgs })
        .select()
        .single();
      session = created;
    } else {
      const merged = [...(session.messages_json || []), ...newMsgs];
      await sb.from("chat_sessions").update({ messages_json: merged }).eq("id", session.id);
    }

    return jsonResponse({ session_id: session!.id, reply: finalText, tool_calls: toolLog });
  } catch (e) {
    console.error(e);
    return errorResponse((e as Error).message, 500);
  }
});
