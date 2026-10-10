/**
 * Student home: classes in session right now, exam eligibility for EACH course, recent history.
 *
 * Eligibility is judged course by course (attendance >= required_pct, 75%), never as an average
 * across courses: 100% in one course can't make up for 50% in another.
 *
 * Attendance is taken on the lecturer's phone, so a live class shows a banner telling the student
 * to go and show their face; while any class is live the screen re-polls every 10 s so the banner
 * flips to "marked present" moments after the lecturer's device recognises them.
 */
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Alert, Avatar, Button, Card, ListGroup, Separator } from 'heroui-native';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { studentApi } from '@/api/endpoints';
import type { CourseSummary, LiveClass, StudentDashboard } from '@/api/types';
import { StandingCard } from '@/components/StandingCard';
import { EmptyState, ErrorState, LoadingState, OfflineNote, PresenceChip, Screen, SectionTitle } from '@/components/ui';
import { useStudent } from '@/context/AuthContext';
import { cacheGet, cacheSet } from '@/db/database';
import type { RootStackParamList } from '@/navigation/types';
import { formatDate, formatTime } from '@/utils/attendance';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const LIVE_POLL_MS = 10000;
// v2: the dashboard now carries per-course standings instead of an overall average
const CACHE_KEY = 'dashboard:v2';

export function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const student = useStudent();
  const [data, setData] = useState<StudentDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [focused, setFocused] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const d = await studentApi.dashboard();
      setData(d);
      setFromCache(false);
      await cacheSet(CACHE_KEY, d);
    } catch (err) {
      // Offline: fall back to the last cached dashboard
      const cached = await cacheGet<StudentDashboard>(CACHE_KEY);
      if (cached) {
        setData(cached);
        setFromCache(true);
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Reload whenever the tab gains focus (e.g. after joining a course)
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      void load();
      return () => setFocused(false);
    }, [load]),
  );

  // Poll only while a class is live and this screen is visible
  const hasLive = (data?.live_classes.length ?? 0) > 0;
  useEffect(() => {
    if (!focused || !hasLive) return;
    const id = setInterval(() => void load(), LIVE_POLL_MS);
    return () => clearInterval(id);
  }, [focused, hasLive, load]);

  if (!data && !error) return <LoadingState message="Loading your dashboard…" />;
  if (!data && error) return <ErrorState message={error} onRetry={load} />;
  const d = data!;
  const firstName = student.full_name.split(' ')[0];
  const initials = student.full_name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const openCourse = (c: CourseSummary) => navigation.navigate('CourseDetail', { courseId: c.id, code: c.code });

  return (
    <Screen>
      <ScrollView
        contentContainerClassName="px-5 pb-10 pt-4"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}
      >
        {/* Header */}
        <View className="mb-6 flex-row items-center gap-3">
          <View className="flex-1">
            <Text className="text-sm text-muted">Welcome back</Text>
            <Text className="text-3xl font-bold tracking-tight text-foreground">{firstName}</Text>
            <Text className="mt-0.5 text-xs text-muted">
              {student.matric_no} · {student.level} Level · {student.department}
            </Text>
          </View>
          <Pressable onPress={() => navigation.navigate('Main', { screen: 'Profile' })} hitSlop={8}>
            <Avatar size="lg" alt={student.full_name}>
              <Avatar.Fallback>{initials}</Avatar.Fallback>
            </Avatar>
          </Pressable>
        </View>
        {fromCache ? <OfflineNote /> : null}

        {/* Classes in session now */}
        {d.live_classes.map((c) => <LiveBanner key={c.session_id} live={c} />)}

        {d.total_courses === 0 ? (
          <Card>
            <EmptyState
              icon="book-outline"
              title="No courses yet"
              message="Join the courses you're taking so your lecturers can record your attendance."
              action={<Button onPress={() => navigation.navigate('Catalog')}>Browse courses</Button>}
            />
          </Card>
        ) : (
          <>
            <EligibilitySummary courses={d.courses} />

            <SectionTitle
              right={
                <Button variant="ghost" size="sm" onPress={() => navigation.navigate('Main', { screen: 'Courses' })}>
                  All courses
                </Button>
              }
            >
              Exam eligibility by course
            </SectionTitle>
            <View className="gap-3">
              {d.courses.map((c) => <StandingCard key={c.id} course={c} onPress={() => openCourse(c)} />)}
            </View>

            <SectionTitle>Recent classes</SectionTitle>
            {d.recent.length === 0 ? (
              <Card>
                <Text className="text-sm text-muted">No classes have been held since you joined.</Text>
              </Card>
            ) : (
              <ListGroup>
                {d.recent.map((r, i) => (
                  <React.Fragment key={r.session_id}>
                    {i > 0 ? <Separator className="mx-4" /> : null}
                    <ListGroup.Item disabled>
                      <ListGroup.ItemContent>
                        <ListGroup.ItemTitle>{r.course_code}</ListGroup.ItemTitle>
                        <ListGroup.ItemDescription>
                          {formatDate(r.started_at)} · {formatTime(r.started_at)}
                          {r.marked_at ? ` · marked ${formatTime(r.marked_at)}` : ''}
                        </ListGroup.ItemDescription>
                      </ListGroup.ItemContent>
                      <ListGroup.ItemSuffix>
                        <PresenceChip attended={r.attended} />
                      </ListGroup.ItemSuffix>
                    </ListGroup.Item>
                  </React.Fragment>
                ))}
              </ListGroup>
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

/** Headline: how many courses the student currently qualifies for, and which ones they don't. */
function EligibilitySummary({ courses }: { courses: CourseSummary[] }) {
  const rated = courses.filter((c) => c.classes_held > 0);
  const failing = rated.filter((c) => !c.eligible);
  if (!rated.length) {
    return (
      <Alert status="default">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>No classes held yet</Alert.Title>
          <Alert.Description>Your exam eligibility for each course appears here once classes start.</Alert.Description>
        </Alert.Content>
      </Alert>
    );
  }
  if (!failing.length) {
    return (
      <Alert status="success">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>Eligible for all {rated.length} exam{rated.length === 1 ? '' : 's'}</Alert.Title>
          <Alert.Description>Every course is at or above {rated[0].required_pct}% attendance. Keep it up.</Alert.Description>
        </Alert.Content>
      </Alert>
    );
  }
  return (
    <Alert status="danger">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>
          Not eligible for {failing.length} of {rated.length} exam{rated.length === 1 ? '' : 's'}
        </Alert.Title>
        <Alert.Description>
          {failing.map((c) => c.code).join(', ')} {failing.length === 1 ? 'is' : 'are'} below {failing[0].required_pct}%
          attendance. Each course is judged on its own attendance.
        </Alert.Description>
      </Alert.Content>
    </Alert>
  );
}

function LiveBanner({ live }: { live: LiveClass }) {
  if (live.attended) {
    return (
      <Alert status="success" className="mb-3">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>You're marked present</Alert.Title>
          <Alert.Description>{live.course_code} · {live.course_title}</Alert.Description>
        </Alert.Content>
      </Alert>
    );
  }
  return (
    <Alert status="accent" className="mb-3">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{live.course_code} is in session</Alert.Title>
        <Alert.Description>
          Show your face to {live.lecturer_name}'s device to be marked present. Started {formatTime(live.started_at)}
          {live.venue ? ` · ${live.venue}` : ''}.
        </Alert.Description>
      </Alert.Content>
    </Alert>
  );
}
