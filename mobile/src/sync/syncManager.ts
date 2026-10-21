/**
 * Keeps the lecturer's phone and the server in step, POS-style: the phone never waits for the
 * network, and this runs in the background whenever there is one.
 *
 * One run = PUSH the outbox (oldest first, in batches; each op is applied at most once by the
 * server) then PULL what changed since the last cursor. Runs on start, on login, when the app
 * comes to the foreground, when the network comes back, shortly after every local change
 * (`poke`), every few minutes while the app is open, and from a background task (backgroundSync.ts).
 *
 * Failures back off exponentially (5 s .. 5 min). Rejected ops are kept and shown, never retried.
 */
import axios from 'axios';
import * as Network from 'expo-network';
import * as SecureStore from 'expo-secure-store';
import { AppState, type NativeEventSubscription } from 'react-native';

import { DEVICE_STATE_HEADER, DeviceSignedOutError, REFRESH_KEY, onDeviceSignedOut } from '@/api/client';
import { lecturerApi } from '@/api/endpoints';
import type { OfflinePolicy } from '@/api/types';
import { metaGet, metaSet } from '@/db/database';
import { applyPull, autoEndStaleSessions, bumpAttempts, outboxCounts, pendingOps, settleOps } from '@/db/lecturerStore';
import { DEFAULT_MATCHING, MODEL_VERSION } from '@/face/config';

const PUSH_BATCH = 200;
const POKE_DELAY_MS = 2000;
const FOREGROUND_INTERVAL_MS = 5 * 60_000;
const BACKOFF_MIN_MS = 5000;
const BACKOFF_MAX_MS = 5 * 60_000;
const DAY_MS = 24 * 3600_000;

export const DEFAULT_POLICY: OfflinePolicy = { warn_days: 7, strong_warn_days: 14, block_days: 30 };

export type SyncState =
  | 'idle' // nothing known to be wrong
  | 'syncing'
  | 'offline' // no network, or the server is unreachable
  | 'error' // the server answered with an error
  | 'auth_needed' // refresh token rejected: sign in again (local data is kept)
  | 'replaced'; // the lecturer signed in on another phone: this one only uploads what it has

/** How long since the last successful sync, against the server's offline policy. */
export type Staleness = 'fresh' | 'warn' | 'strong' | 'blocked' | 'never';

export interface SyncStatus {
  state: SyncState;
  pending: number;
  rejected: number;
  lastSyncAt: string | null;
  staleness: Staleness;
  daysSinceSync: number | null;
  policy: OfflinePolicy;
  /** The server matches with a different face model: this app needs updating */
  modelOutdated: boolean;
  lastError: string | null;
}

export interface Matching {
  threshold: number;
  margin: number;
}

const META = {
  cursor: 'sync_cursor',
  lastSync: 'last_sync_at',
  matching: 'matching',
  policy: 'offline_policy',
  serverModel: 'server_model_version',
};

function staleness(lastSyncAt: string | null, policy: OfflinePolicy): { staleness: Staleness; days: number | null } {
  if (!lastSyncAt) return { staleness: 'never', days: null };
  const days = (Date.now() - new Date(lastSyncAt).getTime()) / DAY_MS;
  if (days >= policy.block_days) return { staleness: 'blocked', days };
  if (days >= policy.strong_warn_days) return { staleness: 'strong', days };
  if (days >= policy.warn_days) return { staleness: 'warn', days };
  return { staleness: 'fresh', days };
}

type StatusListener = (s: SyncStatus) => void;
type EndedListener = (sessionUuids: string[]) => void;

class SyncManager {
  private status: SyncStatus = {
    state: 'idle',
    pending: 0,
    rejected: 0,
    lastSyncAt: null,
    staleness: 'never',
    daysSinceSync: null,
    policy: DEFAULT_POLICY,
    modelOutdated: false,
    lastError: null,
  };
  private statusListeners = new Set<StatusListener>();
  private endedListeners = new Set<EndedListener>();
  private drainedListeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  private again = false;
  private failures = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pokeTimer: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private subscriptions: { remove(): void }[] = [];
  private started = false;

  // ---------- lifecycle ----------
  /** Start syncing in the foreground. Call after a lecturer signs in (or the app restores one). */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.subscriptions.push(
      Network.addNetworkStateListener((s) => {
        if (s.isConnected && s.isInternetReachable !== false) this.syncSoon(0);
      }),
      AppState.addEventListener('change', (state) => {
        if (state === 'active') this.syncSoon(0);
      }) as NativeEventSubscription,
      { remove: onDeviceSignedOut(() => this.setStatus({ state: 'auth_needed' })) },
    );
    this.interval = setInterval(() => this.syncSoon(0), FOREGROUND_INTERVAL_MS);
    void this.refreshStatus();
    this.syncSoon(0);
  }

  stop(): void {
    this.started = false;
    this.subscriptions.forEach((s) => s.remove());
    this.subscriptions = [];
    if (this.interval) clearInterval(this.interval);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.pokeTimer) clearTimeout(this.pokeTimer);
    this.interval = this.retryTimer = this.pokeTimer = null;
    this.failures = 0;
    this.status = { ...this.status, state: 'idle', lastError: null };
  }

  /** A local change was made: sync shortly (debounced, so a burst of scans goes up together). */
  poke(): void {
    void this.refreshStatus();
    this.syncSoon(POKE_DELAY_MS);
  }

  private syncSoon(delayMs: number): void {
    if (!this.started) return;
    if (this.pokeTimer) clearTimeout(this.pokeTimer);
    this.pokeTimer = setTimeout(() => void this.syncNow(), delayMs);
  }

  // ---------- subscriptions ----------
  getStatus(): SyncStatus {
    return this.status;
  }

  subscribe(cb: StatusListener): () => void {
    this.statusListeners.add(cb);
    cb(this.status);
    return () => this.statusListeners.delete(cb);
  }

  /** Live classes on this phone that the dashboard ended or deleted. */
  onEndedElsewhere(cb: EndedListener): () => void {
    this.endedListeners.add(cb);
    return () => this.endedListeners.delete(cb);
  }

  /** This phone was replaced by another one and has nothing left to upload: time to wipe it. */
  onReplacedAndDrained(cb: () => void): () => void {
    this.drainedListeners.add(cb);
    return () => this.drainedListeners.delete(cb);
  }

  private setStatus(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch };
    this.statusListeners.forEach((cb) => cb(this.status));
  }

  async refreshStatus(): Promise<void> {
    const [counts, lastSyncAt, policyRaw, serverModel] = await Promise.all([
      outboxCounts(),
      metaGet(META.lastSync),
      metaGet(META.policy),
      metaGet(META.serverModel),
    ]);
    const policy = policyRaw ? (JSON.parse(policyRaw) as OfflinePolicy) : DEFAULT_POLICY;
    const s = staleness(lastSyncAt, policy);
    this.setStatus({
      pending: counts.pending,
      rejected: counts.rejected,
      lastSyncAt,
      policy,
      staleness: s.staleness,
      daysSinceSync: s.days,
      modelOutdated: serverModel != null && serverModel !== MODEL_VERSION,
    });
  }

  // ---------- the sync run ----------
  /** Push then pull now. Concurrent calls share one run (and trigger one more if changes came in meanwhile). */
  syncNow(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.run().finally(() => {
      this.running = null;
      if (this.again) {
        this.again = false;
        this.syncSoon(0);
      }
    });
    return this.running;
  }

  private async run(): Promise<void> {
    if (!(await SecureStore.getItemAsync(REFRESH_KEY))) {
      this.setStatus({ state: 'auth_needed' });
      return;
    }
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.setStatus({ state: 'syncing' });
    try {
      await autoEndStaleSessions();
      await this.push();
      if (this.status.state !== 'replaced') await this.pull();
      this.failures = 0;
      await this.refreshStatus();
      if (this.status.state === 'replaced') {
        if (this.status.pending === 0) this.drainedListeners.forEach((cb) => cb());
      } else {
        this.setStatus({ state: 'idle', lastError: null });
      }
    } catch (err) {
      await this.refreshStatus().catch(() => undefined);
      this.handleFailure(err);
    }
  }

  private async push(): Promise<void> {
    for (;;) {
      const ops = await pendingOps(PUSH_BATCH);
      if (!ops.length) return;
      await bumpAttempts(ops.map((o) => o.op_id));
      const res = await lecturerApi.push(ops.map((o) => ({ op_id: o.op_id, type: o.type, payload: o.payload })));
      await settleOps(res.results);
      await this.refreshStatus();
      if (ops.length < PUSH_BATCH) return;
    }
  }

  private async pull(): Promise<void> {
    let res;
    try {
      res = await lecturerApi.pull(await metaGet(META.cursor));
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.headers[DEVICE_STATE_HEADER] === 'replaced') {
        this.setStatus({ state: 'replaced' });
        return;
      }
      throw err;
    }
    const outcome = await applyPull(res);
    await Promise.all([
      metaSet(META.cursor, res.cursor),
      metaSet(META.lastSync, new Date().toISOString()),
      metaSet(META.matching, JSON.stringify({ threshold: res.matching.threshold, margin: res.matching.margin })),
      metaSet(META.policy, JSON.stringify(res.offline_policy)),
      metaSet(META.serverModel, res.matching.model_version),
    ]);
    if (outcome.endedElsewhere.length) this.endedListeners.forEach((cb) => cb(outcome.endedElsewhere));
  }

  private handleFailure(err: unknown): void {
    if (err instanceof DeviceSignedOutError) {
      this.setStatus({ state: 'auth_needed', lastError: err.message });
      return; // nothing to retry until the lecturer signs in again
    }
    const offline = axios.isAxiosError(err) && !err.response;
    const message = axios.isAxiosError(err)
      ? (err.response?.data as { detail?: string } | undefined)?.detail ?? err.message
      : err instanceof Error
        ? err.message
        : String(err);
    this.setStatus({ state: offline ? 'offline' : 'error', lastError: String(message) });
    this.failures += 1;
    const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** (this.failures - 1));
    const delay = base * (0.75 + Math.random() * 0.5);
    if (this.started) this.retryTimer = setTimeout(() => void this.syncNow(), delay);
  }
}

export const syncManager = new SyncManager();

/** Server-tuned match threshold and margin (defaults until the first sync). */
export async function matchingSettings(): Promise<Matching> {
  const raw = await metaGet(META.matching);
  return raw ? (JSON.parse(raw) as Matching) : DEFAULT_MATCHING;
}
