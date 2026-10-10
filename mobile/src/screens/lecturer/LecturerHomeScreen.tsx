/**
 * Lecturer mode home. The app is for taking attendance ONLY: pick a course, start (or resume)
 * its class, scan students, end it. Course management, logs and statistics live on the dashboard.
 */
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Alert, Button, Card, Chip, Dialog, Spinner } from 'heroui-native';
import React, { useCallback, useState } from 'react';
import { Alert as NativeAlert, FlatList, KeyboardAvoidingView, RefreshControl, Text, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { lecturerApi } from '@/api/endpoints';
import type { LecturerCourse, SessionSummary } from '@/api/types';
import { EmptyState, ErrorState, FormField, Icon, LoadingState, Screen, SectionTitle } from '@/components/ui';
import { DASHBOARD_URL } from '@/config';
import { useAuth, useLecturer } from '@/context/AuthContext';
import type { LecturerStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<LecturerStackParamList>;

export function LecturerHomeScreen() {
  const navigation = useNavigation<Nav>();
  const lecturer = useLecturer();
  const { logout } = useAuth();
  const [courses, setCourses] = useState<LecturerCourse[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [starting, setStarting] = useState<LecturerCourse | null>(null);
  const [venue, setVenue] = useState('');
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setCourses((await lecturerApi.courses()).filter((c) => c.is_active));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Reload on focus so a class ended elsewhere (or on the dashboard) stops showing "Resume"
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const openScanner = (s: SessionSummary) =>
    navigation.navigate('TakeAttendance', {
      sessionId: s.id,
      courseCode: s.course_code,
      courseTitle: s.course_title,
      startedAt: s.started_at,
    });

  const resume = async (course: LecturerCourse) => {
    try {
      const detail = await lecturerApi.sessionDetail(course.live_session_id!);
      openScanner(detail.session);
    } catch (err) {
      NativeAlert.alert('Could not resume', errorMessage(err));
      void load();
    }
  };

  const askStart = (course: LecturerCourse) => {
    if (course.faces_enrolled === 0) {
      NativeAlert.alert(
        'No faces enrolled',
        `None of the ${course.students} students in ${course.code} has registered their face yet, so nobody can be recognised.`,
      );
      return;
    }
    setVenue('');
    setTopic('');
    setStarting(course);
  };

  const start = async () => {
    if (!starting) return;
    setBusy(true);
    try {
      const session = await lecturerApi.startSession(starting.id, venue, topic);
      setStarting(null);
      openScanner(session);
    } catch (err) {
      // 409 = another class is still running; refresh so its "Resume" button shows
      NativeAlert.alert('Could not start class', errorMessage(err));
      setStarting(null);
      void load();
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <View>
      <View className="mb-5 flex-row items-start gap-3">
        <View className="flex-1">
          <Text className="text-sm text-muted">Attendance mode</Text>
          <Text className="text-3xl font-bold tracking-tight text-foreground">{lecturer.display_name}</Text>
          <Text className="mt-0.5 text-xs text-muted">{lecturer.department}</Text>
        </View>
        <Button variant="ghost" size="sm" onPress={() => void logout()}>
          <Icon name="log-out-outline" size={18} color="accent" />
          <Button.Label>Log out</Button.Label>
        </Button>
      </View>
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

  if (!courses && !error) return <LoadingState message="Loading your courses…" />;
  if (!courses && error) return <ErrorState message={error} onRetry={load} />;

  return (
    <Screen>
      <FlatList
        data={courses}
        keyExtractor={(c) => String(c.id)}
        contentContainerClassName="px-5 pb-10 pt-4"
        ItemSeparatorComponent={() => <View className="h-3" />}
        ListHeaderComponent={header}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}
        ListEmptyComponent={<EmptyState icon="book-outline" title="No active courses" message="Create one on the dashboard first." />}
        renderItem={({ item }) => {
          const live = item.live_session_id != null;
          return (
            <Card className={`gap-2 p-4 ${live ? 'border-2 border-danger' : ''}`}>
              <View className="flex-row items-center justify-between">
                <Text className="text-lg font-bold text-foreground">{item.code}</Text>
                {live ? (
                  <Chip size="sm" variant="soft" color="danger">In session</Chip>
                ) : null}
              </View>
              <Text className="text-base text-foreground">{item.title}</Text>
              <View className="flex-row gap-4">
                <View className="flex-row items-center gap-1.5">
                  <Icon name="people-outline" size={15} />
                  <Text className="text-sm text-muted">{item.students} student{item.students === 1 ? '' : 's'}</Text>
                </View>
                <View className="flex-row items-center gap-1.5">
                  <Icon name="scan-outline" size={15} />
                  <Text className="text-sm text-muted">{item.faces_enrolled} face{item.faces_enrolled === 1 ? '' : 's'} enrolled</Text>
                </View>
              </View>
              <Button
                className="mt-2"
                variant={live ? 'danger' : 'primary'}
                onPress={() => (live ? void resume(item) : askStart(item))}
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
