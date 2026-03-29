import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useI18n } from '../hooks/use-i18n';
import { setLanguage } from '../i18n';

export default function LanguageSwitcher() {
  const { i18n, language } = useI18n();

  return (
    <View style={styles.row}>
      <Text style={styles.label}>{i18n.t('language')}</Text>
      <View style={styles.group}>
        <TouchableOpacity
          style={[styles.btn, language === 'en' && styles.btnActive]}
          onPress={() => void setLanguage('en')}
        >
          <Text style={[styles.btnText, language === 'en' && styles.btnTextActive]}>{i18n.t('english')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, language === 'hi' && styles.btnActive]}
          onPress={() => void setLanguage('hi')}
        >
          <Text style={[styles.btnText, language === 'hi' && styles.btnTextActive]}>{i18n.t('hindi')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, language === 'mr' && styles.btnActive]}
          onPress={() => void setLanguage('mr')}
        >
          <Text style={[styles.btnText, language === 'mr' && styles.btnTextActive]}>{i18n.t('marathi')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DCD7CF',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  label: {
    fontSize: 12,
    color: '#444441',
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  group: {
    flexDirection: 'row',
    gap: 8,
  },
  btn: {
    borderWidth: 1,
    borderColor: '#D3D0C8',
    borderRadius: 18,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
  },
  btnActive: {
    backgroundColor: '#1A1A18',
    borderColor: '#1A1A18',
  },
  btnText: {
    fontSize: 12,
    color: '#1A1A18',
    fontWeight: '600',
  },
  btnTextActive: {
    color: '#F7F5F0',
  },
});
