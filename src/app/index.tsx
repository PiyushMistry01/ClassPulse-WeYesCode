import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { useState } from 'react';
import {
  Alert,
  Linking,
  Modal,
  Platform,
  SafeAreaView, ScrollView, StatusBar,
  StyleSheet,
  Text, TextInput, TouchableOpacity,
  View,
} from 'react-native';
import { db } from '../firebase';

function generate4DigitCode() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

const hotspotSteps = [
  {
    num: '1',
    title: 'Turn on Mobile Hotspot',
    detail: Platform.OS === 'android'
      ? 'Settings → Network & Internet → Hotspot & Tethering → Mobile Hotspot'
      : 'Settings → Personal Hotspot → Allow Others to Join',
  },
  {
    num: '2',
    title: 'Note your hotspot name & password',
    detail: 'Students will need these to connect via Wi-Fi. You can find them in the hotspot settings screen.',
  },
  {
    num: '3',
    title: 'Ask students to connect',
    detail: 'Students open Wi-Fi on their phone → select your hotspot name → enter the password. No SIM card needed on their phones.',
  },
  {
    num: '4',
    title: 'Keep your phone plugged in',
    detail: 'Hotspot drains battery faster than normal. A charger or power bank will keep the session running.',
  },
];

export default function TeacherSetup() {
  const router = useRouter();
  const [teacherName, setTeacherName]           = useState('');
  const [sessionName, setSessionName]           = useState('');
  const [contextRaw, setContextRaw]             = useState('');
  const [alertThreshold, setAlertThreshold]     = useState('40');
  const [loading, setLoading]                   = useState(false);
  const [offlineLoading, setOfflineLoading]     = useState(false);
  const [error, setError]                       = useState('');
  const [showHotspotModal, setShowHotspotModal] = useState(false);

  function validate(): boolean {
    if (!teacherName.trim() || !sessionName.trim()) {
      setError('Please fill in your name and session name.');
      return false;
    }
    const threshold = parseInt(alertThreshold);
    if (isNaN(threshold) || threshold < 1 || threshold > 100) {
      setError('Alert threshold must be between 1 and 100.');
      return false;
    }
    setError('');
    return true;
  }

  // Shared session creation — used by both online and offline buttons
  async function createSession(isOffline: boolean) {
    const code                 = generate4DigitCode();
    const threshold            = parseInt(alertThreshold);
    const normalizedContextRaw = contextRaw.trim().slice(0, 1000);

    const sessionRef = await addDoc(collection(db, 'sessions'), {
      teacherName:    teacherName.trim(),
      sessionName:    sessionName.trim(),
      alertThreshold: threshold,
      code,
      createdAt:      serverTimestamp(),
      active:         false,
      isOffline,
      contextRaw:     normalizedContextRaw,
      students:       {},
      questions:      [],
    });

    // Context analysis runs in background — does not block session creation
    if (normalizedContextRaw) {
      void (async () => {
        try {
          const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
          if (!apiBaseUrl) {
            console.warn('EXPO_PUBLIC_API_BASE_URL is missing; skipping context extraction');
            return;
          }
          const res = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/extract-context`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ contextRaw: normalizedContextRaw }),
          });
          if (!res.ok) throw new Error(`extract-context failed: ${res.status}`);
          const data    = (await res.json()) as { topics?: unknown; summary?: unknown; purpose?: unknown };
          const topics  = Array.isArray(data.topics)
            ? data.topics.filter((item): item is string => typeof item === 'string')
            : [];
          const summary = typeof data.summary === 'string' ? data.summary : '';
          const purpose = typeof data.purpose === 'string' ? data.purpose : '';
          if (!topics.length && !summary && !purpose) return;
          await updateDoc(doc(db, 'sessions', sessionRef.id), {
            contextTopics:  topics,
            contextSummary: summary,
            contextPurpose: purpose,
          });
        } catch (analysisError) {
          console.warn('Context analysis failed:', analysisError);
        }
      })();
    }

    const sessionData = {
      sessionId:      sessionRef.id,
      code,
      sessionName:    sessionName.trim(),
      teacherName:    teacherName.trim(),
      alertThreshold: threshold.toString(),
      alertMins:      '15',
      isOffline:      isOffline ? 'true' : 'false',
    };

    await AsyncStorage.setItem('currentSession', JSON.stringify(sessionData));
    console.log('✅ AsyncStorage saved, navigating now...');
    router.push('/session-code' as any);
    console.log('✅ router.push called');
  }

  // Online session
  const handleCreate = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      await createSession(false);
    } catch (e: any) {
      console.error('Error creating session:', e);
      setError('Could not create session. Check your connection.');
    } finally {
      setLoading(false);
    }
  };

  // Step 1: validate → show hotspot modal
  const handleOfflinePress = () => {
    if (!validate()) return;
    setShowHotspotModal(true);
  };

  // Step 2: teacher confirms hotspot is on → create session
  const handleOfflineCreate = async () => {
    setShowHotspotModal(false);
    setOfflineLoading(true);
    try {
      await createSession(true);
    } catch (e: any) {
      console.error('Offline session error:', e);
      Alert.alert(
        'Connection Error',
        'Could not reach the server. Make sure your mobile data is turned on — students use your hotspot, but you still need data to sync.',
        [{ text: 'OK' }]
      );
    } finally {
      setOfflineLoading(false);
    }
  };

  const openSettings = () => {
    if (Platform.OS === 'android') {
      Linking.sendIntent('android.settings.WIRELESS_SETTINGS').catch(() =>
        Linking.openSettings()
      );
    } else {
      Linking.openSettings();
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />

      {/* Hotspot Setup Modal */}
      <Modal visible={showHotspotModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <ScrollView showsVerticalScrollIndicator={false}>

              <Text style={styles.modalBadge}>OFFLINE MODE</Text>
              <Text style={styles.modalTitle}>Set up your hotspot</Text>
              <Text style={styles.modalSub}>
                Students connect to your phone's Wi-Fi. You still need mobile data — students don't.
              </Text>

              <View style={styles.needsBox}>
                <Text style={styles.needsTitle}>WHAT YOU NEED</Text>
                {[
                  'Your phone with mobile data turned on',
                  "Students' phones with Wi-Fi (no SIM needed)",
                  'Hotspot enabled on your phone (steps below)',
                ].map((item, i) => (
                  <View key={i} style={styles.needsRow}>
                    <View style={styles.needsDot} />
                    <Text style={styles.needsText}>{item}</Text>
                  </View>
                ))}
              </View>

              {hotspotSteps.map((step, i) => (
                <View key={i} style={styles.stepCard}>
                  <View style={styles.stepNumBox}>
                    <Text style={styles.stepNumText}>{step.num}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.stepTitle}>{step.title}</Text>
                    <Text style={styles.stepDetail}>{step.detail}</Text>
                  </View>
                </View>
              ))}

              <TouchableOpacity style={styles.settingsBtn} onPress={openSettings}>
                <Text style={styles.settingsBtnText}>Open Phone Settings →</Text>
              </TouchableOpacity>
              <Text style={styles.settingsHint}>
                Tap above to open Settings, turn on hotspot, then come back here.
              </Text>

              <TouchableOpacity
                style={styles.confirmBtn}
                onPress={handleOfflineCreate}
                activeOpacity={0.85}
              >
                <Text style={styles.confirmBtnText}>
                  Hotspot is on — Create Session →
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setShowHotspotModal(false)}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>

            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Main Form */}
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        <View style={styles.header}>
          <Text style={styles.badge}>TEACHER</Text>
          <Text style={styles.title}>New Session</Text>
          <Text style={styles.subtitle}>
            Students join anonymously — you see only the room.
          </Text>
        </View>

        <View style={styles.form}>

          <View style={styles.field}>
            <Text style={styles.label}>Your name</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Mrs. Sharma"
              placeholderTextColor="#AEACA6"
              value={teacherName}
              onChangeText={setTeacherName}
              autoCapitalize="words"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Session name</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Chapter 4 — Fractions"
              placeholderTextColor="#AEACA6"
              value={sessionName}
              onChangeText={setSessionName}
              autoCapitalize="sentences"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>What are you going to teach today?</Text>
            <TextInput
              style={[styles.input, styles.contextInput]}
              placeholder="Example: Today I will explain pointers, memory and arrays"
              placeholderTextColor="#AEACA6"
              value={contextRaw}
              onChangeText={setContextRaw}
              multiline
              numberOfLines={4}
              maxLength={1000}
              textAlignVertical="top"
            />
            <Text style={styles.hint}>
              This helps auto-tag session topics and filter student questions.
            </Text>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Alert me when Lost exceeds</Text>
            <View style={styles.thresholdRow}>
              <TextInput
                style={[styles.input, styles.thresholdInput]}
                placeholder="40"
                placeholderTextColor="#AEACA6"
                value={alertThreshold}
                onChangeText={setAlertThreshold}
                keyboardType="number-pad"
                maxLength={3}
              />
              <Text style={styles.percentLabel}>%</Text>
            </View>
            <Text style={styles.hint}>
              You'll get a gentle nudge when this many students are lost.
            </Text>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {/* Online session button */}
          <TouchableOpacity
            style={[styles.createBtn, (loading || offlineLoading) && styles.btnDisabled]}
            onPress={handleCreate}
            activeOpacity={0.85}
            disabled={loading || offlineLoading}
          >
            <Text style={styles.createBtnText}>
              {loading ? 'Creating…' : 'Create Session →'}
            </Text>
          </TouchableOpacity>

          {/* Divider */}
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>no classroom wi-fi?</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* Offline session button */}
          <TouchableOpacity
            style={[styles.offlineBtn, (loading || offlineLoading) && styles.btnDisabled]}
            onPress={handleOfflinePress}
            activeOpacity={0.85}
            disabled={loading || offlineLoading}
          >
            <View>
              <Text style={styles.offlineBtnTitle}>
                {offlineLoading ? 'Setting up…' : '📶  Create Offline Session'}
              </Text>
              <Text style={styles.offlineBtnSub}>
                Use your mobile hotspot — students join without a SIM card
              </Text>
            </View>
          </TouchableOpacity>

        </View>

        <Text style={styles.footerNote}>
          Students don't need an account or app — just a browser and the code.
        </Text>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: '#F7F5F0' },
  scroll:   { flexGrow: 1, paddingHorizontal: 28, paddingTop: 48, paddingBottom: 40 },
  header:   { marginBottom: 40 },
  badge:    { fontSize: 11, letterSpacing: 2.5, color: '#1D9E75', fontWeight: '600', marginBottom: 10 },
  title:    { fontSize: 32, fontWeight: '600', color: '#1A1A18', letterSpacing: -0.5, marginBottom: 8 },
  subtitle: { fontSize: 15, color: '#888780', lineHeight: 22 },
  form:     { gap: 24 },
  field:    { gap: 8 },
  label:    { fontSize: 13, fontWeight: '500', color: '#444441', letterSpacing: 0.2 },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E0DDD7',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#1A1A18',
  },
  contextInput:   { minHeight: 112 },
  thresholdRow:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  thresholdInput: { width: 90 },
  percentLabel:   { fontSize: 18, color: '#444441', fontWeight: '500' },
  hint:           { fontSize: 12, color: '#AEACA6', lineHeight: 18 },
  error:          { fontSize: 13, color: '#D85A30', backgroundColor: '#FAECE7', padding: 12, borderRadius: 8 },

  createBtn:     { backgroundColor: '#1A1A18', borderRadius: 14, paddingVertical: 18, alignItems: 'center' },
  createBtnText: { color: '#F7F5F0', fontSize: 16, fontWeight: '600', letterSpacing: 0.2 },
  btnDisabled:   { opacity: 0.5 },

  dividerRow:  { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: -4 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#E0DDD7' },
  dividerText: { fontSize: 11, color: '#AEACA6', letterSpacing: 0.3 },

  offlineBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderWidth: 1.5,
    borderColor: '#1D9E75',
    gap: 3,
  },
  offlineBtnTitle: { fontSize: 15, fontWeight: '600', color: '#0F6E56' },
  offlineBtnSub:   { fontSize: 12, color: '#1D9E75' },

  footerNote: { marginTop: 36, fontSize: 12, color: '#AEACA6', textAlign: 'center', lineHeight: 18 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: '#F7F5F0',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 28,
    maxHeight: '92%',
  },
  modalBadge: { fontSize: 11, letterSpacing: 2.5, color: '#1D9E75', fontWeight: '700', marginBottom: 8 },
  modalTitle: { fontSize: 24, fontWeight: '700', color: '#1A1A18', letterSpacing: -0.3, marginBottom: 8 },
  modalSub:   { fontSize: 14, color: '#888780', lineHeight: 22, marginBottom: 20 },

  needsBox: {
    backgroundColor: '#E1F5EE',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#9FE1CB',
    gap: 8,
  },
  needsTitle: { fontSize: 11, fontWeight: '700', color: '#085041', letterSpacing: 0.5, marginBottom: 2 },
  needsRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  needsDot:   { width: 6, height: 6, borderRadius: 3, backgroundColor: '#1D9E75', marginTop: 6, flexShrink: 0 },
  needsText:  { fontSize: 13, color: '#0F6E56', flex: 1, lineHeight: 20 },

  stepCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E0DDD7',
  },
  stepNumBox:  { width: 28, height: 28, borderRadius: 7, backgroundColor: '#1A1A18', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  stepNumText: { fontSize: 13, fontWeight: '700', color: '#F7F5F0' },
  stepTitle:   { fontSize: 13, fontWeight: '600', color: '#1A1A18', marginBottom: 3 },
  stepDetail:  { fontSize: 12, color: '#888780', lineHeight: 18 },

  settingsBtn: {
    backgroundColor: '#F7F5F0',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#1A1A18',
    marginTop: 8,
    marginBottom: 6,
  },
  settingsBtnText: { fontSize: 14, fontWeight: '600', color: '#1A1A18' },
  settingsHint:    { fontSize: 12, color: '#AEACA6', textAlign: 'center', marginBottom: 20, lineHeight: 18 },

  confirmBtn:     { backgroundColor: '#1A1A18', borderRadius: 14, paddingVertical: 18, alignItems: 'center', marginBottom: 10 },
  confirmBtnText: { color: '#F7F5F0', fontSize: 15, fontWeight: '700' },
  cancelBtn:      { paddingVertical: 14, alignItems: 'center' },
  cancelBtnText:  { fontSize: 14, color: '#888780' },
});