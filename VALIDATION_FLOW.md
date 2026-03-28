# Question AI Validation Flow

## Summary of Changes

The question submission flow now enforces strict AI validation **before** saving to Firebase.

## Data Flow

```
Student submits question
        ↓
[Client] Check if contextRaw exists (CRITICAL REQUIREMENT)
        ↓ (YES)
[Client] Fetch /validate-question API with question + context
        ↓
[Server] Log: "🔵 Request received"
        ↓
[Server] Validate question is not empty
        ↓
[Server] Log: "📋 Parsed input"
        ↓
[Server] Check API key exists
        ↓
[Server] Call OpenAI with lenient prompt
        ↓
[Server] Log: "🤖 OpenAI raw response: ..."
        ↓
[Server] Parse response → { isRelevant: true/false }
        ↓
[Server] Return to client with HTTP 200 (always)
        ↓
[Client] Parse JSON response
        ↓
├─ if (isRelevant === true)
│  └─ Log: "✅ APPROVED" → Save to Firestore
│
├─ else if (isRelevant === false)
│  └─ Log: "❌ REJECTED" → Block (no save)
│
└─ else (null/undefined)
   └─ Log: "⚠️ UNKNOWN; fallback: ALLOW" → Save to Firestore
```

## Key Checks (3-point validation)

### 1. **Context is mandatory**
- `contextRaw` must exist at runtime (set from session snapshot)
- If missing: question is blocked

### 2. **API response must be explicit**
- `isRelevant === true` → **SAVE** question
- `isRelevant === false` → **BLOCK** question
- Anything else → fallback (**ALLOW** to avoid AI errors)

### 3. **All API paths return HTTP 200**
- Errors return `{ isRelevant: false }` with status 200
- Client always receives valid JSON to process

## Console Logging (for debugging)

### Client logs to watch for:
```
[Question Validation] START: Question validation
[Question Validation] API Response Status: 200
[Question Validation] API Response Data: { isRelevant: true/false }
[Question Validation] ✅ APPROVED (isRelevant === true); saving to Firestore
[Question Validation] ❌ REJECTED (isRelevant === false); NOT saving
[Question Validation] ⚠️ UNKNOWN (isRelevant not boolean); fallback: ALLOW (lenient)
```

### Server logs to watch for:
```
[validate-question API] 🔵 Request received
[validate-question API] 📋 Parsed input: { questionLen, contextRawLen, ... }
[validate-question API] 🤖 OpenAI raw response: { "isRelevant": true/false }
```

## Test Scenarios

### ✅ Should SAVE (relevant question)
- Question: "What is the difference between pointers and arrays?"
- Context: "Today I will explain pointers, memory and arrays"
- Expected: isRelevant → true → **SAVES**
- Console: "✅ APPROVED"

### ❌ Should BLOCK (irrelevant question)
- Question: "What's your favorite color?"
- Context: "Today I will explain pointers, memory and arrays"
- Expected: isRelevant → false → **BLOCKS**
- Console: "❌ REJECTED"

### ⚠️ Fallback on error
- API fails / returns null
- Expected: fallback logic → **ALLOWS** (logs warning)
- Console: "⚠️ UNKNOWN; fallback: ALLOW"

## Environment Setup

Ensure `.env` contains:
```
OPENAI_API_KEY=your_valid_api_key_here
```

Without this, all questions fall back to **ALLOW** (lenient).

## Debugging Steps

1. **Open Browser DevTools** → Console tab
2. **Type a question** on student page
3. **Watch logs** for the flow above
4. **Check Firestore** `sessions/<id>/questions` collection
5. **Verify** only relevant questions appear

---

If questions still appear that shouldn't: check DevTools console for errors in the validation chain.
