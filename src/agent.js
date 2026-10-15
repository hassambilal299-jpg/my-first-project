// Claude agent loop: send the conversation, run any tool calls, repeat until
// Claude gives a final answer.

const API_URL = "https://api.anthropic.com/v1/messages";
const MAX_TOOL_ROUNDS = 6;

export const SYSTEM_PROMPT = `You are Jarvis, a personal operations assistant for a freelancer or small agency.
You help the user manage email, SMS (GoHighLevel), social media posts, and Shopify orders.
Rules:
- Reading is free: check email, orders, and approvals whenever it helps.
- You never send messages or publish posts directly. You propose them with the propose_* tools, and the user approves them.
- Keep spoken answers short and plain. The user may be hearing your reply through text-to-speech, so avoid markdown, bullet symbols, and long lists.
- If a tool reports mock mode or an error, say so plainly instead of pretending it worked.`;

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
