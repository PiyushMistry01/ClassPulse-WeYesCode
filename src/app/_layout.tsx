import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { useColorScheme } from 'react-native';

export default function RootLayout() {
  const colorScheme = useColorScheme();

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