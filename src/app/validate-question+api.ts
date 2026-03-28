type ValidateQuestionResponse = {
  isRelevant: boolean;
};

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 12);
}

function parseValidation(raw: string): ValidateQuestionResponse {
  const parsed = JSON.parse(raw) as { isRelevant?: unknown };
  return { isRelevant: parsed.isRelevant === true };
}

export async function POST(request: Request) {
  try {
    console.log('[validate-question API] 🔵 Request received');
    const body = (await request.json()) as {
      question?: unknown;
      contextRaw?: unknown;
      contextTopics?: unknown;
      contextSummary?: unknown;
    };

    const question = typeof body.question === 'string' ? body.question.trim() : '';
    const contextRaw = typeof body.contextRaw === 'string' ? body.contextRaw.trim() : '';
    const contextSummary =
      typeof body.contextSummary === 'string' ? body.contextSummary.trim() : contextRaw;
    const contextTopics = toStringArray(body.contextTopics);

    console.log('[validate-question API] 📋 Parsed input:', {
      questionLen: question.length,
      contextRawLen: contextRaw.length,
      contextSummaryLen: contextSummary.length,
      topicsCount: contextTopics.length,
    });

    if (!question) {
      console.warn('[validate-question API] ⚠️ Empty question');
      return Response.json({ isRelevant: false }, { status: 200 });
    }

    const apiKey = process.env.OPENAI_API_KEY || process.env.EXPO_PUBLIC_OPENAI_API_KEY;
    if (!apiKey) {
      console.error('[validate-question] CRITICAL: OPENAI_API_KEY is not set');
      return Response.json({ isRelevant: false }, { status: 200 });
    }

    const prompt = `You are checking if a student question is relevant to a classroom session.

Context:
${contextSummary}
Topics: ${contextTopics.join(', ')}

Question:
"${question}"

Rules:
- Allow if question is related to the topic, even loosely
- Allow if it is a genuine doubt
- Reject if it is spam, joke, personal, or unrelated
- Be lenient, not strict

Return ONLY JSON:
{
  "isRelevant": true or false
}`;

    const openAiRes = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!openAiRes.ok) {
      const detail = await openAiRes.text();
      console.error('OpenAI API error:', openAiRes.status, detail);
      return Response.json({ isRelevant: false }, { status: 200 });
    }

    const openAiData = (await openAiRes.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };

    const raw = openAiData.choices?.[0]?.message?.content;
    console.log('[validate-question API] 🤖 OpenAI raw response:', raw);
    
    if (!raw) {
      console.warn('No content from OpenAI response');
      return Response.json({ isRelevant: false }, { status: 200 });
    }

    try {
      const result = parseValidation(raw);
      console.log('Question validation result:', result);
      return Response.json(result);
    } catch (parseErr) {
      console.warn('Failed to parse validation response:', parseErr, 'raw:', raw);
      const firstBrace = raw.indexOf('{');
      const lastBrace = raw.lastIndexOf('}');
      if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
        console.warn('No valid JSON found in OpenAI response');
        return Response.json({ isRelevant: false });
      }

      try {
        return Response.json(parseValidation(raw.slice(firstBrace, lastBrace + 1)));
      } catch {
        console.warn('Final parse attempt failed');
        return Response.json({ isRelevant: false });
      }
    }
  } catch (error) {
    console.error('validate-question API error:', error);
    return Response.json({ isRelevant: false }, { status: 200 });
  }
}