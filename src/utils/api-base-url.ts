import Constants from 'expo-constants';
import { Platform } from 'react-native';

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function toAndroidReachableBase(rawBase: string): string {
  try {
    const parsed = new URL(rawBase);
    if (
      Platform.OS === 'android' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
    ) {
      parsed.hostname = '10.0.2.2';
      return parsed.toString().replace(/\/$/, '');
    }
  } catch {
    // If URL parsing fails, preserve original value.
  }

  return rawBase;
}

function getExpoHostIp(): string | null {
  const candidates = [
    (Constants as any)?.expoConfig?.hostUri,
    (Constants as any)?.expoGoConfig?.debuggerHost,
    (Constants as any)?.manifest?.debuggerHost,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.split(':')[0]?.trim() || null;
    }
  }

  return null;
}

function getCandidateApiBases(): string[] {
  const candidates: string[] = [];

  const envBase = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  if (envBase) {
    candidates.push(toAndroidReachableBase(trimTrailingSlash(envBase)));
  }

  const hostIp = getExpoHostIp();
  if (hostIp) {
    candidates.push(`http://${hostIp}:3000`);
  }

  if (Platform.OS === 'android') {
    candidates.push('http://10.0.2.2:3000');
  }

  candidates.push('http://localhost:3000');

  return [...new Set(candidates)];
}

export function getApiBaseUrl(): string | null {
  if (Platform.OS === 'web') {
    return '';
  }

  return getCandidateApiBases()[0] || null;
}

export function buildApiUrl(path: string): string | null {
  const base = getApiBaseUrl();
  if (base === null) {
    return null;
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

export async function fetchApi(path: string, init?: RequestInit): Promise<Response> {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  if (Platform.OS === 'web') {
    return fetch(normalizedPath, init);
  }

  const bases = getCandidateApiBases();
  let lastError: unknown = null;

  for (const base of bases) {
    const url = `${base}${normalizedPath}`;
    try {
      const response = await fetch(url, init);
      return response;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('All API base URL attempts failed');
}
