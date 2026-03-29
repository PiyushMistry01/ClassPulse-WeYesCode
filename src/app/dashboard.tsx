import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { collection, doc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Modal,
    SafeAreaView, ScrollView,
    StyleSheet,
    Text, TouchableOpacity,
    Vibration,
    View
} from 'react-native';
import LanguageSwitcher from '../components/language-switcher';
import { db } from '../firebase';
import { useI18n } from '../hooks/use-i18n';
import { fetchApi } from '../utils/api-base-url';

// TODO: move to env before making repo public
const ANTHROPIC_KEY = 'YOUR-NEW-KEY-HERE';

type Signal = 'got_it' | 'sort_of' | 'lost';
type StudentData = { signal: Signal };

type RawQuestion = {
  id: string;
  text: string;
  count: number;
  lastAskedAt: any;
  askedAt: any;
  upvotes?: number;
  studentIds?: string[];
  studentId?: string;
};

type GroupedQuestion = {
  representativeText: string;
  count: number;
  upvotes: number;
  priority: number;
  ids: string[];
  lastAskedAt?: any;
};

type SessionData = {
  sessionId: string; code: string; sessionName: string;
  teacherName: string; alertThreshold: number; alertMins: number;
};

type SessionContext = {
  contextRaw: string;
  contextTopics: string[];
  contextSummary: string;
  contextPurpose: string;
};

type McqQuestion = {
  question: string;
  options: string[];
  correctAnswer: string;
};

function getQuizApiUrl(): string | null {
  return '/generate-quiz';
}

async function groupAndFilterQuestions(questions: RawQuestion[], sessionTopic: string): Promise<GroupedQuestion[]> {
  if (questions.length === 0) return [];

  try {
    // Transform questions to grouped format with count-based priority
    // Priority = (count * 100) + recency boost
    const transformed: GroupedQuestion[] = questions.map((q) => {
      const count = q.count || 1;
      const recencyBoost = q.lastAskedAt?.toDate
        ? (new Date(q.lastAskedAt.toDate()).getTime() - Date.now()) / 1000000
        : 0;

      return {
        representativeText: q.text,
        count: count,
        upvotes: q.upvotes || 0,
        priority: count * 100 + recencyBoost,
        ids: [q.id],
        lastAskedAt: q.lastAskedAt,
      };
    });

    // Sort by priority (descending) - highest count = highest priority
    transformed.sort((a, b) => b.priority - a.priority);

    // Optional: Use AI to filter out off-topic questions and provide intelligent grouping
    // Only if ANTHROPIC_KEY is available and not a placeholder
    if (ANTHROPIC_KEY && ANTHROPIC_KEY !== 'YOUR-NEW-KEY-HERE' && sessionTopic) {
      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1500,
            messages: [
              {
                role: 'user',
                content: `You are helping a teacher manage student questions during a class on: "${sessionTopic}".

Here are the student questions with frequency counts (JSON):
${JSON.stringify(
  transformed.map((q) => ({
    id: q.ids[0],
    text: q.representativeText,
    count: q.count,
    priority: q.priority.toFixed(2),
  }))
)}

Your tasks:
1. DISCARD any questions NOT related to "${sessionTopic}" — silently remove them.
2. Each question already has a count showing how many times students asked it (higher = more important).
3. KEEP the count and priority values AS-IS (do not recalculate).
4. Return sorted by priority DESCENDING (already sorted for you).

Rules:
- Never invent questions. Only use what students actually asked.
- Discard greetings, random text, or anything unrelated to the topic.
- RESPECT the frequency count — a question asked 5 times is more important than one asked once.

Respond ONLY with a valid JSON array. No markdown, no explanation:
[{"representativeText":"...","count":2,"upvotes":0,"priority":200.5,"ids":["id1"]}]`,
              },
            ],
          }),
        });

        if (response.ok) {
          const data = await response.json();
          const raw = data.content?.find((c: any) => c.type === 'text')?.text || '[]';
          const clean = raw.replace(/```json|```/g, '').trim();
          const filtered = JSON.parse(clean) as GroupedQuestion[];

          // Verify it's valid
          if (Array.isArray(filtered) && filtered.length > 0) {
            console.log(`[Dashboard] AI filtered ${questions.length} → ${filtered.length} relevant questions`);
            return filtered;
          }
        }
      } catch (aiError) {
        console.warn('[Dashboard] AI filtering failed, using local sort:', aiError);
      }
    }

    return transformed;
  } catch (e) {
    console.error('[Dashboard] Question grouping failed:', e);
    // Fallback: return questions sorted by count
    return questions
      .map((q) => ({
        representativeText: q.text,
        count: q.count || 1,
        upvotes: q.upvotes || 0,
        priority: (q.count || 1) * 100,
        ids: [q.id],
        lastAskedAt: q.lastAskedAt,
      }))
      .sort((a, b) => b.priority - a.priority);
  }
}

export default function Dashboard() {
  const router = useRouter();
  const { i18n } = useI18n();
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
  const [sessionContext, setSessionContext] = useState<SessionContext>({
    contextRaw: '',
    contextTopics: [],
    contextSummary: '',
    contextPurpose: '',
  });
  const [quizModalVisible, setQuizModalVisible] = useState(false);
  const [quizGenerating, setQuizGenerating] = useState(false);
  const [quizSending, setQuizSending] = useState(false);
  const [generatedQuiz, setGeneratedQuiz] = useState<McqQuestion[]>([]);
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
      const data = snap.data();
      setActive(data.active ?? false);
      setSessionContext({
        contextRaw: typeof data.contextRaw === 'string' ? data.contextRaw : '',
        contextTopics: Array.isArray(data.contextTopics)
          ? data.contextTopics.filter((item: unknown): item is string => typeof item === 'string')
          : [],
        contextSummary: typeof data.contextSummary === 'string' ? data.contextSummary : '',
        contextPurpose: typeof data.contextPurpose === 'string' ? data.contextPurpose : '',
      });
    });
    const s2 = onSnapshot(collection(db, 'sessions', session.sessionId, 'students'), snap => {
      const studs: Record<string, StudentData> = {};
      snap.forEach(d => { studs[d.id] = d.data() as StudentData; });
      setStudents(studs);
    });
    const s3 = onSnapshot(collection(db, 'sessions', session.sessionId, 'questions'), snap => {
      const qs: RawQuestion[] = [];
      snap.forEach(d => {
        const data = d.data();
        qs.push({
          id: d.id,
          text: data.text || '',
          count: data.count || 1,
          lastAskedAt: data.lastAskedAt,
          askedAt: data.askedAt,
          upvotes: data.upvotes || 0,
          studentIds: data.studentIds || [],
          studentId: data.studentId || '',
        });
      });
      setRawQuestions(qs);
    });
    return () => { s1(); s2(); s3(); };
  }, [session]);

  // AI question grouping and prioritization
  useEffect(() => {
    if (!session || rawQuestions.length === 0) {
      setGroupedQs([]);
      return;
    }

    // Call grouping function whenever questions change
    groupAndFilterQuestions(
      rawQuestions,
      session.sessionName || sessionContext.contextSummary
    ).then(setGroupedQs);
  }, [rawQuestions, session?.sessionName, sessionContext.contextSummary]);

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
    Alert.alert(i18n.t('endSessionTitle'), i18n.t('endSessionBody'), [
      { text: i18n.t('cancel'), style: 'cancel' },
      { text: i18n.t('end'), style: 'destructive', onPress: async () => {
        if (!session) return;
        await updateDoc(doc(db, 'sessions', session.sessionId), { active: false, ended: true });
        await AsyncStorage.removeItem('currentSession');
        router.replace({ pathname: '/analysis', params: { sessionId: session.sessionId } } as any);
      }}
    ]);
  }

  async function handleGenerateQuiz() {
    if (!session) return;

    if (!sessionContext.contextRaw && !sessionContext.contextSummary && !sessionContext.contextTopics.length) {
      Alert.alert(i18n.t('contextRequiredTitle'), i18n.t('contextRequiredBody'));
      return;
    }

    setQuizGenerating(true);
    try {
      const apiUrl = getQuizApiUrl();
      if (!apiUrl) {
        Alert.alert(
          i18n.t('configRequiredTitle'),
          i18n.t('configRequiredBody')
        );
        return;
      }

      const response = await fetchApi(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          responseFormat: 'mcq',
          contextRaw: sessionContext.contextRaw,
          contextTopics: sessionContext.contextTopics,
          contextSummary: sessionContext.contextSummary,
          contextPurpose: sessionContext.contextPurpose,
        }),
      });

      if (!response.ok) {
        let detail = `generate-quiz failed: ${response.status}`;
        try {
          const errData = (await response.json()) as { error?: unknown };
          if (typeof errData.error === 'string' && errData.error.trim()) {
            detail = errData.error.trim();
          }
        } catch {
          // keep status-based fallback message
        }
        throw new Error(detail);
      }

      const data = (await response.json()) as { questions?: unknown };
      const questions = Array.isArray(data.questions)
        ? data.questions
            .filter((q): q is McqQuestion => {
              return (
                !!q &&
                typeof (q as McqQuestion).question === 'string' &&
                Array.isArray((q as McqQuestion).options) &&
                (q as McqQuestion).options.length === 4 &&
                typeof (q as McqQuestion).correctAnswer === 'string'
              );
            })
            .slice(0, 5)
        : [];

      if (!questions.length) {
        Alert.alert(i18n.t('noQuizTitle'), i18n.t('noQuizBody'));
        return;
      }

      setGeneratedQuiz(questions);
      setQuizModalVisible(true);
    } catch (error) {
      console.error('Generate quiz failed:', error);
      const message =
        error instanceof Error && error.message
          ? error.message
          : i18n.t('generationFailedBody');
      Alert.alert(i18n.t('generationFailedTitle'), message);
    } finally {
      setQuizGenerating(false);
    }
  }

  async function handleSendQuizToStudents() {
    if (!session || !generatedQuiz.length) return;

    setQuizSending(true);
    try {
      await updateDoc(doc(db, 'sessions', session.sessionId), {
        activeQuiz: {
          questions: generatedQuiz.map((item, index) => ({
            id: `q${index + 1}`,
            text: item.question,
            question: item.question,
            options: item.options,
            correctAnswer: item.correctAnswer,
          })),
          createdAt: Date.now(),
          source: 'ai-context',
        },
        quizPublishedAt: serverTimestamp(),
      });

      setQuizModalVisible(false);
      Alert.alert(i18n.t('quizSentTitle'), i18n.t('quizSentBody'));
    } catch (error) {
      console.error('Send quiz failed:', error);
      Alert.alert(i18n.t('sendFailedTitle'), i18n.t('sendFailedBody'));
    } finally {
      setQuizSending(false);
    }
  }

  if (!session) return (
    <SafeAreaView style={s.safe}><View style={s.centered}><Text style={s.muted}>{i18n.t('loading')}</Text></View></SafeAreaView>
  );

  return (
    <SafeAreaView style={s.safe}>

      {/* Timer Alert Modal */}
      <Modal visible={showTimerAlert} transparent animationType="fade">
        <View style={s.overlay}>
          <View style={s.modalCard}>
            <Text style={s.modalIcon}>⏰</Text>
            <Text style={s.modalTitle}>{i18n.t('timesUp')}</Text>
            <Text style={s.modalSub}>{i18n.t('minutesPassedActivate', { mins: session.alertMins })}</Text>
            <TouchableOpacity style={s.activateBtn} onPress={activateNow}>
              <Text style={s.activateBtnText}>{i18n.t('activateRoundNow')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.snoozeBtn} onPress={resetTimer}>
              <Text style={s.snoozeBtnText}>{i18n.t('snoozeRestart')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={quizModalVisible} transparent animationType="slide" onRequestClose={() => setQuizModalVisible(false)}>
        <View style={s.overlay}>
          <View style={s.quizModalCard}>
            <Text style={s.modalTitle}>{i18n.t('aiQuizPreview')}</Text>
            <Text style={s.modalSub}>{i18n.t('reviewBeforeSending')}</Text>

            <ScrollView style={s.quizList} contentContainerStyle={s.quizListContent}>
              {generatedQuiz.map((question, index) => (
                <View key={`${index}-${question.question}`} style={s.quizQuestionCard}>
                  <Text style={s.quizQuestionIndex}>Q{index + 1}</Text>
                  <Text style={s.quizQuestionText}>{question.question}</Text>
                  {question.options.map((option, optionIndex) => (
                    <Text key={`${index}-o-${optionIndex}`} style={s.quizHint}>{String.fromCharCode(65 + optionIndex)}. {option}</Text>
                  ))}
                </View>
              ))}
            </ScrollView>

            <TouchableOpacity
              style={[s.activateBtn, quizSending && s.quizBtnDisabled]}
              onPress={handleSendQuizToStudents}
              disabled={quizSending}
            >
              <Text style={s.activateBtnText}>{quizSending ? i18n.t('sending') : i18n.t('sendToStudents')}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={s.snoozeBtn} onPress={() => setQuizModalVisible(false)} disabled={quizSending}>
              <Text style={s.snoozeBtnText}>{i18n.t('close')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <ScrollView contentContainerStyle={s.scroll}>
        <LanguageSwitcher />

        {/* Header */}
        <View style={s.header}>
          <View style={{ flex: 1 }}>
            <Text style={s.liveBadge}>{`● ${i18n.t('live')}`}</Text>
            <Text style={s.title}>{session.sessionName}</Text>
            <Text style={s.sub}>{i18n.t('codeAndTeacher', { code: session.code, teacher: session.teacherName })}</Text>
          </View>
          <TouchableOpacity style={s.endBtn} onPress={endSession}>
            <Text style={s.endBtnText}>{i18n.t('end')}</Text>
          </TouchableOpacity>
        </View>

        {/* Timer */}
        <View style={s.timerCard}>
          <View>
            <Text style={s.timerLabel}>
              {active
                ? i18n.t('roundActive')
                : !roundEverStarted
                  ? i18n.t('startRoundToBegin')   // ✅ New label for pre-first-round state
                  : timerRunning
                    ? i18n.t('nextCheckIn')
                    : i18n.t('timerReady')}
            </Text>
            <Text style={[s.timerValue, { color: tColor }]}>
              {active || !roundEverStarted ? '—  —' : `${mm}:${ss}`}
            </Text>
          </View>
          <View style={s.timerRight}>
            <Text style={s.timerHint}>
              {active
                ? i18n.t('pausedDuringRound')
                : !roundEverStarted
                  ? i18n.t('tapStartRound')   // ✅ Hint guiding teacher
                  : i18n.t('everyMin', { mins: session.alertMins })}
            </Text>
            {!active && roundEverStarted && (
              <TouchableOpacity style={s.resetBtn} onPress={resetTimer}>
                <Text style={s.resetBtnText}>{`↺ ${i18n.t('reset')}`}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Lost alert */}
        {isAlert && (
          <View style={s.alertBanner}>
            <Text style={s.alertText}>{`⚠️  ${i18n.t('studentsLostBanner', { pct: lostPct })}`}</Text>
          </View>
        )}

        {/* Stats */}
        <View style={s.statsRow}>
          <StatCard label={i18n.t('gotIt')}  count={counts.got}  pct={total > 0 ? Math.round(counts.got/total*100)  : 0} color="#1D9E75" bg="#E1F5EE" />
          <StatCard label={i18n.t('sortOf')} count={counts.sort} pct={total > 0 ? Math.round(counts.sort/total*100) : 0} color="#C48A00" bg="#FDF3DC" />
          <StatCard label={i18n.t('lost')}    count={counts.lost} pct={lostPct} color="#D85A30" bg="#FDECEA" />
        </View>
        <Text style={s.totalText}>
          {total === 1
            ? i18n.t('studentsResponded', { count: total })
            : i18n.t('studentsRespondedPlural', { count: total })}
        </Text>

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
            {active ? `⏹  ${i18n.t('closeRound')}` : `▶  ${i18n.t('startRound')}`}
          </Text>
        </TouchableOpacity>
        <Text style={s.roundHint}>
          {active ? i18n.t('studentsCanSendSignal') : i18n.t('tapToOpenRespond')}
        </Text>

        <TouchableOpacity
          style={[s.quizBtn, quizGenerating && s.quizBtnDisabled]}
          onPress={handleGenerateQuiz}
          disabled={quizGenerating}
        >
          {quizGenerating ? <ActivityIndicator color="#F7F5F0" /> : <Text style={s.quizBtnText}>{i18n.t('generateAiQuiz')}</Text>}
        </TouchableOpacity>

        <Text style={s.quizHint}>{i18n.t('quizGeneratedHint')}</Text>

        {/* Questions */}
        <View style={s.qHeader}>
          <Text style={s.qTitle}>{i18n.t('studentQuestions')}</Text>
          <Text style={s.qSub}>
            {processing
              ? `🤖 ${i18n.t('aiAnalyzing')}`
              : groupedQs.length > 0
                ? groupedQs.length === 1
                  ? i18n.t('groupsCount', { count: groupedQs.length })
                  : i18n.t('groupsCountPlural', { count: groupedQs.length })
                : ''}
          </Text>
        </View>

        {groupedQs.length === 0 && !processing && (
          <View style={s.emptyBox}>
            <Text style={s.emptyText}>{i18n.t('noQuestionsYet')}</Text>
            <Text style={s.emptyHint}>{i18n.t('studentsCanAskDuringRound')}</Text>
          </View>
        )}

        {groupedQs.map((q, i) => (
          <View key={i} style={[s.qCard, i === 0 && s.qCardTop]}>
            <View style={[s.rankBox, i === 0 && s.rankBoxTop]}>
              <Text style={[s.rankText, i === 0 && s.rankTextTop]}>#{i + 1}</Text>
            </View>
            <View style={{ flex: 1 }}>
              {i === 0 && <Text style={s.topLabel}>{i18n.t('highestPriority')}</Text>}
              <Text style={s.qText}>{q.representativeText}</Text>
              <View style={s.qTags}>
                {q.count > 1 && (
                  <View style={s.tagGreen}><Text style={s.tagGreenText}>{`👥 ${i18n.t('studentsAskedThis', { count: q.count })}`}</Text></View>
                )}
                {q.upvotes > 0 && (
                  <View style={s.tagYellow}><Text style={s.tagYellowText}>{`👍 ${i18n.t('upvotes', { count: q.upvotes })}`}</Text></View>
                )}
                <View style={s.tagPurple}><Text style={s.tagPurpleText}>{`⚡ ${i18n.t('priority', { value: q.priority })}`}</Text></View>
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
  quizBtn:           { backgroundColor: '#215A46', borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginBottom: 8 },
  quizBtnDisabled:   { opacity: 0.65 },
  quizBtnText:       { color: '#F7F5F0', fontSize: 15, fontWeight: '700' },
  quizHint:          { fontSize: 12, color: '#888780', textAlign: 'center', marginBottom: 24 },
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
  quizModalCard:   { backgroundColor: '#fff', borderRadius: 24, padding: 22, width: '100%', maxHeight: '82%', gap: 10 },
  quizList:        { maxHeight: 360, width: '100%' },
  quizListContent: { gap: 8, paddingVertical: 4 },
  quizQuestionCard:{ backgroundColor: '#F7F5F0', borderRadius: 10, borderWidth: 1, borderColor: '#E0DDD7', padding: 12 },
  quizQuestionIndex:{ fontSize: 11, color: '#AEACA6', marginBottom: 4, fontWeight: '700' },
  quizQuestionText:{ fontSize: 14, color: '#1A1A18', lineHeight: 20 },
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