import * as FileSystemLegacy from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import { useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { collection, doc, getDoc, getDocs, Timestamp } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    LayoutChangeEvent,
    Platform,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import Svg, { Circle, G, Line, Polyline, Text as SvgText } from 'react-native-svg';
import LanguageSwitcher from '../components/language-switcher';
import { db } from '../firebase';
import { useI18n } from '../hooks/use-i18n';

type Signal = 'got_it' | 'sort_of' | 'lost';

type SessionDoc = {
  teacherName?: string;
  sessionName?: string;
  code?: string;
};

type StudentDoc = {
  id: string;
  signal?: Signal;
  updatedAt?: Timestamp | { seconds?: number } | string | null;
};

type QuestionDoc = {
  id: string;
  text?: string;
  askedAt?: Timestamp | { seconds?: number } | string | null;
  upvotes?: number;
};

type MinutePoint = {
  key: string;
  label: string;
  got: number;
  sort: number;
  lost: number;
  total: number;
  date: Date;
};

type ProcessedAnalytics = {
  totalResponses: number;
  gotCount: number;
  sortCount: number;
  lostCount: number;
  gotPct: number;
  sortPct: number;
  lostPct: number;
  peakConfusion: string;
  peakLostCount: number;
  totalQuestions: number;
  totalStudentsConnected: number;
  activeParticipationRate: number;
  avgResponsesPerInterval: string;
  dropIntervals: string[];
  confusionAlerts: string[];
  timeline: MinutePoint[];
};

type InsightEngineResult = {
  source: string;
  generatedAt: string;
  insights: string[];
};

const SIGNAL_COLORS: Record<Signal, string> = {
  got_it: '#1D9E75',
  sort_of: '#C48A00',
  lost: '#D85A30',
};

const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'is',
  'are',
  'to',
  'of',
  'in',
  'on',
  'for',
  'and',
  'or',
  'with',
  'how',
  'why',
  'what',
  'when',
  'where',
  'can',
  'could',
  'would',
  'should',
  'i',
  'we',
  'you',
  'it',
  'this',
  'that',
  'from',
]);

function parseDate(value: StudentDoc['updatedAt'] | QuestionDoc['askedAt']): Date | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate();
  if (typeof value === 'object' && typeof value.seconds === 'number') {
    return new Date(value.seconds * 1000);
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function minuteKey(date: Date): string {
  const d = new Date(date);
  d.setSeconds(0, 0);
  return d.toISOString();
}

function toTimeLabel(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

async function fetchSessionBundle(sessionId: string): Promise<{
  session: SessionDoc;
  students: StudentDoc[];
  questions: QuestionDoc[];
}> {
  const sessionSnap = await getDoc(doc(db, 'sessions', sessionId));
  if (!sessionSnap.exists()) {
    throw new Error('Session not found.');
  }

  const sessionData = sessionSnap.data() as SessionDoc;

  const studentsSnap = await getDocs(collection(db, 'sessions', sessionId, 'students'));
  const students: StudentDoc[] = studentsSnap.docs.map((item) => {
    const data = item.data() as Omit<StudentDoc, 'id'>;
    return { id: item.id, ...data };
  });

  const questionsSnap = await getDocs(collection(db, 'sessions', sessionId, 'questions'));
  const questions: QuestionDoc[] = questionsSnap.docs.map((item) => {
    const data = item.data() as Omit<QuestionDoc, 'id'>;
    return { id: item.id, ...data };
  });

  return { session: sessionData, students, questions };
}

function processAnalytics(students: StudentDoc[], questions: QuestionDoc[]): ProcessedAnalytics {
  const validSignals = students.filter((student): student is StudentDoc & { signal: Signal } => {
    return student.signal === 'got_it' || student.signal === 'sort_of' || student.signal === 'lost';
  });

  const totalResponses = validSignals.length;
  const gotCount = validSignals.filter((s) => s.signal === 'got_it').length;
  const sortCount = validSignals.filter((s) => s.signal === 'sort_of').length;
  const lostCount = validSignals.filter((s) => s.signal === 'lost').length;

  const gotPct = totalResponses > 0 ? Math.round((gotCount / totalResponses) * 100) : 0;
  const sortPct = totalResponses > 0 ? Math.round((sortCount / totalResponses) * 100) : 0;
  const lostPct = totalResponses > 0 ? Math.round((lostCount / totalResponses) * 100) : 0;

  const timelineMap = new Map<string, MinutePoint>();

  validSignals
    .map((student) => ({ signal: student.signal, at: parseDate(student.updatedAt) }))
    .filter((entry): entry is { signal: Signal; at: Date } => entry.at !== null)
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .forEach((entry) => {
      const key = minuteKey(entry.at);
      const existing = timelineMap.get(key);
      if (!existing) {
        timelineMap.set(key, {
          key,
          label: toTimeLabel(entry.at),
          got: 0,
          sort: 0,
          lost: 0,
          total: 0,
          date: new Date(key),
        });
      }

      const point = timelineMap.get(key)!;
      if (entry.signal === 'got_it') point.got += 1;
      if (entry.signal === 'sort_of') point.sort += 1;
      if (entry.signal === 'lost') point.lost += 1;
      point.total += 1;
    });

  const timeline = [...timelineMap.values()].sort((a, b) => a.date.getTime() - b.date.getTime());

  let peakConfusion = 'No lost signals';
  let peakLostCount = 0;
  timeline.forEach((point) => {
    if (point.lost > peakLostCount) {
      peakLostCount = point.lost;
      peakConfusion = `${point.label}`;
    }
  });

  const totalStudentsConnected = students.length;
  const activeStudents = students.filter((s) => parseDate(s.updatedAt) !== null).length;
  const activeParticipationRate =
    totalStudentsConnected > 0
      ? Math.round((activeStudents / totalStudentsConnected) * 100)
      : 0;

  const avgResponsesPerInterval =
    timeline.length > 0 ? (totalResponses / timeline.length).toFixed(2) : '0.00';

  const dropThreshold = Math.max(1, Math.floor(Number(avgResponsesPerInterval) * 0.5));
  const dropIntervals = timeline
    .filter((point) => point.total <= dropThreshold)
    .map((point) => `Low activity at ${point.label}`);

  const confusionThreshold = Math.max(1, Math.ceil(totalResponses * 0.15));
  const confusionAlerts = timeline
    .filter((point) => point.lost >= confusionThreshold || point.lost >= 2)
    .map((point) => `High confusion at ${point.label} (${point.lost} lost)`);

  return {
    totalResponses,
    gotCount,
    sortCount,
    lostCount,
    gotPct,
    sortPct,
    lostPct,
    peakConfusion,
    peakLostCount,
    totalQuestions: questions.length,
    totalStudentsConnected,
    activeParticipationRate,
    avgResponsesPerInterval,
    dropIntervals,
    confusionAlerts,
    timeline,
  };
}

function generateAiInsights(model: ProcessedAnalytics): InsightEngineResult {
  const insights: string[] = [];

  if (model.lostPct > 40) {
    insights.push('Students struggled significantly. Revisit the toughest section with one worked example.');
  }
  if (model.sortPct >= 35) {
    insights.push('Sort of responses are high. Add a quick reinforcement checkpoint before new material.');
  }
  if (model.gotPct >= 60) {
    insights.push('Concept appears well understood. Proceed to the next objective with one challenge prompt.');
  }
  if (model.dropIntervals.length > 0) {
    insights.push('Participation dipped during parts of the session. Use shorter interaction cycles at those times.');
  }

  if (insights.length === 0) {
    insights.push('Signal distribution is balanced. Continue with periodic formative checks.');
  }

  return {
    source: 'rules-v1',
    generatedAt: new Date().toISOString(),
    insights,
  };
}

function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getQuestionThemes(questions: QuestionDoc[]): Array<{ label: string; count: number }> {
  const tokenCount = new Map<string, number>();

  questions.forEach((question) => {
    const normalized = normalizeQuestion(question.text ?? '');
    if (!normalized) return;

    normalized.split(' ').forEach((token) => {
      if (token.length < 4 || STOP_WORDS.has(token)) return;
      tokenCount.set(token, (tokenCount.get(token) ?? 0) + 1);
    });
  });

  return [...tokenCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([label, count]) => ({ label, count }));
}

function getTopQuestions(questions: QuestionDoc[]): Array<{ text: string; count: number; latestAt: Date | null }> {
  const grouped = new Map<string, { text: string; count: number; latestAt: Date | null }>();

  questions.forEach((question) => {
    const text = (question.text ?? '').trim();
    if (!text) return;

    const key = normalizeQuestion(text);
    const askedAt = parseDate(question.askedAt);

    if (!grouped.has(key)) {
      grouped.set(key, { text, count: 0, latestAt: askedAt });
    }

    const current = grouped.get(key)!;
    current.count += 1;

    if (askedAt && (!current.latestAt || askedAt.getTime() > current.latestAt.getTime())) {
      current.latestAt = askedAt;
    }
  });

  return [...grouped.values()]
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      const aTime = a.latestAt ? a.latestAt.getTime() : 0;
      const bTime = b.latestAt ? b.latestAt.getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, 8);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildReportHtml(params: {
  session: SessionDoc | null;
  sessionId?: string;
  reportTitle: string;
  analytics: ProcessedAnalytics;
  insights: InsightEngineResult;
  questions: Array<{ text: string; count: number; latestAt: Date | null }>;
  themes: Array<{ label: string; count: number }>;
}): string {
  const { session, sessionId, reportTitle, analytics, insights, questions, themes } = params;
  const generatedAt = new Date().toLocaleString();
  const insightItems = insights.insights
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join('');
  const questionItems =
    questions.length > 0
      ? questions
          .map((q) => {
            const latest = q.latestAt ? toTimeLabel(q.latestAt) : 'N/A';
            return `<li><strong>${escapeHtml(q.text)}</strong><br/><span>Frequency: ${q.count} | Latest: ${latest}</span></li>`;
          })
          .join('')
      : '<li>No questions recorded.</li>';
  const themeItems =
    themes.length > 0
      ? themes.map((t) => `<span class="tag">${escapeHtml(t.label)} (${t.count})</span>`).join('')
      : '<span class="muted">No recurring themes.</span>';
  const confusionItems =
    analytics.confusionAlerts.length > 0
      ? analytics.confusionAlerts.map((a) => `<li>${escapeHtml(a)}</li>`).join('')
      : '<li>No high-confusion intervals detected.</li>';
  const dropItems =
    analytics.dropIntervals.length > 0
      ? analytics.dropIntervals.map((d) => `<li>${escapeHtml(d)}</li>`).join('')
      : '<li>No low-activity intervals detected.</li>';

  return `
  <html>
    <head>
      <meta charset="utf-8" />
      <title>${escapeHtml(reportTitle)}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 24px; color: #1a1a18; }
        h1 { margin: 0 0 8px; font-size: 28px; }
        h2 { margin: 20px 0 10px; font-size: 16px; border-bottom: 1px solid #e3e6e2; padding-bottom: 6px; }
        p.meta { color: #657069; margin: 4px 0; }
        .grid { display: table; width: 100%; border-spacing: 8px; table-layout: fixed; }
        .row { display: table-row; }
        .card { display: table-cell; border: 1px solid #e2e7e2; border-radius: 8px; padding: 10px; vertical-align: top; }
        .label { font-size: 11px; color: #7b857e; text-transform: uppercase; }
        .value { font-size: 22px; font-weight: bold; margin-top: 6px; }
        .sub { font-size: 12px; color: #667068; margin-top: 4px; }
        ul { margin: 8px 0 0 18px; padding: 0; }
        li { margin-bottom: 8px; line-height: 1.4; }
        .tag { display: inline-block; border: 1px solid #dce5de; border-radius: 999px; padding: 4px 10px; margin: 0 6px 6px 0; font-size: 12px; }
        .muted { color: #7b857e; }
      </style>
    </head>
    <body>
      <h1>ClassPulse Session Analytics Report</h1>
      <p class="meta">Session: ${escapeHtml(session?.sessionName ?? 'Session')}</p>
      <p class="meta">Teacher: ${escapeHtml(session?.teacherName ?? 'Teacher')}</p>
      <p class="meta">Session ID: ${escapeHtml(sessionId ?? 'N/A')}</p>
      <p class="meta">Generated: ${escapeHtml(generatedAt)}</p>

      <h2>Summary</h2>
      <div class="grid">
        <div class="row">
          <div class="card"><div class="label">Total responses</div><div class="value">${analytics.totalResponses}</div><div class="sub">Students who responded</div></div>
          <div class="card"><div class="label">Got it</div><div class="value">${analytics.gotPct}%</div><div class="sub">${analytics.gotCount} responses</div></div>
          <div class="card"><div class="label">Sort of</div><div class="value">${analytics.sortPct}%</div><div class="sub">${analytics.sortCount} responses</div></div>
        </div>
        <div class="row">
          <div class="card"><div class="label">Lost</div><div class="value">${analytics.lostPct}%</div><div class="sub">${analytics.lostCount} responses</div></div>
          <div class="card"><div class="label">Peak confusion</div><div class="value">${escapeHtml(analytics.peakConfusion)}</div><div class="sub">${analytics.peakLostCount} lost at peak</div></div>
          <div class="card"><div class="label">Total questions</div><div class="value">${analytics.totalQuestions}</div><div class="sub">Questions captured</div></div>
        </div>
      </div>

      <h2>Engagement Analytics</h2>
      <ul>
        <li>Total students connected: ${analytics.totalStudentsConnected}</li>
        <li>Active participation rate: ${analytics.activeParticipationRate}%</li>
        <li>Response frequency: ${analytics.avgResponsesPerInterval} responses per interval</li>
      </ul>

      <h2>Low Activity Intervals</h2>
      <ul>${dropItems}</ul>

      <h2>Confusion Alerts</h2>
      <ul>${confusionItems}</ul>

      <h2>AI Insights & Suggestions</h2>
      <ul>${insightItems}</ul>

      <h2>Question Themes</h2>
      <div>${themeItems}</div>

      <h2>Top Questions</h2>
      <ul>${questionItems}</ul>
    </body>
  </html>
  `;
}

function formatDateForFile(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function sanitizeFilePart(value: string | undefined, fallback: string): string {
  const cleaned = (value || fallback)
    .trim()
    .replace(/[^a-z0-9\-\s]/gi, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned || fallback;
}

function buildPdfFilename(session: SessionDoc | null): string {
  const sessionName = sanitizeFilePart(session?.sessionName, 'Session');
  const teacherName = sanitizeFilePart(session?.teacherName, 'Faculty');
  const datePart = formatDateForFile(new Date());
  return `${sessionName}-${teacherName}-${datePart}.pdf`;
}

function SummaryCard({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'good' | 'sort' | 'lost' }) {
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text
        style={[
          styles.summaryValue,
          tone === 'good' && { color: SIGNAL_COLORS.got_it },
          tone === 'sort' && { color: SIGNAL_COLORS.sort_of },
          tone === 'lost' && { color: SIGNAL_COLORS.lost },
        ]}
      >
        {value}
      </Text>
      <Text style={styles.summarySub}>{sub}</Text>
    </View>
  );
}

function EngagementRow({ title, value }: { title: string; value: string }) {
  return (
    <View style={styles.itemRow}>
      <Text style={styles.itemTitle}>{title}</Text>
      <Text style={styles.itemSub}>{value}</Text>
    </View>
  );
}

function LineTrendChart({
  timeline,
  emptyLabel,
  gotLabel,
  sortLabel,
  lostLabel,
}: {
  timeline: MinutePoint[];
  emptyLabel: string;
  gotLabel: string;
  sortLabel: string;
  lostLabel: string;
}) {
  const [chartWidth, setChartWidth] = useState(0);
  const chartHeight = 230;
  const padding = { top: 16, right: 10, bottom: 30, left: 26 };

  const maxY = useMemo(() => {
    if (timeline.length === 0) return 1;
    const maxValue = Math.max(...timeline.map((point) => Math.max(point.got, point.sort, point.lost)));
    return Math.max(1, maxValue);
  }, [timeline]);

  function onLayout(event: LayoutChangeEvent) {
    setChartWidth(event.nativeEvent.layout.width);
  }

  function buildPoints(values: number[]): string {
    if (chartWidth === 0 || values.length === 0) return '';
    const width = chartWidth - padding.left - padding.right;
    const height = chartHeight - padding.top - padding.bottom;
    const step = values.length > 1 ? width / (values.length - 1) : 0;

    return values
      .map((value, index) => {
        const x = padding.left + step * index;
        const y = padding.top + height - (value / maxY) * height;
        return `${x},${y}`;
      })
      .join(' ');
  }

  const gotValues = timeline.map((point) => point.got);
  const sortValues = timeline.map((point) => point.sort);
  const lostValues = timeline.map((point) => point.lost);

  const xLabels = useMemo(() => {
    if (timeline.length === 0) return [] as Array<{ x: number; label: string }>;
    const width = chartWidth - padding.left - padding.right;
    const step = timeline.length > 1 ? width / (timeline.length - 1) : 0;
    const labelSkip = timeline.length > 8 ? Math.ceil(timeline.length / 6) : 1;

    return timeline
      .map((point, index) => ({
        x: padding.left + step * index,
        label: point.label,
        index,
      }))
      .filter((item) => item.index % labelSkip === 0 || item.index === timeline.length - 1)
      .map(({ x, label }) => ({ x, label }));
  }, [chartWidth, timeline]);

  const yTicks = [0, Math.ceil(maxY / 3), Math.ceil((2 * maxY) / 3), maxY];

  const spikeIndexes = timeline
    .map((point, index) => ({ point, index }))
    .filter((entry) => entry.point.lost >= 2 || entry.point.lost === maxY)
    .map((entry) => entry.index);

  return (
    <View style={styles.chartShell} onLayout={onLayout}>
      {chartWidth > 0 && timeline.length > 0 && (
        <Svg width={chartWidth} height={chartHeight}>
          <G>
            {yTicks.map((tick, idx) => {
              const height = chartHeight - padding.top - padding.bottom;
              const y = padding.top + height - (tick / maxY) * height;
              return (
                <G key={`tick-${idx}`}>
                  <Line x1={padding.left} y1={y} x2={chartWidth - padding.right} y2={y} stroke="#E4E8E2" strokeWidth={1} />
                  <SvgText x={4} y={y + 4} fill="#98A09A" fontSize="10">
                    {tick}
                  </SvgText>
                </G>
              );
            })}

            <Polyline points={buildPoints(gotValues)} fill="none" stroke={SIGNAL_COLORS.got_it} strokeWidth={2.5} />
            <Polyline points={buildPoints(sortValues)} fill="none" stroke={SIGNAL_COLORS.sort_of} strokeWidth={2.5} />
            <Polyline points={buildPoints(lostValues)} fill="none" stroke={SIGNAL_COLORS.lost} strokeWidth={2.8} />

            {spikeIndexes.map((index) => {
              const width = chartWidth - padding.left - padding.right;
              const height = chartHeight - padding.top - padding.bottom;
              const step = timeline.length > 1 ? width / (timeline.length - 1) : 0;
              const x = padding.left + step * index;
              const y = padding.top + height - (lostValues[index] / maxY) * height;

              return <Circle key={`spike-${index}`} cx={x} cy={y} r={4} fill={SIGNAL_COLORS.lost} />;
            })}

            {xLabels.map((item, idx) => (
              <SvgText key={`xlabel-${idx}`} x={item.x} y={chartHeight - 8} fill="#98A09A" fontSize="10" textAnchor="middle">
                {item.label}
              </SvgText>
            ))}
          </G>
        </Svg>
      )}

      {timeline.length === 0 && (
        <View style={styles.emptyChart}>
          <Text style={styles.emptyChartText}>{emptyLabel}</Text>
        </View>
      )}

      <View style={styles.legendRow}>
        <LegendDot label={gotLabel} color={SIGNAL_COLORS.got_it} />
        <LegendDot label={sortLabel} color={SIGNAL_COLORS.sort_of} />
        <LegendDot label={lostLabel} color={SIGNAL_COLORS.lost} />
      </View>
    </View>
  );
}

function LegendDot({ label, color }: { label: string; color: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

export default function AnalysisScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId?: string }>();
  const { i18n } = useI18n();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [exporting, setExporting] = useState(false);
  const [session, setSession] = useState<SessionDoc | null>(null);
  const [students, setStudents] = useState<StudentDoc[]>([]);
  const [questions, setQuestions] = useState<QuestionDoc[]>([]);

  useEffect(() => {
    async function load() {
      if (!sessionId) {
        setError(i18n.t('analyticsLoadMissingId'));
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const bundle = await fetchSessionBundle(sessionId);
        setSession(bundle.session);
        setStudents(bundle.students);
        setQuestions(bundle.questions);
      } catch (err) {
        const message = err instanceof Error ? err.message : i18n.t('analyticsLoadFailed');
        setError(message);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [sessionId]);

  const processed = useMemo(() => processAnalytics(students, questions), [students, questions]);
  const insights = useMemo(() => generateAiInsights(processed), [processed]);
  const topQuestions = useMemo(() => getTopQuestions(questions), [questions]);
  const themes = useMemo(() => getQuestionThemes(questions), [questions]);

  async function handleDownloadPdf() {
    try {
      setExporting(true);
      const reportFilename = buildPdfFilename(session);
      const reportTitle = reportFilename.replace(/\.pdf$/i, '');
      const html = buildReportHtml({
        session,
        sessionId,
        reportTitle,
        analytics: processed,
        insights,
        questions: topQuestions,
        themes,
      });

      if (Platform.OS === 'web') {
        await Print.printAsync({ html });
        return;
      }

      const file = await Print.printToFileAsync({ html });
      const destinationUri = `${FileSystemLegacy.cacheDirectory}${reportFilename}`;

      try {
        await FileSystemLegacy.copyAsync({ from: file.uri, to: destinationUri });
      } catch {
        // If a file with same name exists, append epoch timestamp.
        const fallbackUri = `${FileSystemLegacy.cacheDirectory}${reportFilename.replace(/\.pdf$/i, '')}-${Date.now()}.pdf`;
        await FileSystemLegacy.copyAsync({ from: file.uri, to: fallbackUri });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(fallbackUri, {
            mimeType: 'application/pdf',
            UTI: '.pdf',
            dialogTitle: reportFilename,
          });
          return;
        }
        Alert.alert(i18n.t('pdfReadyTitle'), i18n.t('pdfReadyPath', { path: fallbackUri }));
        return;
      }

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(destinationUri, {
          mimeType: 'application/pdf',
          UTI: '.pdf',
          dialogTitle: reportFilename,
        });
      } else {
        Alert.alert(i18n.t('pdfReadyTitle'), i18n.t('pdfReadyPath', { path: destinationUri }));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : i18n.t('pdfExportFailedBody');
      Alert.alert(i18n.t('pdfExportFailed'), message);
    } finally {
      setExporting(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#1A1A18" />
          <Text style={styles.loadingText}>{i18n.t('loadingAnalytics')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <LanguageSwitcher />
        <View style={styles.header}>
          <View style={styles.headerTopRow}>
            <View style={styles.headerCopy}>
              <Text style={styles.badge}>{i18n.t('sessionAnalytics')}</Text>
              <Text style={styles.title}>{session?.sessionName ?? i18n.t('sessionFallback')}</Text>
              <Text style={styles.subtitle}>
                {(session?.teacherName ?? i18n.t('teacherFallback'))} · {i18n.t('codeLabel', { code: session?.code ?? '--' })}
              </Text>
            </View>
            <TouchableOpacity
              onPress={handleDownloadPdf}
              style={[styles.downloadBtn, exporting && styles.downloadBtnDisabled]}
              disabled={exporting}
            >
              <Text style={styles.downloadBtnText}>{exporting ? i18n.t('preparing') : i18n.t('downloadPdf')}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.summaryGrid}>
          <SummaryCard label={i18n.t('totalResponses')} value={`${processed.totalResponses}`} sub={i18n.t('studentsWhoResponded')} />
          <SummaryCard label={i18n.t('gotIt')} value={`${processed.gotPct}%`} sub={i18n.t('responsesCount', { count: processed.gotCount })} tone="good" />
          <SummaryCard label={i18n.t('sortOf')} value={`${processed.sortPct}%`} sub={i18n.t('responsesCount', { count: processed.sortCount })} tone="sort" />
          <SummaryCard label={i18n.t('lost')} value={`${processed.lostPct}%`} sub={i18n.t('responsesCount', { count: processed.lostCount })} tone="lost" />
          <SummaryCard
            label={i18n.t('peakConfusion')}
            value={processed.peakConfusion}
            sub={i18n.t('lostAtPeak', { count: processed.peakLostCount })}
          />
          <SummaryCard label={i18n.t('totalQuestions')} value={`${processed.totalQuestions}`} sub={i18n.t('questionsCaptured')} />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{i18n.t('responseTrend')}</Text>
          <LineTrendChart
            timeline={processed.timeline}
            emptyLabel={i18n.t('noTimestampedResponses')}
            gotLabel={i18n.t('gotIt')}
            sortLabel={i18n.t('sortOf')}
            lostLabel={i18n.t('lost')}
          />
          <Text style={styles.caption}>{i18n.t('chartCaption')}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{i18n.t('engagementAnalytics')}</Text>
          <EngagementRow title={i18n.t('totalStudentsConnected')} value={`${processed.totalStudentsConnected}`} />
          <EngagementRow title={i18n.t('activeParticipationRate')} value={`${processed.activeParticipationRate}%`} />
          <EngagementRow
            title={i18n.t('responseFrequencyOverTime')}
            value={i18n.t('responsesPerInterval', { value: processed.avgResponsesPerInterval })}
          />
          <View style={styles.inlineList}>
            {processed.dropIntervals.length > 0 ? (
              processed.dropIntervals.map((interval) => (
                <View key={interval} style={styles.alertPillMuted}>
                  <Text style={styles.alertTextMuted}>{interval}</Text>
                </View>
              ))
            ) : (
              <View style={styles.alertPillMuted}>
                <Text style={styles.alertTextMuted}>{i18n.t('noDropIntervals')}</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{i18n.t('confusionDetection')}</Text>
          <View style={styles.inlineList}>
            {processed.confusionAlerts.length > 0 ? (
              processed.confusionAlerts.map((alert) => (
                <View key={alert} style={styles.alertPill}>
                  <Text style={styles.alertText}>⚠ {alert}</Text>
                </View>
              ))
            ) : (
              <View style={styles.alertPillOk}>
                <Text style={styles.alertTextOk}>{i18n.t('noHighConfusionIntervals')}</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{i18n.t('aiInsights')}</Text>
          {insights.insights.map((insight) => (
            <View key={insight} style={styles.insightBox}>
              <Text style={styles.insightText}>{insight}</Text>
            </View>
          ))}
          <Text style={styles.caption}>{i18n.t('engineCaption', { source: insights.source })}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{i18n.t('questionsAnalysis')}</Text>

          <View style={styles.themeWrap}>
            {themes.length > 0 ? (
              themes.map((theme) => (
                <View key={theme.label} style={styles.themeTag}>
                  <Text style={styles.themeTagText}>
                    {theme.label} ({theme.count})
                  </Text>
                </View>
              ))
            ) : (
              <Text style={styles.emptyText}>{i18n.t('noThemesYet')}</Text>
            )}
          </View>

          <View style={styles.inlineList}>
            {topQuestions.length > 0 ? (
              topQuestions.map((question, index) => (
                <View key={`${question.text}-${index}`} style={styles.questionItem}>
                  <Text style={styles.questionText}>{question.text}</Text>
                  <Text style={styles.questionMeta}>
                    {i18n.t('frequency', { count: question.count })}
                    {question.latestAt ? ` · ${i18n.t('latestAt', { time: toTimeLabel(question.latestAt) })}` : ''}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={styles.emptyText}>{i18n.t('noQuestionsThisSession')}</Text>
            )}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#F7F5F0',
  },
  scroll: {
    padding: 20,
    paddingBottom: 36,
    gap: 14,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 12,
  },
  loadingText: {
    color: '#7F867F',
    fontSize: 14,
  },
  errorText: {
    color: '#D85A30',
    fontSize: 15,
    textAlign: 'center',
  },
  header: {
    marginBottom: 4,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  headerCopy: {
    flex: 1,
  },
  badge: {
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: '700',
    color: '#1D9E75',
    marginBottom: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1A1A18',
  },
  subtitle: {
    fontSize: 13,
    color: '#8A908A',
    marginTop: 4,
  },
  downloadBtn: {
    backgroundColor: '#1A1A18',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minWidth: 110,
    alignItems: 'center',
  },
  downloadBtnDisabled: {
    backgroundColor: '#8A908A',
  },
  downloadBtnText: {
    color: '#F7F5F0',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E0E5DF',
    padding: 12,
    width: '48%',
  },
  summaryLabel: {
    fontSize: 11,
    color: '#8F968F',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  summaryValue: {
    marginTop: 8,
    fontSize: 22,
    fontWeight: '700',
    color: '#1A1A18',
  },
  summarySub: {
    marginTop: 6,
    fontSize: 12,
    color: '#8A908A',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E0E5DF',
    padding: 14,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 12,
    color: '#8A908A',
    textTransform: 'uppercase',
    letterSpacing: 0.9,
    fontWeight: '600',
  },
  chartShell: {
    width: '100%',
  },
  emptyChart: {
    borderWidth: 1,
    borderColor: '#E0E5DF',
    borderRadius: 10,
    padding: 18,
    alignItems: 'center',
  },
  emptyChartText: {
    color: '#8A908A',
    fontSize: 13,
  },
  legendRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    justifyContent: 'center',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 99,
  },
  legendLabel: {
    fontSize: 12,
    color: '#6F7872',
  },
  caption: {
    fontSize: 12,
    color: '#8A908A',
  },
  itemRow: {
    borderWidth: 1,
    borderColor: '#E5EAE5',
    borderRadius: 10,
    padding: 10,
    backgroundColor: '#FBFCFB',
    gap: 4,
  },
  itemTitle: {
    fontSize: 14,
    color: '#1A1A18',
    fontWeight: '600',
  },
  itemSub: {
    fontSize: 12,
    color: '#7E857E',
  },
  inlineList: {
    gap: 8,
  },
  alertPill: {
    backgroundColor: '#FDECEA',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#F8D7CE',
    padding: 10,
  },
  alertText: {
    color: '#D85A30',
    fontWeight: '600',
    fontSize: 13,
  },
  alertPillOk: {
    backgroundColor: '#E8F7F1',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CCEBDD',
    padding: 10,
  },
  alertTextOk: {
    color: '#1D9E75',
    fontWeight: '600',
    fontSize: 13,
  },
  alertPillMuted: {
    backgroundColor: '#F1F4F1',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E0E5DF',
    padding: 10,
  },
  alertTextMuted: {
    color: '#6F7872',
    fontWeight: '500',
    fontSize: 13,
  },
  insightBox: {
    borderWidth: 1,
    borderColor: '#DCE5DE',
    borderLeftWidth: 4,
    borderLeftColor: '#2C6048',
    borderRadius: 10,
    padding: 10,
    backgroundColor: '#EEF4F0',
  },
  insightText: {
    color: '#244C39',
    fontSize: 13,
    lineHeight: 19,
  },
  themeWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  themeTag: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#DDE7DF',
    backgroundColor: '#F3F7F4',
  },
  themeTagText: {
    fontSize: 12,
    color: '#335643',
    fontWeight: '500',
  },
  questionItem: {
    borderWidth: 1,
    borderColor: '#E0E5DF',
    borderRadius: 10,
    padding: 10,
    backgroundColor: '#FBFCFB',
    gap: 4,
  },
  questionText: {
    color: '#1A1A18',
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '500',
  },
  questionMeta: {
    color: '#7E857E',
    fontSize: 12,
  },
  emptyText: {
    fontSize: 13,
    color: '#8A908A',
  },
});
