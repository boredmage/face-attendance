/**
 * Confirmation after a class ends, read from the phone (works offline). Lists who was marked so a
 * wrong mark can be undone straight away; full logs and statistics are on the dashboard.
 */
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card, Chip, Separator } from 'heroui-native';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';

import { SyncBadge } from '@/components/SyncBadge';
import { Icon, Screen } from '@/components/ui';
import {
  getSession,
  presentStudents,
  sessionCounts,
  unmark,
  type LocalSession,
  type PresentStudent,
  type SessionCounts,
} from '@/db/lecturerStore';
import type { LecturerStackParamList } from '@/navigation/types';
import { syncManager } from '@/sync/syncManager';
import { useSyncStatus } from '@/sync/useSyncStatus';
import { formatTime } from '@/utils/attendance';

export function SessionSummaryScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<LecturerStackParamList>>();
  const { params } = useRoute<RouteProp<LecturerStackParamList, 'SessionSummary'>>();
  const sync = useSyncStatus();
  const [session, setSession] = useState<LocalSession | null>(null);
  const [counts, setCounts] = useState<SessionCounts>({ present: 0, expected: 0 });
  const [present, setPresent] = useState<PresentStudent[]>([]);

  const load = useCallback(async () => {
    const [s, c, p] = await Promise.all([
      getSession(params.sessionUuid),
      sessionCounts(params.sessionUuid),
      presentStudents(params.sessionUuid),
    ]);
    setSession(s);
    setCounts(c);
    setPresent(p);
  }, [params.sessionUuid]);

  useEffect(() => {
    void load();
  }, [load]);

  const askUndo = (p: PresentStudent) =>
    Alert.alert('Remove this mark?', `${p.full_name} (${p.matric_no}) will be marked absent for this class.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await unmark(params.sessionUuid, p.student_id);
          syncManager.poke();
          await load();
        },
      },
    ]);

  const duration =
    session?.ended_at != null
      ? Math.max(0, Math.round((new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) / 60_000))
      : null;
  const pct = counts.expected ? Math.round((counts.present * 100) / counts.expected) : 0;

  const header = (
    <View className="items-center">
      <View className="mb-5 size-24 items-center justify-center rounded-full bg-success/15">
        <Icon name="checkmark" size={52} color="success" />
      </View>
      <Text className="text-3xl font-bold tracking-tight text-foreground">{session?.course_code ?? ''} ended</Text>
      {session ? (
        <Text className="mb-4 mt-1 text-sm text-muted">
          {formatTime(session.started_at)} – {session.ended_at ? formatTime(session.ended_at) : 'now'}
          {duration != null ? ` · ${duration} min` : ''}
        </Text>
      ) : null}
      <View className="mb-6">
        <SyncBadge />
      </View>

      <Card className="mb-3 flex-row items-center self-stretch py-5">
        <Stat value={String(counts.present)} label="Present" />
        <Separator orientation="vertical" />
        <Stat value={String(Math.max(0, counts.expected - counts.present))} label="Absent" />
        <Separator orientation="vertical" />
        <Stat value={`${pct}%`} label="Turnout" />
      </Card>
      <Text className="mb-5 text-center text-sm text-muted">
        {sync.pending > 0
          ? 'Saved on this phone. It uploads automatically when you are online; the full log then appears on your dashboard.'
          : 'The full attendance log for this class is on your dashboard.'}
      </Text>
      {present.length ? <Text className="mb-2 self-start text-sm font-semibold text-foreground">Marked present</Text> : null}
    </View>
  );

  return (
    <Screen>
      <FlatList
        data={present}
        keyExtractor={(p) => String(p.student_id)}
        contentContainerClassName="px-6 pb-6 pt-8"
        ItemSeparatorComponent={() => <View className="h-2" />}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <View className="flex-row items-center gap-3 rounded-2xl bg-default/60 p-3">
            <View className="flex-1">
              <Text className="text-base font-semibold text-foreground">{item.full_name}</Text>
              <Text className="text-sm text-muted">
                {item.matric_no} · {formatTime(item.marked_at)}
              </Text>
            </View>
            {item.method === 'manual' ? (
              <Chip size="sm" variant="soft" color="default">Manual</Chip>
            ) : null}
            <Pressable onPress={() => askUndo(item)} hitSlop={8}>
              <Text className="text-sm font-semibold text-danger">Undo</Text>
            </Pressable>
          </View>
        )}
      />
      <View className="px-6 pb-6">
        <Button size="lg" onPress={() => navigation.popToTop()}>
          Done
        </Button>
      </View>
    </Screen>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View className="flex-1 items-center">
      <Text className="text-3xl font-bold text-foreground">{value}</Text>
      <Text className="text-xs text-muted">{label}</Text>
    </View>
  );
}
