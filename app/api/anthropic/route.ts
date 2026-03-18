import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  console.log("API route hit, key present:", !!apiKey);
  if (!apiKey) {
    return NextResponse.json({ error: "OPENAI_API_KEY not set" }, { status: 500 });
  }

  const body = await req.json();

  // Translate Anthropic message format → OpenAI format
  const messages: { role: string; content: string | unknown[] }[] = [];

  if (body.system) {
    messages.push({ role: "system", content: body.system });
  }

  for (const msg of (body.messages || [])) {
    if (typeof msg.content === "string") {
      messages.push({ role: msg.role, content: msg.content });
    } else if (Array.isArray(msg.content)) {
      const content = msg.content.map((part: { type: string; text?: string; source?: { type: string; media_type: string; data: string } }) => {
        if (part.type === "text") {
          return { type: "text", text: part.text };
        } else if (part.type === "image" && part.source?.type === "base64") {
          return {
            type: "image_url",
            image_url: { url: `data:${part.source.media_type};base64,${part.source.data}` },
          };
        }
        return part;
      });
      messages.push({ role: msg.role, content });
    } else {
      messages.push(msg);
    }
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: body.max_tokens || 1000,
      messages,
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    console.error("OpenAI error:", JSON.stringify(data));
    return NextResponse.json({ error: data.error?.message || "OpenAI API error", detail: data }, { status: res.status });
  }

  // Translate OpenAI response → Anthropic format (so component needs no changes)
  const text = data.choices?.[0]?.message?.content || "";
  return NextResponse.json({ content: [{ type: "text", text }] });
}
