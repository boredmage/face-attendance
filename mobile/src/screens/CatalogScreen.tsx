/**
 * Course catalogue: every active course, searchable. Joining is instant (no approval) and the
 * course's lecturer gets a notification on their dashboard.
 */
import { Alert, Button, Card, Chip, SearchField, Spinner } from 'heroui-native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert as NativeAlert, FlatList, RefreshControl, Text, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { studentApi } from '@/api/endpoints';
import type { CatalogCourse } from '@/api/types';
import { EmptyState, ErrorState, LoadingState, Screen } from '@/components/ui';

const SEARCH_DEBOUNCE_MS = 300;

export function CatalogScreen() {
  const [query, setQuery] = useState('');
  const [courses, setCourses] = useState<CatalogCourse[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [joining, setJoining] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const latest = useRef(0);

  const load = useCallback(async (q: string) => {
    const ticket = ++latest.current; // ignore responses to older searches
    setError(null);
    try {
      const list = await studentApi.catalog(q.trim() || undefined);
      if (ticket === latest.current) setCourses(list);
    } catch (err) {
      if (ticket === latest.current) setError(errorMessage(err));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => void load(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query, load]);

  const join = async (course: CatalogCourse) => {
    setJoining(course.id);
    setNotice(null);
    try {
      const res = await studentApi.join(course.id);
      setCourses((list) =>
        list?.map((c) => (c.id === course.id ? { ...c, joined: true, students: c.students + 1 } : c)) ?? list,
      );
      setNotice(`${res.message}. ${course.lecturer_name} has been notified.`);
    } catch (err) {
      NativeAlert.alert('Could not join', errorMessage(err));
    } finally {
      setJoining(null);
    }
  };

  const confirmJoin = (course: CatalogCourse) =>
    NativeAlert.alert(
      `Join ${course.code}?`,
      `${course.title}\n${course.lecturer_name}\n\nYour lecturer will be notified and your attendance will be recorded from the next class.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Join', onPress: () => void join(course) },
      ],
    );

  return (
    <Screen edges={['left', 'right']}>
      <View className="gap-3 px-5 pb-2 pt-3">
        <SearchField value={query} onChange={setQuery}>
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="Search by code, title or lecturer" autoCorrect={false} />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
        {notice ? (
          <Alert status="success">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>{notice}</Alert.Title>
            </Alert.Content>
          </Alert>
        ) : null}
      </View>

      {courses === null && !error ? (
        <LoadingState message="Loading courses…" />
      ) : courses === null && error ? (
        <ErrorState message={error} onRetry={() => void load(query)} />
      ) : (
        <FlatList
          data={courses}
          keyExtractor={(c) => String(c.id)}
          contentContainerClassName="px-5 pb-10 pt-2"
          ItemSeparatorComponent={() => <View className="h-3" />}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(query); }} />}
          ListEmptyComponent={
            <EmptyState icon="search-outline" title={query ? 'No matches' : 'No courses yet'} message={query ? 'No course matches your search.' : 'No courses are open yet.'} />
          }
          renderItem={({ item }) => (
            <Card className="gap-1 p-4">
              <View className="flex-row items-center justify-between">
                <Text className="text-base font-bold text-foreground">{item.code}</Text>
                {item.joined ? (
                  <Chip size="sm" variant="soft" color="success">Joined</Chip>
                ) : null}
              </View>
              <Text className="text-base text-foreground">{item.title}</Text>
              <Text className="text-sm text-muted">{item.lecturer_name} · {item.department}</Text>
              <View className="mt-1 flex-row flex-wrap gap-1.5">
                {[
                  item.units != null ? `${item.units} units` : null,
                  item.level ? `${item.level} level` : null,
                  item.semester ? `${item.semester} sem.` : null,
                  `${item.students} student${item.students === 1 ? '' : 's'}`,
                ]
                  .filter((t): t is string => !!t)
                  .map((t) => (
                    <Chip key={t} size="sm" variant="soft" color="default">{t}</Chip>
                  ))}
              </View>
              {item.description ? (
                <Text className="mt-1 text-sm text-muted" numberOfLines={3}>{item.description}</Text>
              ) : null}
              {!item.joined ? (
                <Button className="mt-3" onPress={() => confirmJoin(item)} isDisabled={joining !== null}>
                  {joining === item.id ? <Spinner color="white" /> : 'Join course'}
                </Button>
              ) : null}
            </Card>
          )}
        />
      )}
    </Screen>
  );
}
