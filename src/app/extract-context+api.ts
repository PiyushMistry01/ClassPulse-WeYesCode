type ExtractContextResponse = {
  topics: string[];
  summary: string;
};

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

function normalizeTopics(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const topics = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);

  return [...new Set(topics)].slice(0, 8);
}

function normalizeSummary(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().slice(0, 220);
}

function parseJsonPayload(raw: string): ExtractContextResponse {
  const parsed = JSON.parse(raw) as { topics?: unknown; summary?: unknown };

  return {
    topics: normalizeTopics(parsed.topics),
    summary: normalizeSummary(parsed.summary),
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { contextRaw?: unknown };
    const contextRaw = typeof body.contextRaw === 'string' ? body.contextRaw.trim() : '';

    if (!contextRaw) {
      return Response.json(
        { error: 'contextRaw is required' },
        { status: 400 }
      );
    }

    const apiKey = process.env.OPENAI_API_KEY || process.env.EXPO_PUBLIC_OPENAI_API_KEY;
    if (!apiKey) {
      return Response.json(
        { error: 'Missing OPENAI_API_KEY' },
        { status: 500 }
      );
    }

    const prompt = `Extract structured teaching context.

Return ONLY valid JSON in this format:
{
  "topics": ["..."],
  "summary": "..."
}

Text:
${contextRaw}`;

    const openAiRes = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!openAiRes.ok) {
      const detail = await openAiRes.text();
      return Response.json(
        { error: `OpenAI request failed: ${detail}` },
        { status: 502 }
      );
    }

    const openAiData = (await openAiRes.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };

    const rawContent = openAiData.choices?.[0]?.message?.content;
    if (!rawContent) {
      return Response.json({ topics: [], summary: '' });
    }

    let payload: ExtractContextResponse;
    try {
      payload = parseJsonPayload(rawContent);
    } catch {
      const firstBrace = rawContent.indexOf('{');
      const lastBrace = rawContent.lastIndexOf('}');
      if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
        return Response.json(
          { error: 'Invalid AI JSON payload' },
          { status: 502 }
        );
      }

      payload = parseJsonPayload(rawContent.slice(firstBrace, lastBrace + 1));
    }

    return Response.json(payload);
  } catch (error) {
    console.error('extract-context API error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}