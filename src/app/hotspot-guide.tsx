import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, ScrollView, Platform, Linking
} from 'react-native';
import { useRouter } from 'expo-router';

const steps = [
  {
    number: '1',
    title: 'Open phone Settings',
    detail: 'Go to Settings on your phone.',
  },
  {
    number: '2',
    title: 'Turn on Mobile Hotspot',
    detail: Platform.OS === 'android'
      ? 'Settings → Network → Hotspot & Tethering → Mobile Hotspot'
      : 'Settings → Personal Hotspot → Allow Others to Join',
  },
  {
    number: '3',
    title: 'Note your hotspot name & password',
    detail: 'Students will need these to connect their phones to your hotspot via Wi-Fi.',
  },
  {
    number: '4',
    title: 'Ask students to connect',
    detail: 'Students open Wi-Fi on their phone, select your hotspot name, enter the password. No SIM card needed.',
  },
  {
    number: '5',
    title: 'Show students the QR code',
    detail: 'Once connected to your hotspot, students scan the QR or open the link in their browser.',
  },
];

export default function HotspotGuide() {
  const router = useRouter();

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
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.scroll}>

        <View style={s.header}>
          <Text style={s.badge}>OFFLINE MODE</Text>
          <Text style={s.title}>Hotspot Setup</Text>
          <Text style={s.sub}>
            No Wi-Fi in your classroom? Use your phone's mobile hotspot.
            Students connect to it like any Wi-Fi network — no SIM card needed on their phones.
          </Text>
        </View>

        {/* Connectivity requirement banner */}
        <View style={s.requiresBanner}>
          <Text style={s.requiresTitle}>What you need</Text>
          <View style={s.requiresRow}>
            <View style={s.requiresDot} />
            <Text style={s.requiresText}>Your phone with mobile data (2G is enough)</Text>
          </View>
          <View style={s.requiresRow}>
            <View style={s.requiresDot} />
            <Text style={s.requiresText}>Students' phones with Wi-Fi (no SIM needed)</Text>
          </View>
          <View style={s.requiresRow}>
            <View style={s.requiresDot} />
            <Text style={s.requiresText}>Mobile hotspot enabled on your phone</Text>
          </View>
        </View>

        {/* Steps */}
        {steps.map((step, i) => (
          <View key={i} style={s.stepCard}>
            <View style={s.stepNumBox}>
              <Text style={s.stepNum}>{step.number}</Text>
            </View>
            <View style={s.stepContent}>
              <Text style={s.stepTitle}>{step.title}</Text>
              <Text style={s.stepDetail}>{step.detail}</Text>
            </View>
          </View>
        ))}

        {/* Open settings shortcut */}
        <TouchableOpacity style={s.settingsBtn} onPress={openSettings}>
          <Text style={s.settingsBtnText}>Open Phone Settings →</Text>
        </TouchableOpacity>

        <Text style={s.settingsHint}>
          This opens your phone's settings so you can turn on the hotspot quickly.
        </Text>

        {/* Done button */}
        <TouchableOpacity
          style={s.doneBtn}
          onPress={() => router.back()}
          activeOpacity={0.85}
        >
          <Text style={s.doneBtnText}>Hotspot is on — go back</Text>
        </TouchableOpacity>

        <Text style={s.footerNote}>
          Tip: Keep your phone plugged in while using hotspot — it drains battery faster.
        </Text>

      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#F7F5F0' },
  scroll: { padding: 24, paddingBottom: 48 },
  header: { marginBottom: 20 },
  badge:  { fontSize: 11, letterSpacing: 2.5, color: '#1D9E75', fontWeight: '700', marginBottom: 8 },
  title:  { fontSize: 26, fontWeight: '700', color: '#1A1A18', letterSpacing: -0.3, marginBottom: 8 },
  sub:    { fontSize: 14, color: '#888780', lineHeight: 22 },

  requiresBanner: {
    backgroundColor: '#E1F5EE',
    borderRadius: 14,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#9FE1CB',
  },
  requiresTitle: { fontSize: 13, fontWeight: '700', color: '#085041', marginBottom: 10 },
  requiresRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  requiresDot:   { width: 6, height: 6, borderRadius: 3, backgroundColor: '#1D9E75', marginTop: 5 },
  requiresText:  { fontSize: 13, color: '#0F6E56', flex: 1, lineHeight: 20 },

  stepCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row',
    gap: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E0DDD7',
  },
  stepNumBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#1A1A18',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  stepNum:     { fontSize: 14, fontWeight: '700', color: '#F7F5F0' },
  stepContent: { flex: 1 },
  stepTitle:   { fontSize: 14, fontWeight: '600', color: '#1A1A18', marginBottom: 4 },
  stepDetail:  { fontSize: 13, color: '#888780', lineHeight: 20 },

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
  settingsHint:    { fontSize: 12, color: '#AEACA6', textAlign: 'center', marginBottom: 20 },

  doneBtn: {
    backgroundColor: '#1A1A18',
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
    marginBottom: 16,
  },
  doneBtnText: { fontSize: 16, fontWeight: '700', color: '#F7F5F0' },
  footerNote:  { fontSize: 12, color: '#AEACA6', textAlign: 'center', lineHeight: 18 },
});