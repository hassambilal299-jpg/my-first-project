// Claude agent loop: send the conversation, run any tool calls, repeat until
// Claude gives a final answer.

const API_URL = "https://api.anthropic.com/v1/messages";
const MAX_TOOL_ROUNDS = 6;

export const SYSTEM_PROMPT = `You are Jarvis, the operations assistant for a freelancer or agency that runs
several client businesses.

What you can do:
- Give a brief on any business: what happened, what changed, what needs attention. Use business_brief.
- Run sync_business first when the user wants the very latest, since the brief reads recorded events.
- Read email and Shopify orders, and record notes about calls or decisions.
- Draft SMS and social posts.

Rules:
- Reading is free. Check things whenever it helps answer the question.
- You never send messages or publish posts directly. You draft them with the propose_* tools, and the user approves them.
- Keep spoken answers short and plain. The user may hear your reply through text-to-speech, so avoid markdown, bullet symbols, and long lists. When a brief tool returns a "spoken" field, say that, then offer detail if they want it.
- If a tool reports mock mode, an error, or that nothing is connected, say so plainly instead of inventing activity. Never make up events, orders, or messages.
- When the user names a business you do not recognise, say which ones you do have.`

export function createAgent({ apiKey, model, tools, fetchImpl = fetch }) {
  async function callClaude(messages) {
    const res = await fetchImpl(API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools: tools.schemas,
        messages,
        // Caches the stable system + tool prefix, which is most of each
        // request, so repeat turns bill a fraction of the first.
        cache_control: { type: "ephemeral" },
        // Chat and brief narration do not need deep reasoning; low effort
        // keeps token spend down.
        output_config: { effort: "low" },
      }),
    });
    if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);
    return res.json();
  }

  // history: array of {role, content} messages from earlier turns (text only)
  async function respond(history, userText) {
    const messages = [...history, { role: "user", content: userText }];
    const toolsUsed = [];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await callClaude(messages);
      messages.push({ role: "assistant", content: response.content });

      if (response.stop_reason !== "tool_use") {
        const text = response.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        return { text, toolsUsed, messages };
      }

      const toolResults = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        toolsUsed.push(block.name);
        const result = await tools.call(block.name, block.input);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }
      messages.push({ role: "user", content: toolResults });
    }

    return {
      text: "I hit my step limit on that request. Try asking in a smaller piece.",
      toolsUsed,
      messages,
    };
  }

  return { respond };
}
