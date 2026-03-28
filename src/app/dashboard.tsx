import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, ScrollView, Alert, Vibration
} from 'react-native';
import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'expo-router';
import { doc, onSnapshot, updateDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import AsyncStorage from '@react-native-async-storage/async-storage';

type Signal = 'got_it' | 'sort_of' | 'lost';

type StudentData = {
  signal: Signal;
};

type Question = {
  id: string;
  text: string;
  upvotes: number;
};

type SessionData = {
  sessionId: string;
  code: string;
  sessionName: string;
  teacherName: string;
  alertThreshold: number;
};

export default function Dashboard() {
  const router = useRouter();
  const [session, setSession]     = useState<SessionData | null>(null);
  const [active, setActive]       = useState(false);
  const [students, setStudents]   = useState<Record<string, StudentData>>({});
  const [questions, setQuestions] = useState<Question[]>([]);
  const [alertShown, setAlertShown] = useState(false);
  const unsubRef = useRef<(() => void) | null>(null);

  // Load session from AsyncStorage
  useEffect(() => {
    AsyncStorage.getItem('currentSession').then(raw => {
      if (!raw) { router.replace('/'); return; }
      const s = JSON.parse(raw);
      setSession({ ...s, alertThreshold: parseInt(s.alertThreshold) });
    });
  }, []);

  // Listen to Firestore
  useEffect(() => {
    if (!session) return;

    unsubRef.current = onSnapshot(doc(db, 'sessions', session.sessionId), snap => {
      if (!snap.exists()) return;
      const data = snap.data();
      setActive(data.active ?? false);

      // Students subcollection signals
      const studs: Record<string, StudentData> = {};
      if (data.students) {
        Object.entries(data.students).forEach(([k, v]: any) => {
          studs[k] = v;
        });
      }
      setStudents(studs);
    });

    // Listen to questions subcollection
    const qUnsub = onSnapshot(
      collection(db, 'sessions', session.sessionId, 'students'),
      snap => {
        const studs: Record<string, StudentData> = {};
        snap.forEach(d => { studs[d.id] = d.data() as StudentData; });
        setStudents(studs);
      }
    );

    const questUnsub = onSnapshot(
      collection(db, 'sessions', session.sessionId, 'questions'),
      snap => {
        const qs: Question[] = [];
        snap.forEach(d => qs.push({ id: d.id, ...d.data() } as Question));
        qs.sort((a, b) => (b.upvotes || 0) - (a.upvotes || 0));
        setQuestions(qs);
      }
    );

    return () => {
      unsubRef.current?.();
      qUnsub();
      questUnsub();
    };
  }, [session]);

  // Alert when lost % exceeds threshold
  useEffect(() => {
    if (!session || !active) return;
    const total = Object.keys(students).length;
    if (total === 0) return;
    const lostCount = Object.values(students).filter(s => s.signal === 'lost').length;
    const lostPct = Math.round(lostCount / total * 100);
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
  const total = Object.keys(students).length;
  const lostPct = total > 0 ? Math.round(counts.lost / total * 100) : 0;
  const isAlert = session && lostPct >= session.alertThreshold && total > 0;

  async function toggleRound() {
    if (!session) return;
    await updateDoc(doc(db, 'sessions', session.sessionId), {
      active: !active,
    });
  }

  async function endSession() {
    Alert.alert('End Session?', 'This will close the session for all students.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'End', style: 'destructive', onPress: async () => {
          if (!session) return;
          await updateDoc(doc(db, 'sessions', session.sessionId), {
            active: false,
            ended: true,
          });
          await AsyncStorage.removeItem('currentSession');
          router.replace('/');
        }
      }
    ]);
  }

  if (!session) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.centered}>
          <Text style={s.muted}>Loading…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.scroll}>

        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.badge}>LIVE</Text>
            <Text style={s.title}>{session.sessionName}</Text>
            <Text style={s.sub}>Code: {session.code}</Text>
          </View>
          <TouchableOpacity style={s.endBtn} onPress={endSession}>
            <Text style={s.endBtnText}>End</Text>
          </TouchableOpacity>
        </View>

        {/* Alert banner */}
        {isAlert && (
          <View style={s.alertBanner}>
            <Text style={s.alertText}>⚠️ {lostPct}% of students are lost!</Text>
          </View>
        )}

        {/* Stats */}
        <View style={s.statsRow}>
          <StatCard label="Got it"  count={counts.got}  pct={total > 0 ? Math.round(counts.got/total*100) : 0}  color="#1D9E75" bg="#E1F5EE" />
          <StatCard label="Sort of" count={counts.sort} pct={total > 0 ? Math.round(counts.sort/total*100) : 0} color="#C48A00" bg="#FDF3DC" />
          <StatCard label="Lost"    count={counts.lost} pct={lostPct}                                             color="#D85A30" bg="#FDECEA" />
        </View>

        <Text style={s.totalText}>{total} student{total !== 1 ? 's' : ''} responded</Text>

        {/* Progress bar */}
        {total > 0 && (
          <View style={s.barTrack}>
            <View style={[s.barSeg, { flex: counts.got,  backgroundColor: '#1D9E75' }]} />
            <View style={[s.barSeg, { flex: counts.sort, backgroundColor: '#C48A00' }]} />
            <View style={[s.barSeg, { flex: counts.lost, backgroundColor: '#D85A30' }]} />
          </View>
        )}

        {/* Round control */}
        <TouchableOpacity
          style={[s.roundBtn, active ? s.roundBtnActive : s.roundBtnInactive]}
          onPress={toggleRound}
        >
          <Text style={[s.roundBtnText, active ? s.roundBtnTextActive : s.roundBtnTextInactive]}>
            {active ? 'Close Round' : 'Start Round →'}
          </Text>
        </TouchableOpacity>

        <Text style={s.roundHint}>
          {active
            ? 'Students can now send their signal'
            : 'Tap to open round — students will respond instantly'}
        </Text>

        {/* Questions */}
        {questions.length > 0 && (
          <>
            <Text style={s.sectionTitle}>Student questions</Text>
            {questions.map(q => (
              <View key={q.id} style={s.qCard}>
                <Text style={s.qText}>{q.text}</Text>
                <Text style={s.qUpvotes}>👍 {q.upvotes || 0}</Text>
              </View>
            ))}
          </>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

function StatCard({ label, count, pct, color, bg }: {
  label: string; count: number; pct: number; color: string; bg: string;
}) {
  return (
    <View style={[sc.card, { backgroundColor: bg }]}>
      <Text style={[sc.count, { color }]}>{count}</Text>
      <Text style={[sc.label, { color }]}>{label}</Text>
      <Text style={[sc.pct, { color }]}>{pct}%</Text>
    </View>
  );
}

const s = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: '#F7F5F0' },
  scroll:  { padding: 24, paddingBottom: 40 },
  centered:{ flex: 1, justifyContent: 'center', alignItems: 'center' },
  muted:   { fontSize: 15, color: '#888780' },

  header:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, marginTop: 8 },
  badge:   { fontSize: 11, letterSpacing: 2.5, color: '#D85A30', fontWeight: '600', marginBottom: 4 },
  title:   { fontSize: 22, fontWeight: '600', color: '#1A1A18', letterSpacing: -0.3 },
  sub:     { fontSize: 13, color: '#888780', marginTop: 2 },

  endBtn:     { backgroundColor: '#FDECEA', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 },
  endBtnText: { fontSize: 14, fontWeight: '600', color: '#D85A30' },

  alertBanner: { backgroundColor: '#D85A30', borderRadius: 12, padding: 14, marginBottom: 16 },
  alertText:   { color: '#fff', fontSize: 15, fontWeight: '600', textAlign: 'center' },

  statsRow:  { flexDirection: 'row', gap: 10, marginBottom: 10 },
  totalText: { fontSize: 13, color: '#888780', textAlign: 'center', marginBottom: 12 },

  barTrack: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', marginBottom: 24, backgroundColor: '#E0DDD7' },
  barSeg:   { height: '100%' },

  roundBtn: { borderRadius: 14, paddingVertical: 18, alignItems: 'center', marginBottom: 8 },
  roundBtnActive:   { backgroundColor: '#FDECEA', borderWidth: 1.5, borderColor: '#D85A30' },
  roundBtnInactive: { backgroundColor: '#1A1A18' },
  roundBtnText: { fontSize: 16, fontWeight: '600' },
  roundBtnTextActive:   { color: '#D85A30' },
  roundBtnTextInactive: { color: '#F7F5F0' },

  roundHint: { fontSize: 12, color: '#AEACA6', textAlign: 'center', marginBottom: 28 },

  sectionTitle: { fontSize: 12, fontWeight: '700', color: '#AEACA6', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 },

  qCard:    { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#E0DDD7', flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  qText:    { flex: 1, fontSize: 14, color: '#1A1A18', lineHeight: 20 },
  qUpvotes: { fontSize: 12, color: '#888780' },
});

const sc = StyleSheet.create({
  card:  { flex: 1, borderRadius: 14, padding: 14, alignItems: 'center' },
  count: { fontSize: 32, fontWeight: '700' },
  label: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', marginTop: 2 },
  pct:   { fontSize: 14, fontWeight: '700', marginTop: 2 },
});