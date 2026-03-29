type GenerateQuizResponse = {
  questions: string[];
};

type McqQuestion = {
  question: string;
  options: string[];
  correctAnswer: string;
};

type GenerateMcqQuizResponse = {
  questions: McqQuestion[];
};

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = 'openrouter/auto';

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

function normalizeMcqQuestion(value: unknown): McqQuestion | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as { question?: unknown; options?: unknown; correctAnswer?: unknown };
  const question = typeof candidate.question === 'string' ? candidate.question.trim() : '';
  const options = Array.isArray(candidate.options)
    ? candidate.options
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
        .slice(0, 4)
    : [];
  const correctAnswer = typeof candidate.correctAnswer === 'string' ? candidate.correctAnswer.trim() : '';
  const matchedCorrectAnswer = options.find((option) => option === correctAnswer);

  if (!question || options.length !== 4 || !matchedCorrectAnswer) {
    return null;
  }

  return {
    question,
    options,
    correctAnswer: matchedCorrectAnswer,
  };
}

function parseMcqQuizPayload(raw: string): GenerateMcqQuizResponse {
  const parsed = JSON.parse(raw) as unknown;
  const source = Array.isArray(parsed)
    ? parsed
    : (parsed as { questions?: unknown }).questions;

  if (!Array.isArray(source)) {
    return { questions: [] };
  }

  return {
    questions: source
      .map((item) => normalizeMcqQuestion(item))
      .filter((item): item is McqQuestion => item !== null)
      .slice(0, 5),
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      contextRaw?: unknown;
      contextTopics?: unknown;
      contextSummary?: unknown;
      contextPurpose?: unknown;
      responseFormat?: unknown;
    };

    const contextRaw = typeof body.contextRaw === 'string' ? body.contextRaw.trim() : '';
    const contextSummary = typeof body.contextSummary === 'string' ? body.contextSummary.trim() : '';
    const contextPurpose = typeof body.contextPurpose === 'string' ? body.contextPurpose.trim() : '';
    const responseFormat = body.responseFormat === 'mcq' ? 'mcq' : 'questions';
    const contextTopics = Array.isArray(body.contextTopics)
      ? body.contextTopics.filter((item): item is string => typeof item === 'string').slice(0, 12)
      : [];

    if (!contextRaw && !contextSummary && !contextTopics.length) {
      return Response.json({ error: 'Missing context for quiz generation' }, { status: 400 });
    }

    const apiKey = process.env.OPENROUTER_API_KEY || process.env.EXPO_PUBLIC_OPENROUTER_API_KEY;
    if (!apiKey) {
      console.error('[generate-quiz] CRITICAL: OPENROUTER_API_KEY is not set');
      return Response.json({ error: 'Missing OPENROUTER_API_KEY' }, { status: 500 });
    }

    console.log('[generate-quiz] 🔵 Starting quiz generation with context topics:', contextTopics.length);

    const prompt = responseFormat === 'mcq'
      ? `Generate 5 MCQs based on the teaching context.

Context:
${contextSummary || contextRaw}
Topics: ${contextTopics.join(', ')}

Return JSON:
[
  {
    "question": "...",
    "options": ["A", "B", "C", "D"],
    "correctAnswer": "..."
  }
]

Rules:
- Return exactly 5 objects
- Each question must have exactly 4 options
- Each question must have exactly 1 correct answer
- The correctAnswer value must match one option exactly
- Keep wording clear for students
- Use only the teaching context and listed topics`
      : `You are an expert teacher creating classroom assessment quiz.

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

    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://classpulse-97289.web.app',
        'X-Title': 'ClassPulse',
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        temperature: 0.3,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error('[generate-quiz] OpenRouter API error:', response.status, detail);
      return Response.json({ error: `OpenRouter request failed: ${detail}` }, { status: 502 });
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      console.warn('[generate-quiz] ⚠️ No content from OpenRouter response');
      return Response.json({ questions: [] });
    }

    let payload: GenerateQuizResponse | GenerateMcqQuizResponse;
    try {
      payload = responseFormat === 'mcq' ? parseMcqQuizPayload(content) : parseQuizPayload(content);
    } catch {
      const firstBrace = content.indexOf('{');
      const lastBrace = content.lastIndexOf('}');
      const firstBracket = content.indexOf('[');
      const lastBracket = content.lastIndexOf(']');

      if (
        responseFormat === 'mcq'
          ? firstBracket === -1 || lastBracket === -1 || lastBracket <= firstBracket
          : firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace
      ) {
        console.error('[generate-quiz] Invalid JSON in OpenRouter response');
        return Response.json({ error: 'Invalid AI JSON payload' }, { status: 502 });
      }

      payload = responseFormat === 'mcq'
        ? parseMcqQuizPayload(content.slice(firstBracket, lastBracket + 1))
        : parseQuizPayload(content.slice(firstBrace, lastBrace + 1));
    }

    console.log('[generate-quiz] ✅ Generated questions:', payload.questions);
    return Response.json(payload);
  } catch (error) {
    console.error('[generate-quiz] API error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
