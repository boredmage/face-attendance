/**
 * The lecturer's "till receipt" indicator: always shows whether everything recorded on this phone
 * has reached the server. Tapping it opens a sheet with details, "Sync now", operations the server
 * refused, and "Sign in again" when the phone's sign-in has expired.
 */
import { BottomSheet, Button, Chip, Input, Spinner, useBottomSheetAwareHandlers } from 'heroui-native';
import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { dismissRejected, rejectedOps } from '@/db/lecturerStore';
import { syncManager, type SyncStatus } from '@/sync/syncManager';
import { useSyncStatus } from '@/sync/useSyncStatus';

import { Icon, type IconName } from './ui';

type Tone = 'success' | 'warning' | 'danger' | 'accent';

export function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function describe(s: SyncStatus): { tone: Tone; icon: IconName; label: string } {
  if (s.state === 'auth_needed') return { tone: 'danger', icon: 'key-outline', label: 'Sign in to sync' };
  if (s.state === 'replaced') return { tone: 'danger', icon: 'phone-portrait-outline', label: 'Used on another phone' };
  if (s.state === 'syncing') return { tone: 'accent', icon: 'sync-outline', label: 'Syncing…' };
  const waiting = s.pending > 0 ? `${s.pending} waiting` : null;
  if (s.state === 'offline') return { tone: 'warning', icon: 'cloud-offline-outline', label: waiting ? `Offline · ${waiting}` : 'Offline' };
  if (s.state === 'error') return { tone: 'warning', icon: 'alert-circle-outline', label: waiting ? `Sync problem · ${waiting}` : 'Sync problem' };
  if (s.staleness === 'blocked' || s.staleness === 'strong') {
    return { tone: 'danger', icon: 'time-outline', label: `Last synced ${timeAgo(s.lastSyncAt)}` };
  }
  if (s.staleness === 'warn') return { tone: 'warning', icon: 'time-outline', label: `Last synced ${timeAgo(s.lastSyncAt)}` };
  if (waiting) return { tone: 'accent', icon: 'cloud-upload-outline', label: waiting };
  return { tone: 'success', icon: 'cloud-done-outline', label: s.lastSyncAt ? `Synced ${timeAgo(s.lastSyncAt)}` : 'Not synced yet' };
}

export function SyncBadge({ dark = false }: { dark?: boolean }) {
  const status = useSyncStatus();
  const [open, setOpen] = useState(false);
  const d = describe(status);
  return (
    <>
      <Pressable onPress={() => setOpen(true)} hitSlop={8}>
        {dark ? (
          <View className="flex-row items-center gap-1.5 rounded-full bg-black/50 px-3 py-1.5">
            <Icon name={d.icon} size={14} color={d.tone} />
            <Text className="text-xs font-semibold text-white">{d.label}</Text>
          </View>
        ) : (
          <Chip size="sm" variant="soft" color={d.tone}>
            <Icon name={d.icon} size={13} color={d.tone} />
            <Chip.Label>{d.label}</Chip.Label>
          </Chip>
        )}
      </Pressable>
      <SyncSheet isOpen={open} onOpenChange={setOpen} />
    </>
  );
}

function SyncSheet({ isOpen, onOpenChange }: { isOpen: boolean; onOpenChange: (open: boolean) => void }) {
  const status = useSyncStatus();
  const [rejected, setRejected] = useState<Awaited<ReturnType<typeof rejectedOps>>>([]);

  useEffect(() => {
    if (isOpen) void rejectedOps().then(setRejected);
  }, [isOpen, status.rejected]);

  const d = describe(status);
  return (
    <BottomSheet isOpen={isOpen} onOpenChange={onOpenChange}>
      <BottomSheet.Portal>
        <BottomSheet.Overlay />
        <BottomSheet.Content keyboardBehavior="extend">
          <View className="mb-4 flex-row items-center gap-3">
            <View className="size-12 items-center justify-center rounded-full bg-default">
              <Icon name={d.icon} size={24} color={d.tone} />
            </View>
            <View className="flex-1">
              <BottomSheet.Title>{d.label}</BottomSheet.Title>
              <BottomSheet.Description>{explain(status)}</BottomSheet.Description>
            </View>
          </View>

          <View className="mb-4 gap-2 rounded-2xl bg-default/60 p-4">
            <Row label="Last successful sync" value={timeAgo(status.lastSyncAt)} />
            <Row label="Waiting to upload" value={String(status.pending)} />
            {status.lastError && status.state !== 'idle' ? <Row label="Last error" value={status.lastError} /> : null}
          </View>

          {status.modelOutdated ? (
            <Text className="mb-4 text-sm text-danger">
              The server uses a newer face model. Update the app so students can be recognised.
            </Text>
          ) : null}

          {rejected.length ? (
            <View className="mb-4 gap-2">
              <Text className="text-sm font-semibold text-foreground">Not accepted by the server ({rejected.length})</Text>
              {rejected.slice(0, 5).map((r) => (
                <Text key={r.op_id} className="text-xs text-muted">
                  {opLabel(r.type)}: {r.reason ?? 'rejected'}
                </Text>
              ))}
              <Button size="sm" variant="tertiary" onPress={() => void dismissRejected().then(() => syncManager.refreshStatus())}>
                Dismiss
              </Button>
            </View>
          ) : null}

          {status.state === 'auth_needed' ? (
            <ReauthForm onDone={() => onOpenChange(false)} />
          ) : (
            <Button
              isDisabled={status.state === 'syncing'}
              onPress={() => void syncManager.syncNow()}
            >
              {status.state === 'syncing' ? <Spinner color="white" /> : 'Sync now'}
            </Button>
          )}
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  );
}

function ReauthForm({ onDone }: { onDone: () => void }) {
  const { reauthLecturer } = useAuth();
  const { onFocus, onBlur } = useBottomSheetAwareHandlers();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await reauthLecturer(password);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View className="gap-3">
      <Text className="text-sm text-muted">Enter your password. Everything recorded on this phone is kept.</Text>
      <Input secureTextEntry placeholder="Password" value={password} onChangeText={setPassword} onFocus={onFocus} onBlur={onBlur} />
      {error ? <Text className="text-sm text-danger">{error}</Text> : null}
      <Button onPress={() => void submit()} isDisabled={busy || !password}>
        {busy ? <Spinner color="white" /> : 'Sign in again'}
      </Button>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between gap-4">
      <Text className="text-sm text-muted">{label}</Text>
      <Text className="flex-1 text-right text-sm font-semibold text-foreground" numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function opLabel(type: string): string {
  switch (type) {
    case 'session.start':
      return 'Class start';
    case 'session.end':
      return 'Class end';
    case 'attendance.mark':
      return 'Attendance mark';
    case 'attendance.unmark':
      return 'Removed mark';
    default:
      return type;
  }
}

function explain(s: SyncStatus): string {
  switch (s.state) {
    case 'auth_needed':
      return 'Your sign-in on this phone has expired. Nothing recorded here is lost.';
    case 'replaced':
      return 'You signed in on another phone. This one is uploading what it still has, then signs out.';
    case 'offline':
      return 'Attendance is saved on this phone and uploads automatically when you are back online.';
    case 'error':
      return 'The server could not be reached properly. Retrying automatically.';
    case 'syncing':
      return 'Uploading attendance and downloading course changes.';
    default:
      if (s.staleness === 'blocked') return `Not synced for ${Math.floor(s.daysSinceSync ?? 0)} days. Connect to the internet before starting a new class.`;
      if (s.staleness === 'strong') return 'Class lists may be out of date: new students will not be recognised. Connect when you can.';
      if (s.staleness === 'warn') return 'Connect to the internet when you can to keep class lists up to date.';
      return s.pending > 0 ? 'Uploading shortly.' : 'Everything on this phone is on the server.';
  }
}
