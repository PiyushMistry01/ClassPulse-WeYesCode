const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const PRIMARY_MODEL = 'mistralai/mistral-7b-instruct';
const MODEL_CANDIDATES = [PRIMARY_MODEL, 'mistralai/mistral-7b-instruct:free', 'openrouter/auto'];

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'ClassPulse backend',
    endpoints: ['/health', '/extract-context', '/generate-quiz', '/validate-question'],
  });
});

function normalizeTopics(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const topics = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);

  return [...new Set(topics)].slice(0, 8);
}

function normalizeSummary(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().slice(0, 220);
}

function parseExtractContextPayload(raw) {
  const parsed = JSON.parse(raw);
  return {
    topics: normalizeTopics(parsed.topics),
    summary: normalizeSummary(parsed.summary),
  };
}

function normalizeQuestions(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .map((q) => q.replace(/^\d+[.)]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 5);
}

function parseQuizPayload(raw) {
  const parsed = JSON.parse(raw);
  return {
    questions: normalizeQuestions(parsed.questions),
  };
}

function parseValidationPayload(raw) {
  const parsed = JSON.parse(raw);
  return {
    isRelevant: typeof parsed?.isRelevant === 'boolean' ? parsed.isRelevant : null,
  };
}

function fallbackExtractContext() {
  return {
    topics: [],
    summary: '',
  };
}

function extractJsonFromText(text) {
  if (typeof text !== 'string') {
    throw new Error('AI response content is not a string');
  }

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON object found in AI response');
  }

  return jsonMatch[0];
}

async function callOpenRouterWithFallback({ apiKey, messages, temperature = 0 }) {
  let lastStatus = 0;
  let lastDetail = '';

  for (const model of MODEL_CANDIDATES) {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature,
        messages,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      return { data, model };
    }

    const detail = await response.text();
    lastStatus = response.status;
    lastDetail = detail;
    console.warn(`[openrouter] model ${model} failed:`, response.status, detail);

    // Retry on model-not-found scenarios, otherwise fail fast.
    if (response.status !== 404) {
      break;
    }
  }

  throw new Error(`OpenRouter request failed (${lastStatus}): ${lastDetail}`);
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/extract-context', async (req, res) => {
  console.log('Incoming:', req.body);

  const contextRaw = typeof req.body?.contextRaw === 'string' ? req.body.contextRaw.trim() : '';

  if (!contextRaw) {
    return res.status(400).json({ error: 'contextRaw is required' });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('[backend/extract-context] OPENROUTER_API_KEY is missing');
    return res.json(fallbackExtractContext());
  }

  console.log('[backend/extract-context] Request received:', {
    contextLength: contextRaw.length,
    preview: contextRaw.slice(0, 80),
  });

  try {
    const messages = [
      {
        role: 'user',
        content: `Extract structured teaching context.

Return ONLY valid JSON:
{
  "topics": ["..."],
  "summary": "..."
}

Text:
${contextRaw}`,
      },
    ];

    const { data, model } = await callOpenRouterWithFallback({ apiKey, messages, temperature: 0.2 });
    console.log(JSON.stringify(data, null, 2));
    console.log('[backend/extract-context] Model used:', model);
    const content = data?.choices?.[0]?.message?.content;

    if (!content) {
      console.warn('[backend/extract-context] OpenRouter returned empty content');
      return res.json(fallbackExtractContext());
    }

    try {
      const jsonText = extractJsonFromText(content);
      const parsed = parseExtractContextPayload(jsonText);
      console.log('AI Response:', parsed);
      return res.json(parsed);
    } catch (parseError) {
      console.error('[backend/extract-context] JSON parse failure:', parseError);
      return res.json(fallbackExtractContext());
    }
  } catch (err) {
    console.error('[backend/extract-context] ERROR:', err);
    return res.json(fallbackExtractContext());
  }
});

app.post('/generate-quiz', async (req, res) => {
  const contextRaw = typeof req.body?.contextRaw === 'string' ? req.body.contextRaw.trim() : '';
  const contextSummary = typeof req.body?.contextSummary === 'string' ? req.body.contextSummary.trim() : '';
  const contextPurpose = typeof req.body?.contextPurpose === 'string' ? req.body.contextPurpose.trim() : '';
  const contextTopics = Array.isArray(req.body?.contextTopics)
    ? req.body.contextTopics.filter((item) => typeof item === 'string').slice(0, 12)
    : [];

  if (!contextRaw && !contextSummary && !contextTopics.length) {
    return res.status(400).json({ error: 'Missing context for quiz generation' });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('[backend/generate-quiz] OPENROUTER_API_KEY is missing');
    return res.status(500).json({ error: 'OPENROUTER_API_KEY missing', questions: [] });
  }

  try {
    const messages = [
      {
        role: 'user',
        content: `Create a classroom quiz of exactly 5 questions.

Return ONLY valid JSON in this exact format:
{
  "questions": ["...", "...", "...", "...", "..."]
}

Rules:
- Questions should match the faculty context.
- Keep wording clear for students.
- Mix conceptual and application-style questions.
- Do not include answers.
- Keep each question concise.

Context Summary:
${contextSummary}

Context Purpose:
${contextPurpose}

Topics:
${contextTopics.join(', ')}

Raw Context:
${contextRaw}`,
      },
    ];

    const { data, model } = await callOpenRouterWithFallback({ apiKey, messages, temperature: 0.3 });
    console.log(JSON.stringify(data, null, 2));
    console.log('[backend/generate-quiz] Model used:', model);
    const content = data?.choices?.[0]?.message?.content;

    if (!content) {
      console.warn('[backend/generate-quiz] OpenRouter returned empty content');
      return res.status(502).json({ error: 'OpenRouter returned empty content', questions: [] });
    }

    try {
      const jsonText = extractJsonFromText(content);
      const parsed = parseQuizPayload(jsonText);
      console.log('AI Response:', parsed);

      if (!parsed.questions.length) {
        return res.status(502).json({ error: 'No quiz questions generated', questions: [] });
      }

      console.log('[backend/generate-quiz] Success:', { count: parsed.questions.length });
      return res.json(parsed);
    } catch (parseError) {
      console.error('[backend/generate-quiz] JSON parse failure:', parseError);
      return res.status(502).json({ error: 'Invalid OpenRouter JSON payload', questions: [] });
    }
  } catch (error) {
    console.error('[backend/generate-quiz] ERROR:', error);
    return res.status(500).json({ error: 'Internal server error', questions: [] });
  }
});

app.post('/validate-question', async (req, res) => {
  console.log('Incoming:', req.body);

  const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
  const contextSummary = typeof req.body?.contextSummary === 'string' ? req.body.contextSummary.trim() : '';
  const contextTopics = Array.isArray(req.body?.contextTopics)
    ? req.body.contextTopics.filter((item) => typeof item === 'string').slice(0, 12)
    : [];

  if (!question) {
    return res.json({ isRelevant: null, error: true });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('[backend/validate-question] OPENROUTER_API_KEY is missing');
    return res.json({ isRelevant: null, error: true });
  }

  const prompt = `You are checking if a student question is relevant to a classroom session.

Context:
${contextSummary}
Topics: ${contextTopics.join(', ')}

Question:
"${question}"

Rules:
- Allow if question is related to topic (even loosely)
- Allow genuine doubts
- Reject spam, jokes, unrelated questions
- Be lenient

Return ONLY JSON:
{
  "isRelevant": true or false
}`;

  try {
    const { data, model } = await callOpenRouterWithFallback({
      apiKey,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
    });
    console.log(JSON.stringify(data, null, 2));
    console.log('[backend/validate-question] Model used:', model);
    const content = data?.choices?.[0]?.message?.content;

    if (!content) {
      return res.json({ isRelevant: null, error: true });
    }

    try {
      const jsonText = extractJsonFromText(content);
      const parsed = parseValidationPayload(jsonText);
      console.log('AI Response:', parsed);
      return res.json(parsed);
    } catch (parseError) {
      console.error('[backend/validate-question] JSON parse failure:', parseError);
      return res.json({ isRelevant: null, error: true });
    }
  } catch (error) {
    console.error('[backend/validate-question] ERROR:', error);
    return res.json({ isRelevant: null, error: true });
  }
});

app.listen(PORT, () => {
  console.log(`[backend] Server listening on http://0.0.0.0:${PORT}`);
});
