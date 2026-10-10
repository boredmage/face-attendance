/**
 * Axios instance pre-configured with the backend URL and a JWT interceptor.
 * The token is read from expo-secure-store on every request so it survives app restarts.
 */
import axios, { AxiosError } from 'axios';
import * as SecureStore from 'expo-secure-store';

import { API_BASE_URL } from '@/config';

export const TOKEN_KEY = 'auth_token';

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
});

/**
 * Face endpoints embed one or more photos on the server CPU (about a second each once the model
 * is warm, far longer on the very first call after the server starts), so they get a longer budget.
 */
export const FACE_REQUEST_TIMEOUT_MS = 120000;

api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/** Listeners notified when the server rejects our token (so the app can log out). */
const unauthorizedListeners: Array<() => void> = [];
export function onUnauthorized(cb: () => void): () => void {
  unauthorizedListeners.push(cb);
  return () => {
    const i = unauthorizedListeners.indexOf(cb);
    if (i >= 0) unauthorizedListeners.splice(i, 1);
  };
}

api.interceptors.response.use(
  (r) => r,
  (error: AxiosError) => {
    // Students never upload a face for verification any more, so every 401 means the token was
    // rejected (expired, or the account is gone) - except a failed login, which has no token yet.
    if (error.response?.status === 401 && !error.config?.url?.includes('/login')) {
      unauthorizedListeners.forEach((cb) => cb());
    }
    return Promise.reject(error);
  },
);

/** Turn any thrown error into a short, user-friendly message. */
export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (axios.isAxiosError(err)) {
    if (!err.response) return 'Cannot reach the server. Check your connection and the server address.';
    const detail = (err.response.data as { detail?: unknown } | undefined)?.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail) && detail[0]?.msg) return String(detail[0].msg);
    return `Server error (${err.response.status})`;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}

export function isNetworkError(err: unknown): boolean {
  return axios.isAxiosError(err) && !err.response;
}
