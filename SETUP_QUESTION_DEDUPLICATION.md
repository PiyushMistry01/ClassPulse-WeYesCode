# 🚀 Quick Setup Guide - Question Deduplication Feature

## Prerequisites

Your project needs:
- Node.js server running (`server.js`)
- Firestore database configured
- Firebase Admin SDK

## Step 1: Install Dependencies

```bash
npm install firebase-admin
```

## Step 2: Configure Environment Variables

Add to your `.env` file (or set in deployment):

```env
# Required for question deduplication
FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account","project_id":"classpulse-97289","private_key_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...","client_email":"firebase-adminsdk@...","client_id":"...","auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://oauth2.googleapis.com/token","auth_provider_x509_cert_url":"https://www.googleapis.com/oauth2/v1/certs","client_x509_cert_url":"..."}'

# Optional: AI filtering of off-topic questions
ANTHROPIC_KEY='sk-ant-...'
```

### Getting Firebase Service Account JSON

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Project Settings → Service Accounts
3. Click "Generate New Private Key"
4. Copy the entire JSON object
5. Paste into `.env` (keep as is, including newlines)

## Step 3: Restart Backend Server

```bash
npm run server
# or
node server.js
```

You should see:
```
[backend] Firestore initialized successfully
[backend] Server listening on http://0.0.0.0:3000
```

## Step 4: Test the Feature

### Test Submission (Browser Console)

```javascript
// Open student.html and run in console:
const response = await fetch('http://localhost:3000/submit-question-with-dedup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    sessionId: 'test-session-id',
    questionText: 'What is photosynthesis?',
    studentId: 'test-student-1',
    similarityThreshold: 0.75
  })
});
const result = await response.json();
console.log(result);
```

Expected response:
```json
{
  "success": true,
  "questionId": "...",
  "isDuplicate": false,
  "count": 1,
  "similarity": 0,
  "message": "Question submitted successfully"
}
```

### Test Deduplication

Submit the exact same question twice:
```javascript
// Second submission
await fetch('http://localhost:3000/submit-question-with-dedup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    sessionId: 'test-session-id',
    questionText: 'What is photosynthesis?',  // Exact same
    studentId: 'test-student-2',
    similarityThreshold: 0.75
  })
});
```

Expected response:
```json
{
  "success": true,
  "questionId": "...",  // Same ID as first
  "isDuplicate": true,
  "count": 2,  // ← Incremented!
  "similarity": 1,
  "message": "Question merged with existing (2 similar questions total)"
}
```

## Step 5: Monitor Dashboard

1. Create a session in the app
2. Have students join via student.html
3. Start a round
4. Students ask questions
5. Watch the dashboard:
   - Questions appear sorted by frequency
   - "👥 N students asked this" badge shows
   - Duplicate submissions are merged automatically

---

## Troubleshooting

### ❌ "Firestore not initialized"
- Verify `FIREBASE_SERVICE_ACCOUNT_JSON` env var is set
- Check format is valid JSON
- Server logs should show: `[backend] Firestore initialized successfully`

### ❌ "CORS error" on student.html
- Make sure backend is running on port 3000
- Check `getApiBaseUrl()` returns correct base (`http://localhost:3000` for web)

### ❌ Questions not merging
- Check similarity threshold (default 0.75)
- Verify text normalization: punctuation should be removed
- Check Firestore has `count` field on existing questions

### ❌ Dashboard shows old questions
- Firestore might have old questions without `count` field
- New questions will be created with `count` automatically
- Consider clearing old questions from Firestore or adding migration script

---

## What Changed?

### Files Modified
- ✏️ `server.js` - Added Firestore + deduplication endpoint
- ✏️ `public/student.html` - Changed question submission to use new endpoint
- ✏️ `src/app/dashboard.tsx` - Updated to sort by count + show frequency badges

### Files Added
- ✨ `src/utils/question-similarity.ts` - Similarity algorithm utilities
- ✨ `src/utils/question-deduplication.ts` - Firebase operations (for future use)
- ✨ `QUESTION_DEDUPLICATION_FEATURE.md` - Full documentation

### No Breaking Changes
- Existing questions still work
- Old submissions can coexist with new ones
- UI unchanged for teachers
- Student experience improved with feedback messages

---

## Next Steps

1. ✅ **Deploy** - Push code to production
2. ✅ **Monitor** - Check browser console for errors during first session
3. ✅ **Adjust** - Tune `similarityThreshold` if needed (currently 0.75)
4. ✅ **Feedback** - Let teachers test and provide feedback
5. ✅ **Enhance** - Consider optional AI filtering for off-topic removal

---

## Support

For issues or questions:
1. Check `QUESTION_DEDUPLICATION_FEATURE.md` for detailed documentation
2. Enable browser console logs: `console.log` messages in student.html
3. Check server logs: Look for `[/submit-question-with-dedup]` entries
4. Verify Firestore data structure matches expectations

---

**Ready to test? Start with Step 3: Test the Feature!**
