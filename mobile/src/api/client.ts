/**
 * Axios instance pre-configured with the backend URL and a JWT interceptor.
 * The token is read from expo-secure-store on every request so it survives app restarts.
 *
 * Lecturer devices also hold a refresh token: when the short-lived access token is rejected, it is
 * exchanged for a new one and the request retried. If that fails too, the device is told to sign in
 * again *without* being logged out, so classes recorded offline stay on the phone and in the queue.
 */
import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import * as SecureStore from 'expo-secure-store';

import { API_BASE_URL } from '@/config';

export const TOKEN_KEY = 'auth_token';
export const REFRESH_KEY = 'refresh_token';
/** Response header the server sets on lecturer-device errors: "replaced" | "signed_out" */
export const DEVICE_STATE_HEADER = 'x-device-state';

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
});

/** Face enrolment uploads several photos; give it a longer budget than other requests. */
export const FACE_REQUEST_TIMEOUT_MS = 60000;

api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

type Listener = () => void;
function listeners() {
  const list: Listener[] = [];
  return {
    add(cb: Listener): () => void {
      list.push(cb);
      return () => {
        const i = list.indexOf(cb);
        if (i >= 0) list.splice(i, 1);
      };
    },
    emit() {
      list.slice().forEach((cb) => cb());
    },
  };
}

/** Student whose token the server rejected (so the app can log out). */
const unauthorized = listeners();
export const onUnauthorized = unauthorized.add;
/** Lecturer device that can no longer refresh its token: it must sign in again to sync. */
const deviceSignedOut = listeners();
export const onDeviceSignedOut = deviceSignedOut.add;

export class DeviceSignedOutError extends Error {
  constructor() {
    super('Sign in again to sync');
  }
}

let refreshing: Promise<{ deviceActive: boolean }> | null = null;

/** Swap the refresh token for a new access + refresh token pair. Single flight. */
export function refreshAccessToken(): Promise<{ deviceActive: boolean }> {
  if (!refreshing) {
    refreshing = (async () => {
      const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
      if (!refreshToken) throw new DeviceSignedOutError();
      try {
        const r = await axios.post(
          '/auth/refresh',
          { refresh_token: refreshToken },
          { baseURL: API_BASE_URL, timeout: 15000 },
        );
        await SecureStore.setItemAsync(TOKEN_KEY, r.data.access_token);
        await SecureStore.setItemAsync(REFRESH_KEY, r.data.refresh_token);
        return { deviceActive: !!r.data.device_active };
      } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 401) {
          await SecureStore.deleteItemAsync(REFRESH_KEY);
          deviceSignedOut.emit();
          throw new DeviceSignedOutError();
        }
        throw err; // offline etc.: try again later
      }
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const config = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;
    const url = config?.url ?? '';
    if (error.response?.status !== 401 || (url.startsWith('/auth/') && url.endsWith('/login'))) {
      return Promise.reject(error);
    }
    if (await SecureStore.getItemAsync(REFRESH_KEY)) {
      if (config && !config._retried && error.response.headers[DEVICE_STATE_HEADER] !== 'signed_out') {
        config._retried = true;
        await refreshAccessToken(); // throws DeviceSignedOutError if this phone was signed out
        return api.request(config);
      }
      deviceSignedOut.emit();
      return Promise.reject(new DeviceSignedOutError());
    }
    if (!(await SecureStore.getItemAsync(TOKEN_KEY))) return Promise.reject(error);
    unauthorized.emit();
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
