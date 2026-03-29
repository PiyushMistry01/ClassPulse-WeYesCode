import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';
import { initializeI18n } from '../i18n';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    initializeI18n().finally(() => setReady(true));
  }, []);

  if (!ready) return null;

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="session-code" />
        <Stack.Screen name="dashboard" />
        <Stack.Screen name="analysis" />
        <Stack.Screen name="hotspot-guide" />
      </Stack>
    </ThemeProvider>
  );
}