import { useEffect, useState } from 'react';
import i18n, { getCurrentLanguage, subscribeLanguageChange } from '../i18n';

export function useI18n() {
  const [language, setLanguage] = useState<'en' | 'hi' | 'mr'>(getCurrentLanguage());

  useEffect(() => {
    const unsubscribe = subscribeLanguageChange((nextLanguage: 'en' | 'hi' | 'mr') => {
      setLanguage(nextLanguage);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  return { i18n, language };
}
