/**
 * Lecturer mode home. The app is for taking attendance ONLY: pick a course, start (or resume)
 * its class, scan students, end it. Course management, logs and statistics live on the dashboard.
 *
 * Everything here reads the phone's local copy (src/db/lecturerStore.ts), so it works with no
 * network; the sync badge shows whether the phone is up to date with the server.
 */
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Alert, Button, Card, Chip, Dialog, Spinner } from 'heroui-native';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert as NativeAlert, FlatList, KeyboardAvoidingView, RefreshControl, Text, View } from 'react-native';

import { SyncBadge, timeAgo } from '@/components/SyncBadge';
import { EmptyState, FormField, Icon, LoadingState, Screen, SectionTitle } from '@/components/ui';
import { DASHBOARD_URL } from '@/config';
import { useAuth, useLecturer } from '@/context/AuthContext';
import { LocalError, hasAnyData, listCourses, startSession, type LocalCourse } from '@/db/lecturerStore';
import type { LecturerStackParamList } from '@/navigation/types';
import { syncManager } from '@/sync/syncManager';
import { useSyncStatus } from '@/sync/useSyncStatus';

type Nav = NativeStackNavigationProp<LecturerStackParamList>;

export function LecturerHomeScreen() {
  const navigation = useNavigation<Nav>();
  const lecturer = useLecturer();
  const { logout } = useAuth();
  const sync = useSyncStatus();
  const [courses, setCourses] = useState<LocalCourse[] | null>(null);
  const [hasData, setHasData] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [starting, setStarting] = useState<LocalCourse | null>(null);
  const [venue, setVenue] = useState('');
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [list, any] = await Promise.all([listCourses(), hasAnyData()]);
    setCourses(list);
    setHasData(any);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  // Re-read whenever a sync finishes (new students, a class ended on the dashboard, ...)
  useEffect(() => {
    if (sync.state !== 'syncing') void load();
  }, [sync.state, sync.lastSyncAt, load]);

  const refresh = async () => {
    setRefreshing(true);
    await syncManager.syncNow();
    await load();
    setRefreshing(false);
  };

  const askStart = (course: LocalCourse) => {
    if (sync.state === 'replaced') {
      NativeAlert.alert('Used on another phone', 'You signed in on another phone. Take attendance there.');
      return;
    }
    if (sync.staleness === 'blocked') {
      NativeAlert.alert(
        'Sync needed',
        `This phone has not synced for ${Math.floor(sync.daysSinceSync ?? 0)} days. Connect to the internet so class lists are up to date before starting a new class.`,
      );
      return;
    }
    if (course.facesReady === 0) {
      NativeAlert.alert(
        'No faces enrolled',
        `None of the ${course.students} students in ${course.code} has a face this phone can recognise yet. You can still mark them by matric number.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Start anyway', onPress: () => confirmStale(course) },
        ],
      );
      return;
    }
    confirmStale(course);
  };

  const confirmStale = (course: LocalCourse) => {
    const open = () => {
      setVenue('');
      setTopic('');
      setStarting(course);
    };
    if (sync.staleness === 'strong') {
      NativeAlert.alert(
        'Class list may be out of date',
        `Last synced ${timeAgo(sync.lastSyncAt)}. Students who joined since then will not be recognised.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Start anyway', onPress: open },
        ],
      );
      return;
    }
    open();
  };

  const start = async () => {
    if (!starting) return;
    setBusy(true);
    try {
      const uuid = await startSession(starting.id, venue, topic);
      syncManager.poke();
      setStarting(null);
      navigation.navigate('TakeAttendance', { sessionUuid: uuid });
    } catch (err) {
      NativeAlert.alert('Could not start class', err instanceof LocalError ? err.message : String(err));
      setStarting(null);
      void load();
    } finally {
      setBusy(false);
    }
  };

  const askLogout = () => {
    const pending = sync.pending;
    NativeAlert.alert(
      'Log out?',
      pending > 0
        ? `${pending} attendance record${pending === 1 ? ' has' : 's have'} not reached the server yet and will be lost. Sync first if you can.`
        : 'Class lists and faces will be removed from this phone.',
      [
        { text: 'Cancel', style: 'cancel' },
        ...(pending > 0 ? [{ text: 'Sync now', onPress: () => void syncManager.syncNow() }] : []),
        { text: 'Log out', style: 'destructive' as const, onPress: () => void logout() },
      ],
    );
  };

  const header = (
    <View>
      <View className="mb-3 flex-row items-start gap-3">
        <View className="flex-1">
          <Text className="text-sm text-muted">Attendance mode</Text>
          <Text className="text-3xl font-bold tracking-tight text-foreground">{lecturer.display_name}</Text>
          <Text className="mt-0.5 text-xs text-muted">{lecturer.department}</Text>
        </View>
        <Button variant="ghost" size="sm" onPress={askLogout}>
          <Icon name="log-out-outline" size={18} color="accent" />
          <Button.Label>Log out</Button.Label>
        </Button>
      </View>
      <View className="mb-4 flex-row">
        <SyncBadge />
      </View>
      {sync.staleness === 'strong' || sync.staleness === 'blocked' ? (
        <Alert status="danger" className="mb-3">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Last synced {timeAgo(sync.lastSyncAt)}</Alert.Title>
            <Alert.Description>
              {sync.staleness === 'blocked'
                ? 'Connect to the internet before starting a new class.'
                : 'Class lists may be out of date. Connect to the internet soon.'}
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
      <Alert status="accent">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>Only attendance here</Alert.Title>
          <Alert.Description>Create courses and see logs and statistics on the dashboard: {DASHBOARD_URL}</Alert.Description>
        </Alert.Content>
      </Alert>
      <SectionTitle>Choose a course</SectionTitle>
    </View>
  );

  if (!courses) return <LoadingState message="Loading your courses…" />;

  const empty = hasData ? (
    <EmptyState icon="book-outline" title="No active courses" message="Create one on the dashboard first." />
  ) : (
    <EmptyState
      icon="cloud-download-outline"
      title={sync.state === 'syncing' ? 'Downloading your courses…' : 'Connect once to get started'}
      message="The first time, this phone needs the internet to download your courses and students' faces. After that it works offline."
      action={
        <Button onPress={() => void refresh()} isDisabled={sync.state === 'syncing'}>
          {sync.state === 'syncing' ? <Spinner color="white" /> : 'Download now'}
        </Button>
      }
    />
  );

  return (
    <Screen>
      <FlatList
        data={courses}
        keyExtractor={(c) => String(c.id)}
        contentContainerClassName="px-5 pb-10 pt-4"
        ItemSeparatorComponent={() => <View className="h-3" />}
        ListHeaderComponent={header}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
        ListEmptyComponent={empty}
        renderItem={({ item }) => {
          const live = item.liveSessionUuid != null;
          return (
            <Card className={`gap-2 p-4 ${live ? 'border-2 border-danger' : ''}`}>
              <View className="flex-row items-center justify-between">
                <Text className="text-lg font-bold text-foreground">{item.code}</Text>
                {live ? (
                  <Chip size="sm" variant="soft" color="danger">In session</Chip>
                ) : null}
              </View>
              <Text className="text-base text-foreground">{item.title}</Text>
              <View className="flex-row flex-wrap gap-x-4 gap-y-1">
                <View className="flex-row items-center gap-1.5">
                  <Icon name="people-outline" size={15} />
                  <Text className="text-sm text-muted">{item.students} student{item.students === 1 ? '' : 's'}</Text>
                </View>
                <View className="flex-row items-center gap-1.5">
                  <Icon name="scan-outline" size={15} />
                  <Text className="text-sm text-muted">{item.facesReady} recognisable</Text>
                </View>
                {item.needsUpdate > 0 ? (
                  <View className="flex-row items-center gap-1.5">
                    <Icon name="refresh-outline" size={15} color="warning" />
                    <Text className="text-sm text-warning">{item.needsUpdate} must re-scan their face</Text>
                  </View>
                ) : null}
              </View>
              <Button
                className="mt-2"
                variant={live ? 'danger' : 'primary'}
                onPress={() =>
                  live ? navigation.navigate('TakeAttendance', { sessionUuid: item.liveSessionUuid! }) : askStart(item)
                }
              >
                <Icon name={live ? 'play' : 'scan'} size={18} color={live ? 'danger-foreground' : 'accent-foreground'} />
                <Button.Label>{live ? 'Resume taking attendance' : 'Start class'}</Button.Label>
              </Button>
            </Card>
          );
        }}
      />

      {/* Optional venue / topic before starting */}
      <Dialog isOpen={starting !== null} onOpenChange={(open) => !open && !busy && setStarting(null)}>
        <Dialog.Portal>
          <Dialog.Overlay />
          <KeyboardAvoidingView behavior="padding">
            <Dialog.Content>
              <Dialog.Close />
              <Dialog.Title>Start {starting?.code}</Dialog.Title>
              <Dialog.Description className="mb-4">Venue and topic are optional.</Dialog.Description>
              <FormField label="Venue" value={venue} onChangeText={setVenue} placeholder="e.g. LT1" />
              <FormField label="Topic" value={topic} onChangeText={setTopic} placeholder="e.g. Dynamic programming" />
              <Button onPress={() => void start()} isDisabled={busy}>
                {busy ? <Spinner color="white" /> : 'Start taking attendance'}
              </Button>
            </Dialog.Content>
          </KeyboardAvoidingView>
        </Dialog.Portal>
      </Dialog>
    </Screen>
  );
}
