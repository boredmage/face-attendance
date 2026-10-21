/** Course detail: attendance gauge, exam eligibility for this course, and every class of the course. */
import type { RouteProp } from '@react-navigation/native';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { Alert, Card, ListGroup, Separator } from 'heroui-native';
import React, { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { studentApi } from '@/api/endpoints';
import type { CourseDetail } from '@/api/types';
import { CircularProgress } from '@/components/CircularProgress';
import { EligibilityChip, ErrorState, LoadingState, PresenceChip, Screen, SectionTitle } from '@/components/ui';
import { cacheGet, cacheSet } from '@/db/database';
import type { RootStackParamList } from '@/navigation/types';
import { formatDate, formatTime, standingText } from '@/utils/attendance';

export function CourseDetailScreen() {
  const { params } = useRoute<RouteProp<RootStackParamList, 'CourseDetail'>>();
  const [detail, setDetail] = useState<CourseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const key = `course:v2:${params.courseId}`;
    try {
      const d = await studentApi.courseDetail(params.courseId);
      setDetail(d);
      await cacheSet(key, d);
    } catch (err) {
      const cached = await cacheGet<CourseDetail>(key);
      if (cached) setDetail(cached);
      else setError(errorMessage(err));
    }
  }, [params.courseId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!detail && !error) return <LoadingState />;
  if (!detail && error) return <ErrorState message={error} onRetry={load} />;
  const d = detail!;
  const missed = d.classes_held - d.classes_attended;

  return (
    <Screen edges={['left', 'right']}>
      <ScrollView contentContainerClassName="px-5 pb-10 pt-2">
        <Text className="text-2xl font-bold tracking-tight text-foreground">{d.title}</Text>
        <Text className="mt-1 text-sm text-muted">{d.lecturer_name} · {d.lecturer_department}</Text>
        <Text className="mb-5 text-xs text-muted">Joined {formatDate(d.joined_at)}</Text>

        <Card className="mb-4 flex-row items-center gap-5 p-5">
          <CircularProgress percent={d.attendance_pct} held={d.classes_held} requiredPct={d.required_pct} label="attendance" />
          <View className="flex-1 gap-3">
            <EligibilityChip eligible={d.eligible} held={d.classes_held} size="md" />
            <Stat value={d.classes_held} label="classes held" />
            <Stat value={d.classes_attended} label="attended" />
            <Stat value={missed} label="missed" />
          </View>
        </Card>

        {d.classes_held > 0 ? (
          <Alert status={d.eligible ? (d.can_miss === 0 ? 'warning' : 'success') : 'danger'}>
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>
                {d.eligible ? `Eligible for the ${params.code} exam` : `Not eligible for the ${params.code} exam yet`}
              </Alert.Title>
              <Alert.Description>
                {standingText(d)} The exam requires at least {d.required_pct}% attendance in this course.
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}

        <SectionTitle>Attendance history</SectionTitle>
        {d.sessions.length === 0 ? (
          <Card>
            <Text className="text-sm text-muted">No classes have been held yet.</Text>
          </Card>
        ) : (
          <ListGroup>
            {d.sessions.map((s, i) => {
              const live = s.ended_at === null;
              return (
                <React.Fragment key={s.session_id}>
                  {i > 0 ? <Separator className="mx-4" /> : null}
                  <ListGroup.Item disabled>
                    <ListGroup.ItemContent>
                      <ListGroup.ItemTitle>{formatDate(s.started_at)}</ListGroup.ItemTitle>
                      <ListGroup.ItemDescription>
                        {formatTime(s.started_at)} – {live ? 'now' : formatTime(s.ended_at!)}
                        {s.venue ? ` · ${s.venue}` : ''}
                        {s.topic ? `\n${s.topic}` : ''}
                        {s.marked_at ? `\nMarked at ${formatTime(s.marked_at)}` : ''}
                      </ListGroup.ItemDescription>
                    </ListGroup.ItemContent>
                    <ListGroup.ItemSuffix>
                      <PresenceChip attended={s.attended} live={live} />
                    </ListGroup.ItemSuffix>
                  </ListGroup.Item>
                </React.Fragment>
              );
            })}
          </ListGroup>
        )}
      </ScrollView>
    </Screen>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <Text className="text-sm text-muted">
      <Text className="text-lg font-bold text-foreground">{value}</Text> {label}
    </Text>
  );
}
