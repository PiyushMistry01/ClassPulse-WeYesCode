import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, ScrollView, Share, ActivityIndicator
} from 'react-native';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import QRCode from 'react-native-qrcode-svg';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import AsyncStorage from '@react-native-async-storage/async-storage';

type SessionParams = {
  sessionId: string;
  code: string;
  sessionName: string;
  teacherName: string;
  alertThreshold: string;
  isOffline: string;
};

export default function SessionCode() {
  console.log('🖥️ SessionCode screen mounted');  
  const router = useRouter();
  const [params, setParams] = useState<SessionParams | null>(null);
  const [activating, setActivating] = useState(false);
  const [loadError, setLoadError] = useState('');
  const isOffline = params?.isOffline === 'true';
  const studentUrl = params
  ? `https://classpulse-97289.web.app/student.html?session=${encodeURIComponent(params.sessionId)}`
  : '';

  useEffect(() => {
  let retries = 0;

  const load = async () => {
    try {
      const raw = await AsyncStorage.getItem('currentSession');
      console.log('📦 AsyncStorage read attempt', retries, ':', raw);

      if (raw) {
        const parsed = JSON.parse(raw);
        console.log('✅ Parsed session:', parsed);
        setParams(parsed);
      } else if (retries < 5) {
        // AsyncStorage occasionally returns null on first read — retry
        retries++;
        console.log('⚠️ Got null, retrying in 300ms...');
        setTimeout(load, 300);
      } else {
        setLoadError('No session data found. Go back and create a session.');
      }
    } catch (e) {
      console.error('❌ AsyncStorage read error:', e);
      setLoadError('Failed to load session data.');
    }
  };

  load();
}, []);

  const handleShare = async () => {
    if (!params) return;
    await Share.share({
      message: `Join my class!\nScan the QR or open: ${studentUrl}\nCode: ${params.code}`,
    });
  };

  const handleStartSession = async () => {
    if (!params) return;
    setActivating(true);
    try {
      await updateDoc(doc(db, 'sessions', params.sessionId), {
        active: true,
      });
      router.replace('/dashboard' as any);
    } catch (e: any) {
      console.error('Start session error:', e);
      setActivating(false);
    }
  };

  // Loading state
  if (!params && !loadError) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#1A1A18" />
          <Text style={styles.loadingText}>Loading session…</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Error state
  if (loadError) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}>
          <Text style={styles.errorText}>{loadError}</Text>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backBtnText}>← Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.badge}>SESSION READY</Text>
          <Text style={styles.title}>{params!.sessionName}</Text>
          <Text style={styles.subtitle}>Share this with your students</Text>
        </View>

        {/* Offline badge — ADD THIS HERE */}
{isOffline && (
  <View style={styles.offlineBadge}>
    <Text style={styles.offlineBadgeText}>📶 Offline Mode — Hotspot session</Text>
  </View>
)}

        {/* QR Code card */}
        <View style={styles.qrCard}>
          <QRCode
            value={studentUrl}
            size={180}
            color="#1A1A18"
            backgroundColor="#FFFFFF"
          />
          <Text style={styles.qrHint}>Scan to join instantly</Text>
        </View>

        {/* Divider */}
        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or enter code</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* 4-digit code */}
        <View style={styles.codeRow}>
          {params!.code.split('').map((digit, i) => (
            <View key={i} style={styles.digitBox}>
              <Text style={styles.digit}>{digit}</Text>
            </View>
          ))}
        </View>

        {/* Session info strip */}
        <View style={styles.infoStrip}>
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>TEACHER</Text>
            <Text style={styles.infoValue}>{params!.teacherName}</Text>
          </View>
          <View style={styles.infoDivider} />
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>ALERT AT</Text>
            <Text style={styles.infoValue}>{params!.alertThreshold}% lost</Text>
          </View>
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity style={styles.shareBtn} onPress={handleShare}>
            <Text style={styles.shareBtnText}>Share code</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.startBtn, activating && styles.startBtnDisabled]}
            onPress={handleStartSession}
            disabled={activating}
            activeOpacity={0.85}
          >
            <Text style={styles.startBtnText}>
              {activating ? 'Starting…' : 'Start Session →'}
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.waitNote}>
          Wait for students to join before starting.
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
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    padding: 28,
  },
  loadingText: {
    fontSize: 14,
    color: '#888780',
    marginTop: 12,
  },
  errorText: {
    fontSize: 15,
    color: '#D85A30',
    textAlign: 'center',
    lineHeight: 22,
  },
  backBtn: {
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#C8C5BE',
  },
  backBtnText: {
    fontSize: 14,
    color: '#444441',
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingTop: 48,
    paddingBottom: 40,
    alignItems: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  badge: {
    fontSize: 11,
    letterSpacing: 2.5,
    color: '#1D9E75',
    fontWeight: '600',
    marginBottom: 10,
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
    color: '#1A1A18',
    letterSpacing: -0.3,
    marginBottom: 6,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#888780',
  },
  qrCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    gap: 14,
    borderWidth: 1,
    borderColor: '#E0DDD7',
    marginBottom: 28,
    width: '100%',
  },
  qrHint: {
    fontSize: 13,
    color: '#AEACA6',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 24,
    width: '100%',
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E0DDD7',
  },
  dividerText: {
    fontSize: 12,
    color: '#AEACA6',
  },
  codeRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 28,
  },
  digitBox: {
    width: 64,
    height: 72,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#1A1A18',
    alignItems: 'center',
    justifyContent: 'center',
  },
  digit: {
    fontSize: 36,
    fontWeight: '700',
    color: '#1A1A18',
  },
  infoStrip: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E0DDD7',
    padding: 16,
    width: '100%',
    marginBottom: 28,
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  infoItem: {
    alignItems: 'center',
    gap: 4,
  },
  infoLabel: {
    fontSize: 11,
    color: '#AEACA6',
    letterSpacing: 0.5,
  },
  infoValue: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1A1A18',
  },
  infoDivider: {
    width: 1,
    height: 32,
    backgroundColor: '#E0DDD7',
  },
  actions: {
    width: '100%',
    gap: 12,
  },
  shareBtn: {
    backgroundColor: 'transparent',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#C8C5BE',
  },
  shareBtnText: {
    fontSize: 15,
    color: '#444441',
    fontWeight: '500',
  },
  startBtn: {
    backgroundColor: '#1A1A18',
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
  },
  startBtnDisabled: {
    backgroundColor: '#888780',
  },
  startBtnText: {
    color: '#F7F5F0',
    fontSize: 16,
    fontWeight: '600',
  },
  waitNote: {
    marginTop: 20,
    fontSize: 12,
    color: '#AEACA6',
    textAlign: 'center',
  },
  offlineBadge: {
  backgroundColor: '#E1F5EE',
  borderRadius: 10,
  paddingVertical: 10,
  paddingHorizontal: 14,
  marginBottom: 16,
  borderWidth: 1,
  borderColor: '#9FE1CB',
  width: '100%',
  alignItems: 'center',
},
offlineBadgeText: {
  fontSize: 13,
  fontWeight: '600',
  color: '#085041',
},
});