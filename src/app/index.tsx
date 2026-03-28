import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, SafeAreaView, ScrollView, StatusBar
} from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from "../firebase";
import AsyncStorage from '@react-native-async-storage/async-storage';


function generate4DigitCode() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

export default function TeacherSetup() {
  const router = useRouter();
  const [teacherName, setTeacherName] = useState('');
  const [sessionName, setSessionName] = useState('');
  const [alertThreshold, setAlertThreshold] = useState('40');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    if (!teacherName.trim() || !sessionName.trim()) {
      setError('Please fill in your name and session name.');
      return;
    }

    const threshold = parseInt(alertThreshold);
    if (isNaN(threshold) || threshold < 1 || threshold > 100) {
      setError('Alert threshold must be between 1 and 100.');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const code = generate4DigitCode();

      // Save session to Firestore
      const sessionRef = await addDoc(collection(db, 'sessions'), {
        teacherName: teacherName.trim(),
        sessionName: sessionName.trim(),
        alertThreshold: threshold,
        code,
        createdAt: serverTimestamp(),
        active: false,
        students: {},        // { studentId: { signal, question } }
        questions: [],       // anonymous question queue
      });

      const sessionData = {
  sessionId: sessionRef.id,
  code,
  sessionName: sessionName.trim(),
  teacherName: teacherName.trim(),
  alertThreshold: threshold.toString(),
};

      // Navigate to QR screen with session details
      // 1. Save to AsyncStorage
await AsyncStorage.setItem('currentSession', JSON.stringify(sessionData));
console.log('✅ AsyncStorage saved, navigating now...');

// 2. Navigate without any params
router.push('/session-code' as any);
console.log('✅ router.push called');
    } catch (e) {
      setError('Could not create session. Check your connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.badge}>TEACHER</Text>
          <Text style={styles.title}>New Session</Text>
          <Text style={styles.subtitle}>
            Students join anonymously — you see only the room.
          </Text>
        </View>

        {/* Form */}
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

          <TouchableOpacity
            style={[styles.createBtn, loading && styles.createBtnDisabled]}
            onPress={handleCreate}
            activeOpacity={0.85}
            disabled={loading}
          >
            <Text style={styles.createBtnText}>
              {loading ? 'Creating…' : 'Create Session →'}
            </Text>
          </TouchableOpacity>

        </View>

        {/* Footer note */}
        <Text style={styles.footerNote}>
          Students don't need an account or app — just a browser and the code.
        </Text>

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
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingTop: 48,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 40,
  },
  badge: {
    fontSize: 11,
    letterSpacing: 2.5,
    color: '#1D9E75',
    fontWeight: '600',
    marginBottom: 10,
  },
  title: {
    fontSize: 32,
    fontWeight: '600',
    color: '#1A1A18',
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: '#888780',
    lineHeight: 22,
  },
  form: {
    gap: 24,
  },
  field: {
    gap: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
    color: '#444441',
    letterSpacing: 0.2,
  },
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
  thresholdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  thresholdInput: {
    width: 90,
  },
  percentLabel: {
    fontSize: 18,
    color: '#444441',
    fontWeight: '500',
  },
  hint: {
    fontSize: 12,
    color: '#AEACA6',
    lineHeight: 18,
  },
  error: {
    fontSize: 13,
    color: '#D85A30',
    backgroundColor: '#FAECE7',
    padding: 12,
    borderRadius: 8,
  },
  createBtn: {
    backgroundColor: '#1A1A18',
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: 8,
  },
  createBtnDisabled: {
    backgroundColor: '#888780',
  },
  createBtnText: {
    color: '#F7F5F0',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  footerNote: {
    marginTop: 36,
    fontSize: 12,
    color: '#AEACA6',
    textAlign: 'center',
    lineHeight: 18,
  },
});