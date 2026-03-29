type ValidateQuestionResponse = {
  isRelevant: boolean;
};

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = 'openrouter/auto';

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

    const apiKey = process.env.OPENROUTER_API_KEY || process.env.EXPO_PUBLIC_OPENROUTER_API_KEY;
    if (!apiKey) {
      console.error('[validate-question] CRITICAL: OPENROUTER_API_KEY is not set');
      return Response.json({ isRelevant: false }, { status: 200 });
    }

    const prompt = `You are a classroom question validator. Your job is to determine if a student comment/question is relevant and contextual to the class content.

Class Context Summary:
${contextSummary}

Class Topics:
${contextTopics.join(', ')}

Full Class Context:
${contextRaw}

Student Question/Comment:
"${question}"

Validation Rules:
1. REJECT (isRelevant: false) if:
   - The question is spam, off-topic, or jokes
   - It's purely personal (not related to class content)
   - It's advertising, promotional, or harmful
   - It's unrelated to ANY of the listed topics
   - It's gibberish or nonsensical

2. ALLOW (isRelevant: true) if:
   - Question relates to ANY of the topics covered
   - It's a genuine doubt about the course material
   - It's asking for clarification on content
   - It's a follow-up question related to the lesson
   - It's contextually relevant even if asked in different words

Be STRICT about rejecting off-topic content. Only allow questions that are clearly related to the classroom context.

Return ONLY valid JSON (no other text):
{
  "isRelevant": true or false
}`;

    const openAiRes = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://classpulse-97289.web.app',
        'X-Title': 'ClassPulse',
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!openAiRes.ok) {
      const detail = await openAiRes.text();
      console.error('OpenRouter API error:', openAiRes.status, detail);
      return Response.json({ isRelevant: false }, { status: 200 });
    }

    const openAiData = (await openAiRes.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };

    const raw = openAiData.choices?.[0]?.message?.content;
    console.log('[validate-question API] 🤖 OpenRouter raw response:', raw);
    
    if (!raw) {
      console.warn('No content from OpenRouter response');
      return Response.json({ isRelevant: false }, { status: 200 });
    }

    try {
      const result = parseValidation(raw);
      const verdict = result.isRelevant ? '✅ APPROVED' : '❌ REJECTED';
      console.log(`[validate-question API] ${verdict} | Question: "${question.substring(0, 50)}..."`);
      return Response.json(result);
    } catch (parseErr) {
      console.warn('[validate-question API] ⚠️ Failed to parse validation response:', parseErr, 'raw:', raw);
      const firstBrace = raw.indexOf('{');
      const lastBrace = raw.lastIndexOf('}');
      if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
        console.warn('[validate-question API] ❌ No valid JSON found in OpenRouter response');
        return Response.json({ isRelevant: false });
      }

      try {
        const result = parseValidation(raw.slice(firstBrace, lastBrace + 1));
        const verdict = result.isRelevant ? '✅ APPROVED' : '❌ REJECTED';
        console.log(`[validate-question API] ${verdict} (from retry) | Question: "${question.substring(0, 50)}..."`);
        return Response.json(result);
      } catch {
        console.warn('[validate-question API] Final parse attempt failed');
        return Response.json({ isRelevant: false });
      }
    }
  } catch (error) {
    console.error('validate-question API error:', error);
    return Response.json({ isRelevant: false }, { status: 200 });
  }
}