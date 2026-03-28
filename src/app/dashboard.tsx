import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { collection, doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';
import {
    Alert,
    Modal,
    SafeAreaView, ScrollView,
    StyleSheet,
    Text, TouchableOpacity,
    Vibration,
    View
} from 'react-native';
import { db } from '../firebase';

// TODO: move to env before making repo public
const ANTHROPIC_KEY = 'YOUR-NEW-KEY-HERE';

type Signal = 'got_it' | 'sort_of' | 'lost';
type StudentData = { signal: Signal };

type RawQuestion = {
  id: string; text: string; upvotes: number; studentId: string; askedAt: any;
};

type GroupedQuestion = {
  representativeText: string; count: number; upvotes: number; priority: number; ids: string[];
};

type SessionData = {
  sessionId: string; code: string; sessionName: string;
  teacherName: string; alertThreshold: number; alertMins: number;
};

async function groupAndFilterQuestions(questions: RawQuestion[], sessionTopic: string): Promise<GroupedQuestion[]> {
  if (questions.length === 0) return [];
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `You are helping a teacher manage student questions during a class on: "${sessionTopic}".

Here are the student questions (JSON):
${JSON.stringify(questions.map(q => ({ id: q.id, text: q.text, upvotes: q.upvotes })))}

Your tasks:
1. DISCARD any questions NOT related to "${sessionTopic}" — silently remove them.
2. GROUP questions that share the same concept or keywords together.
3. For each group, pick the CLEAREST and most complete question as the representative.
4. Calculate priority = (number of similar questions * 2) + upvotes.
5. Sort by priority DESCENDING — highest priority FIRST (position #1 in queue).

Rules:
- If only 1 question in a group, count = 1.
- Never invent questions. Only use what students actually asked.
- Discard greetings, random text, or anything unrelated to the topic.

Respond ONLY with a valid JSON array. No markdown, no explanation:
[{"representativeText":"...","count":2,"upvotes":3,"priority":7,"ids":["id1","id2"]}]`
        }]
      })
    });
    const data  = await response.json();
    const raw   = data.content?.find((c: any) => c.type === 'text')?.text || '[]';
    const clean = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(clean) as GroupedQuestion[];
  } catch (e) {
    console.error('AI grouping failed:', e);
    return questions.map(q => ({
      representativeText: q.text, count: 1,
      upvotes: q.upvotes || 0, priority: q.upvotes || 0, ids: [q.id],
    })).sort((a, b) => b.priority - a.priority);
  }
}

export default function Dashboard() {
  const router = useRouter();
  const [session, setSession]               = useState<SessionData | null>(null);
  const [active, setActive]                 = useState(false);
  const [students, setStudents]             = useState<Record<string, StudentData>>({});
  const [rawQuestions, setRawQuestions]     = useState<RawQuestion[]>([]);
  const [groupedQs, setGroupedQs]           = useState<GroupedQuestion[]>([]);
  const [alertShown, setAlertShown]         = useState(false);
  const [showTimerAlert, setShowTimerAlert] = useState(false);
  const [processing, setProcessing]         = useState(false);
  const [secondsLeft, setSecondsLeft]       = useState(15 * 60);
  const [timerRunning, setTimerRunning]     = useState(false);
  const [roundEverStarted, setRoundEverStarted] = useState(false); // ← NEW: tracks if teacher has started at least one round
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastQCount = useRef(0);

  // Load session from AsyncStorage and FORCE round to closed state
  useEffect(() => {
    AsyncStorage.getItem('currentSession').then(async raw => {
      if (!raw) { router.replace('/'); return; }
      const s    = JSON.parse(raw);
      const mins = parseInt(s.alertMins) || 15;
      setSession({ ...s, alertThreshold: parseInt(s.alertThreshold), alertMins: mins });
      setSecondsLeft(mins * 60);

      // ✅ Always force round to inactive when dashboard first loads
      // This ensures the round is never auto-started when teacher opens the session
      if (s.sessionId) {
        try {
          await updateDoc(doc(db, 'sessions', s.sessionId), { active: false });
        } catch (e) {
          console.error('Failed to reset active state:', e);
        }
      }
    });
  }, []);

  // Timer logic — runs ONLY after first round has been started AND round is closed AND timerRunning is true
  useEffect(() => {
    if (!session) return;

    // Round is active — clear timer, do nothing
    if (active) {
      clearInterval(timerRef.current!);
      return;
    }

    // ✅ Don't run timer if teacher hasn't started even one round yet
    if (!roundEverStarted) return;

    // Round is closed but timer not started yet
    if (!timerRunning) return;

    // Start countdown
    timerRef.current = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          setTimerRunning(false);
          Vibration.vibrate([0, 500, 200, 500, 200, 500]);
          setShowTimerAlert(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timerRef.current!);
  }, [session, active, timerRunning, roundEverStarted]);

  function resetTimer() {
    clearInterval(timerRef.current!);
    setSecondsLeft((session?.alertMins || 15) * 60);
    setTimerRunning(true);
    setShowTimerAlert(false);
  }

  function pauseTimer() {
    clearInterval(timerRef.current!);
    setTimerRunning(false);
  }

  // Firestore listeners
  useEffect(() => {
    if (!session) return;
    const s1 = onSnapshot(doc(db, 'sessions', session.sessionId), snap => {
      if (!snap.exists()) return;
      setActive(snap.data().active ?? false);
    });
    const s2 = onSnapshot(collection(db, 'sessions', session.sessionId, 'students'), snap => {
      const studs: Record<string, StudentData> = {};
      snap.forEach(d => { studs[d.id] = d.data() as StudentData; });
      setStudents(studs);
    });
    const s3 = onSnapshot(collection(db, 'sessions', session.sessionId, 'questions'), snap => {
      const qs: RawQuestion[] = [];
      snap.forEach(d => qs.push({ id: d.id, ...d.data() } as RawQuestion));
      setRawQuestions(qs);
    });
    return () => { s1(); s2(); s3(); };
  }, [session]);

  // AI question grouping
  useEffect(() => {
  if (!session || rawQuestions.length === 0) { setGroupedQs([]); return; }
  if (rawQuestions.length === lastQCount.current) return;
  lastQCount.current = rawQuestions.length;

  // Bypass AI — show raw questions directly
  const raw = rawQuestions.map(q => ({
    representativeText: q.text,
    count: 1,
    upvotes: q.upvotes || 0,
    priority: 1,
    ids: [q.id],
  }));
  setGroupedQs(raw);
}, [rawQuestions.length]);

  // Lost % vibration alert
  useEffect(() => {
    if (!session || !active) return;
    const total = Object.keys(students).length;
    if (total === 0) return;
    const lostPct = Math.round(Object.values(students).filter(s => s.signal === 'lost').length / total * 100);
    if (lostPct >= session.alertThreshold && !alertShown) {
      Vibration.vibrate([0, 400, 200, 400]);
      setAlertShown(true);
    }
    if (lostPct < session.alertThreshold) setAlertShown(false);
  }, [students, active]);

  const counts = {
    got:  Object.values(students).filter(s => s.signal === 'got_it').length,
    sort: Object.values(students).filter(s => s.signal === 'sort_of').length,
    lost: Object.values(students).filter(s => s.signal === 'lost').length,
  };
  const total   = Object.keys(students).length;
  const lostPct = total > 0 ? Math.round(counts.lost / total * 100) : 0;
  const isAlert = session && lostPct >= session.alertThreshold && total > 0;
  const mm      = Math.floor(secondsLeft / 60).toString().padStart(2, '0');
  const ss      = (secondsLeft % 60).toString().padStart(2, '0');

  // Timer color logic
  // Gray when active or timer not yet started, red/amber/black when counting down
  const tColor = active || !roundEverStarted
    ? '#AEACA6'
    : secondsLeft <= 60
      ? '#D85A30'
      : secondsLeft <= 180
        ? '#C48A00'
        : '#1A1A18';

  async function toggleRound() {
    if (!session) return;
    const nowActive = !active;
    await updateDoc(doc(db, 'sessions', session.sessionId), { active: nowActive });

    if (nowActive) {
      // Round just STARTED
      setRoundEverStarted(true); // ✅ Mark that teacher has started at least one round
      pauseTimer();
    } else {
      // Round just CLOSED — start countdown
      resetTimer();
    }
  }

  async function activateNow() {
    if (!session) return;
    await updateDoc(doc(db, 'sessions', session.sessionId), { active: true });
    setRoundEverStarted(true);
    setShowTimerAlert(false);
    pauseTimer();
  }

  async function endSession() {
    Alert.alert('End Session?', 'This will close the session for all students.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'End', style: 'destructive', onPress: async () => {
        if (!session) return;
        await updateDoc(doc(db, 'sessions', session.sessionId), { active: false, ended: true });
        await AsyncStorage.removeItem('currentSession');
        router.replace({ pathname: '/analysis', params: { sessionId: session.sessionId } } as any);
      }}
    ]);
  }

  if (!session) return (
    <SafeAreaView style={s.safe}><View style={s.centered}><Text style={s.muted}>Loading…</Text></View></SafeAreaView>
  );

  return (
    <SafeAreaView style={s.safe}>

      {/* Timer Alert Modal */}
      <Modal visible={showTimerAlert} transparent animationType="fade">
        <View style={s.overlay}>
          <View style={s.modalCard}>
            <Text style={s.modalIcon}>⏰</Text>
            <Text style={s.modalTitle}>Time's up!</Text>
            <Text style={s.modalSub}>{session.alertMins} minutes have passed.{'\n'}Activate round for students?</Text>
            <TouchableOpacity style={s.activateBtn} onPress={activateNow}>
              <Text style={s.activateBtnText}>Activate Round Now →</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.snoozeBtn} onPress={resetTimer}>
              <Text style={s.snoozeBtnText}>Snooze (restart timer)</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <ScrollView contentContainerStyle={s.scroll}>

        {/* Header */}
        <View style={s.header}>
          <View style={{ flex: 1 }}>
            <Text style={s.liveBadge}>● LIVE</Text>
            <Text style={s.title}>{session.sessionName}</Text>
            <Text style={s.sub}>Code {session.code} · {session.teacherName}</Text>
          </View>
          <TouchableOpacity style={s.endBtn} onPress={endSession}>
            <Text style={s.endBtnText}>End</Text>
          </TouchableOpacity>
        </View>

        {/* Timer */}
        <View style={s.timerCard}>
          <View>
            <Text style={s.timerLabel}>
              {active
                ? 'ROUND ACTIVE'
                : !roundEverStarted
                  ? 'START A ROUND TO BEGIN'   // ✅ New label for pre-first-round state
                  : timerRunning
                    ? 'NEXT CHECK-IN'
                    : 'TIMER READY'}
            </Text>
            <Text style={[s.timerValue, { color: tColor }]}>
              {active || !roundEverStarted ? '—  —' : `${mm}:${ss}`}
            </Text>
          </View>
          <View style={s.timerRight}>
            <Text style={s.timerHint}>
              {active
                ? 'Paused during round'
                : !roundEverStarted
                  ? 'Tap ▶ Start Round below'   // ✅ Hint guiding teacher
                  : `Every ${session.alertMins} min`}
            </Text>
            {!active && roundEverStarted && (
              <TouchableOpacity style={s.resetBtn} onPress={resetTimer}>
                <Text style={s.resetBtnText}>↺ Reset</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Lost alert */}
        {isAlert && (
          <View style={s.alertBanner}>
            <Text style={s.alertText}>⚠️  {lostPct}% of students are lost!</Text>
          </View>
        )}

        {/* Stats */}
        <View style={s.statsRow}>
          <StatCard label="Got it"  count={counts.got}  pct={total > 0 ? Math.round(counts.got/total*100)  : 0} color="#1D9E75" bg="#E1F5EE" />
          <StatCard label="Sort of" count={counts.sort} pct={total > 0 ? Math.round(counts.sort/total*100) : 0} color="#C48A00" bg="#FDF3DC" />
          <StatCard label="Lost"    count={counts.lost} pct={lostPct} color="#D85A30" bg="#FDECEA" />
        </View>
        <Text style={s.totalText}>{total} student{total !== 1 ? 's' : ''} responded</Text>

        {total > 0 && (
          <View style={s.barTrack}>
            <View style={[s.barSeg, { flex: counts.got,  backgroundColor: '#1D9E75' }]} />
            <View style={[s.barSeg, { flex: counts.sort, backgroundColor: '#C48A00' }]} />
            <View style={[s.barSeg, { flex: counts.lost, backgroundColor: '#D85A30' }]} />
          </View>
        )}

        {/* Round button */}
        <TouchableOpacity style={[s.roundBtn, active ? s.roundActive : s.roundInactive]} onPress={toggleRound}>
          <Text style={[s.roundText, active ? s.roundTextActive : s.roundTextInactive]}>
            {active ? '⏹  Close Round' : '▶  Start Round'}
          </Text>
        </TouchableOpacity>
        <Text style={s.roundHint}>
          {active ? 'Students can send their signal now' : 'Tap to open — students respond instantly'}
        </Text>

        {/* Questions */}
        <View style={s.qHeader}>
          <Text style={s.qTitle}>STUDENT QUESTIONS</Text>
          <Text style={s.qSub}>
            {processing ? '🤖 AI analyzing…' : groupedQs.length > 0 ? `${groupedQs.length} group${groupedQs.length !== 1 ? 's' : ''}` : ''}
          </Text>
        </View>

        {groupedQs.length === 0 && !processing && (
          <View style={s.emptyBox}>
            <Text style={s.emptyText}>No questions yet</Text>
            <Text style={s.emptyHint}>Students can ask questions during an active round</Text>
          </View>
        )}

        {groupedQs.map((q, i) => (
          <View key={i} style={[s.qCard, i === 0 && s.qCardTop]}>
            <View style={[s.rankBox, i === 0 && s.rankBoxTop]}>
              <Text style={[s.rankText, i === 0 && s.rankTextTop]}>#{i + 1}</Text>
            </View>
            <View style={{ flex: 1 }}>
              {i === 0 && <Text style={s.topLabel}>Highest Priority</Text>}
              <Text style={s.qText}>{q.representativeText}</Text>
              <View style={s.qTags}>
                {q.count > 1 && (
                  <View style={s.tagGreen}><Text style={s.tagGreenText}>👥 {q.count} students asked this</Text></View>
                )}
                {q.upvotes > 0 && (
                  <View style={s.tagYellow}><Text style={s.tagYellowText}>👍 {q.upvotes} upvotes</Text></View>
                )}
                <View style={s.tagPurple}><Text style={s.tagPurpleText}>⚡ priority {q.priority}</Text></View>
              </View>
            </View>
          </View>
        ))}

      </ScrollView>
    </SafeAreaView>
  );
}

function StatCard({ label, count, pct, color, bg }: { label: string; count: number; pct: number; color: string; bg: string; }) {
  return (
    <View style={[sc.card, { backgroundColor: bg }]}>
      <Text style={[sc.num, { color }]}>{count}</Text>
      <Text style={[sc.lbl, { color }]}>{label}</Text>
      <Text style={[sc.pct, { color }]}>{pct}%</Text>
    </View>
  );
}

const s = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: '#F7F5F0' },
  scroll:   { padding: 24, paddingBottom: 48 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  muted:    { fontSize: 15, color: '#888780' },
  header:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, marginTop: 4 },
  liveBadge:  { fontSize: 11, letterSpacing: 2, color: '#D85A30', fontWeight: '700', marginBottom: 4 },
  title:      { fontSize: 20, fontWeight: '700', color: '#1A1A18', letterSpacing: -0.3 },
  sub:        { fontSize: 12, color: '#888780', marginTop: 2 },
  endBtn:     { backgroundColor: '#FDECEA', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  endBtnText: { fontSize: 13, fontWeight: '600', color: '#D85A30' },
  timerCard:    { backgroundColor: '#fff', borderRadius: 16, padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, borderWidth: 1, borderColor: '#E0DDD7' },
  timerLabel:   { fontSize: 10, letterSpacing: 1.5, color: '#AEACA6', fontWeight: '600', marginBottom: 2 },
  timerValue:   { fontSize: 42, fontWeight: '700', letterSpacing: -1 },
  timerRight:   { alignItems: 'flex-end', gap: 8 },
  timerHint:    { fontSize: 12, color: '#888780' },
  resetBtn:     { backgroundColor: '#F7F5F0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: '#E0DDD7' },
  resetBtnText: { fontSize: 13, color: '#444441', fontWeight: '500' },
  alertBanner: { backgroundColor: '#D85A30', borderRadius: 12, padding: 12, marginBottom: 14 },
  alertText:   { color: '#fff', fontSize: 14, fontWeight: '700', textAlign: 'center' },
  statsRow:  { flexDirection: 'row', gap: 10, marginBottom: 8 },
  totalText: { fontSize: 12, color: '#888780', textAlign: 'center', marginBottom: 10 },
  barTrack:  { flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 20, backgroundColor: '#E0DDD7' },
  barSeg:    { height: '100%' },
  roundBtn:          { borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginBottom: 6 },
  roundActive:       { backgroundColor: '#FDECEA', borderWidth: 1.5, borderColor: '#D85A30' },
  roundInactive:     { backgroundColor: '#1A1A18' },
  roundText:         { fontSize: 16, fontWeight: '700' },
  roundTextActive:   { color: '#D85A30' },
  roundTextInactive: { color: '#F7F5F0' },
  roundHint:         { fontSize: 12, color: '#AEACA6', textAlign: 'center', marginBottom: 24 },
  qHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  qTitle:  { fontSize: 11, fontWeight: '700', color: '#AEACA6', letterSpacing: 1, textTransform: 'uppercase' },
  qSub:    { fontSize: 11, color: '#AEACA6' },
  emptyBox:  { backgroundColor: '#fff', borderRadius: 12, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: '#E0DDD7' },
  emptyText: { fontSize: 14, color: '#AEACA6', fontWeight: '500' },
  emptyHint: { fontSize: 12, color: '#C8C5BE', marginTop: 4, textAlign: 'center' },
  qCard:      { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10, flexDirection: 'row', gap: 12, borderWidth: 1, borderColor: '#E0DDD7' },
  qCardTop:   { borderColor: '#7B5EA7', borderWidth: 2 },
  rankBox:    { width: 34, height: 34, borderRadius: 8, backgroundColor: '#F7F5F0', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#E0DDD7' },
  rankBoxTop: { backgroundColor: '#F0EDF8', borderColor: '#7B5EA7' },
  rankText:   { fontSize: 12, fontWeight: '700', color: '#888780' },
  rankTextTop:{ color: '#7B5EA7' },
  topLabel:   { fontSize: 11, fontWeight: '700', color: '#7B5EA7', marginBottom: 4, letterSpacing: 0.3 },
  qText:      { fontSize: 14, color: '#1A1A18', lineHeight: 20, fontWeight: '500', marginBottom: 8 },
  qTags:      { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tagGreen:      { backgroundColor: '#E1F5EE', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  tagGreenText:  { fontSize: 11, fontWeight: '600', color: '#1D9E75' },
  tagYellow:     { backgroundColor: '#FDF3DC', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  tagYellowText: { fontSize: 11, fontWeight: '600', color: '#C48A00' },
  tagPurple:     { backgroundColor: '#F0EDF8', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  tagPurpleText: { fontSize: 11, fontWeight: '600', color: '#7B5EA7' },
  overlay:         { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 28 },
  modalCard:       { backgroundColor: '#fff', borderRadius: 24, padding: 32, width: '100%', alignItems: 'center', gap: 12 },
  modalIcon:       { fontSize: 52 },
  modalTitle:      { fontSize: 26, fontWeight: '700', color: '#1A1A18' },
  modalSub:        { fontSize: 15, color: '#888780', textAlign: 'center', lineHeight: 22 },
  activateBtn:     { backgroundColor: '#1A1A18', borderRadius: 14, paddingVertical: 16, width: '100%', alignItems: 'center', marginTop: 8 },
  activateBtnText: { color: '#F7F5F0', fontSize: 16, fontWeight: '700' },
  snoozeBtn:       { borderWidth: 1.5, borderColor: '#E0DDD7', borderRadius: 14, paddingVertical: 14, width: '100%', alignItems: 'center' },
  snoozeBtnText:   { color: '#888780', fontSize: 14, fontWeight: '500' },
});

const sc = StyleSheet.create({
  card: { flex: 1, borderRadius: 14, padding: 14, alignItems: 'center' },
  num:  { fontSize: 30, fontWeight: '700' },
  lbl:  { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', marginTop: 2 },
  pct:  { fontSize: 13, fontWeight: '700', marginTop: 2 },
});