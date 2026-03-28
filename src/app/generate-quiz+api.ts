type GenerateQuizResponse = {
  questions: string[];
};

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

function normalizeQuestions(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const cleaned = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .map((q) => q.replace(/^\d+[.)]\s*/, '').trim())
    .filter(Boolean);

  return cleaned.slice(0, 5);
}

function parseQuizPayload(raw: string): GenerateQuizResponse {
  const parsed = JSON.parse(raw) as { questions?: unknown };
  return {
    questions: normalizeQuestions(parsed.questions),
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      contextRaw?: unknown;
      contextTopics?: unknown;
      contextSummary?: unknown;
      contextPurpose?: unknown;
    };

    const contextRaw = typeof body.contextRaw === 'string' ? body.contextRaw.trim() : '';
    const contextSummary = typeof body.contextSummary === 'string' ? body.contextSummary.trim() : '';
    const contextPurpose = typeof body.contextPurpose === 'string' ? body.contextPurpose.trim() : '';
    const contextTopics = Array.isArray(body.contextTopics)
      ? body.contextTopics.filter((item): item is string => typeof item === 'string').slice(0, 12)
      : [];

    if (!contextRaw && !contextSummary && !contextTopics.length) {
      return Response.json({ error: 'Missing context for quiz generation' }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY || process.env.EXPO_PUBLIC_OPENAI_API_KEY;
    if (!apiKey) {
      console.error('[generate-quiz] CRITICAL: OPENAI_API_KEY is not set');
      return Response.json({ error: 'Missing OPENAI_API_KEY' }, { status: 500 });
    }

    console.log('[generate-quiz] 🔵 Starting quiz generation with context topics:', contextTopics.length);

    const prompt = `You are an expert teacher creating classroom assessment quiz.

Create a classroom quiz of exactly 5 questions based on the class context.

Return ONLY valid JSON in this exact format:
{
  "questions": ["...", "...", "...", "...", "..."]
}

Rules:
- Questions MUST be based on course content and topics provided
- Questions should match the faculty context exactly
- Keep wording clear and appropriate for students
- Mix conceptual and application-style questions
- Do not include answers
- Keep each question concise (1-2 sentences max)
- Ensure all questions are directly related to the provided topics

Context Summary:
${contextSummary}

Context Purpose:
${contextPurpose}

Topics:
${contextTopics.join(', ')}

Raw Context:
${contextRaw}`;

    const response = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error('[generate-quiz] OpenAI API error:', response.status, detail);
      return Response.json({ error: `OpenAI request failed: ${detail}` }, { status: 502 });
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      console.warn('[generate-quiz] ⚠️ No content from OpenAI response');
      return Response.json({ questions: [] });
    }

    let payload: GenerateQuizResponse;
    try {
      payload = parseQuizPayload(content);
    } catch {
      const firstBrace = content.indexOf('{');
      const lastBrace = content.lastIndexOf('}');
      if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
        console.error('[generate-quiz] Invalid JSON in OpenAI response');
        return Response.json({ error: 'Invalid AI JSON payload' }, { status: 502 });
      }

      payload = parseQuizPayload(content.slice(firstBrace, lastBrace + 1));
    }

    console.log('[generate-quiz] ✅ Generated questions:', payload.questions);
    return Response.json(payload);
  } catch (error) {
    console.error('[generate-quiz] API error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}