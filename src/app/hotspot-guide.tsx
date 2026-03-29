import { useRouter } from 'expo-router';
import {
    Linking,
    Platform,
    SafeAreaView, ScrollView,
    StyleSheet,
    Text, TouchableOpacity,
    View
} from 'react-native';
import LanguageSwitcher from '../components/language-switcher';
import { useI18n } from '../hooks/use-i18n';

export default function HotspotGuide() {
  const router = useRouter();
  const { i18n } = useI18n();

  const steps = [
    {
      number: '1',
      title: i18n.t('hotspotGuideStep1Title'),
      detail: i18n.t('hotspotGuideStep1Detail'),
    },
    {
      number: '2',
      title: i18n.t('hotspotGuideStep2Title'),
      detail: Platform.OS === 'android'
        ? i18n.t('hotspotGuideStep2DetailAndroid')
        : i18n.t('hotspotGuideStep2DetailIos'),
    },
    {
      number: '3',
      title: i18n.t('hotspotGuideStep3Title'),
      detail: i18n.t('hotspotGuideStep3Detail'),
    },
    {
      number: '4',
      title: i18n.t('hotspotGuideStep4Title'),
      detail: i18n.t('hotspotGuideStep4Detail'),
    },
    {
      number: '5',
      title: i18n.t('hotspotGuideStep5Title'),
      detail: i18n.t('hotspotGuideStep5Detail'),
    },
  ];

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
        <LanguageSwitcher />

        <View style={s.header}>
          <Text style={s.badge}>{i18n.t('offlineMode')}</Text>
          <Text style={s.title}>{i18n.t('hotspotSetupTitle')}</Text>
          <Text style={s.sub}>
            {i18n.t('hotspotSetupSub')}
          </Text>
        </View>

        {/* Connectivity requirement banner */}
        <View style={s.requiresBanner}>
          <Text style={s.requiresTitle}>{i18n.t('whatYouNeedTitle')}</Text>
          <View style={s.requiresRow}>
            <View style={s.requiresDot} />
            <Text style={s.requiresText}>{i18n.t('need2gEnough')}</Text>
          </View>
          <View style={s.requiresRow}>
            <View style={s.requiresDot} />
            <Text style={s.requiresText}>{i18n.t('needStudentsWifiNoSim')}</Text>
          </View>
          <View style={s.requiresRow}>
            <View style={s.requiresDot} />
            <Text style={s.requiresText}>{i18n.t('needHotspotEnabledSimple')}</Text>
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
          <Text style={s.settingsBtnText}>{i18n.t('openPhoneSettings')}</Text>
        </TouchableOpacity>

        <Text style={s.settingsHint}>
          {i18n.t('hotspotOpenSettingsHint')}
        </Text>

        {/* Done button */}
        <TouchableOpacity
          style={s.doneBtn}
          onPress={() => router.back()}
          activeOpacity={0.85}
        >
          <Text style={s.doneBtnText}>{i18n.t('hotspotOnGoBack')}</Text>
        </TouchableOpacity>

        <Text style={s.footerNote}>
          {i18n.t('hotspotFooterTip')}
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