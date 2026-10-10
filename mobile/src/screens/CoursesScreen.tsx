/** My Courses: attendance and exam eligibility per course, plus the way into the course catalogue. */
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button } from 'heroui-native';
import React, { useCallback, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { studentApi } from '@/api/endpoints';
import type { CourseSummary } from '@/api/types';
import { StandingCard } from '@/components/StandingCard';
import { EmptyState, ErrorState, Icon, LoadingState, PageHeader, Screen } from '@/components/ui';
import { cacheGet, cacheSet } from '@/db/database';
import type { RootStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;
const CACHE_KEY = 'courses:v2';

export function CoursesScreen() {
  const navigation = useNavigation<Nav>();
  const [courses, setCourses] = useState<CourseSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await studentApi.courses();
      setCourses(list);
      await cacheSet(CACHE_KEY, list);
    } catch (err) {
      const cached = await cacheGet<CourseSummary[]>(CACHE_KEY);
      if (cached) setCourses(cached);
      else setError(errorMessage(err));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!courses && !error) return <LoadingState message="Loading courses…" />;
  if (!courses && error) return <ErrorState message={error} onRetry={load} />;

  const eligible = courses!.filter((c) => c.classes_held > 0 && c.eligible).length;
  const rated = courses!.filter((c) => c.classes_held > 0).length;

  return (
    <Screen>
      <FlatList
        data={courses}
        keyExtractor={(c) => String(c.id)}
        contentContainerClassName="px-5 pb-10 pt-4"
        ItemSeparatorComponent={() => <View className="h-3" />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}
        ListHeaderComponent={
          <PageHeader
            title="My courses"
            subtitle={rated ? `Eligible for ${eligible} of ${rated} exams so far` : 'Attendance and exam eligibility per course'}
            right={
              <Button size="sm" variant="secondary" onPress={() => navigation.navigate('Catalog')}>
                <Icon name="add" size={18} color="accent" />
                <Button.Label>Join</Button.Label>
              </Button>
            }
          />
        }
        ListEmptyComponent={
          <EmptyState
            icon="book-outline"
            title="No courses yet"
            message="Browse the catalogue to join the courses you're taking."
            action={<Button onPress={() => navigation.navigate('Catalog')}>Browse courses</Button>}
          />
        }
        renderItem={({ item }) => (
          <StandingCard course={item} showLecturer onPress={() => navigation.navigate('CourseDetail', { courseId: item.id, code: item.code })} />
        )}
      />
    </Screen>
  );
}
