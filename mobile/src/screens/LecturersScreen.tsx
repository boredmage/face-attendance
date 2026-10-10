/** Lecturers of the student's courses, with their contact details. */
import { useFocusEffect } from '@react-navigation/native';
import { Avatar, Button, Card, Chip } from 'heroui-native';
import React, { useCallback, useState } from 'react';
import { FlatList, Linking, RefreshControl, Text, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { studentApi } from '@/api/endpoints';
import type { Lecturer } from '@/api/types';
import { EmptyState, ErrorState, Icon, LoadingState, PageHeader, Screen } from '@/components/ui';
import { cacheGet, cacheSet } from '@/db/database';

const initials = (name: string) =>
  name.replace(/^(Dr|Prof|Mr|Mrs|Ms)\.?\s+/i, '').split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

export function LecturersScreen() {
  const [lecturers, setLecturers] = useState<Lecturer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await studentApi.lecturers();
      setLecturers(list);
      await cacheSet('lecturers', list);
    } catch (err) {
      const cached = await cacheGet<Lecturer[]>('lecturers');
      if (cached) setLecturers(cached);
      else setError(errorMessage(err));
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Reload on focus so lecturers of newly joined courses appear
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!lecturers && !error) return <LoadingState message="Loading lecturers…" />;
  if (!lecturers && error) return <ErrorState message={error} onRetry={load} />;

  return (
    <Screen>
      <FlatList
        data={lecturers}
        keyExtractor={(l) => String(l.id)}
        contentContainerClassName="px-5 pb-10 pt-4"
        ItemSeparatorComponent={() => <View className="h-3" />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}
        ListHeaderComponent={<PageHeader title="Lecturers" subtitle="Who teaches your courses, and how to reach them" />}
        ListEmptyComponent={<EmptyState icon="people-outline" title="No lecturers yet" message="Join a course to see its lecturer here." />}
        renderItem={({ item }) => (
          <Card className="gap-3 p-4">
            <View className="flex-row items-center gap-3">
              <Avatar alt={item.name}>
                <Avatar.Fallback>{initials(item.name)}</Avatar.Fallback>
              </Avatar>
              <View className="flex-1">
                <Text className="text-base font-semibold text-foreground">{item.name}</Text>
                <Text className="text-sm text-muted">{item.department}</Text>
              </View>
            </View>
            <View className="flex-row flex-wrap gap-1.5">
              {item.courses.map((c) => (
                <Chip key={c} size="sm" variant="soft" color="accent">{c}</Chip>
              ))}
            </View>
            {item.office ? (
              <View className="flex-row items-center gap-2">
                <Icon name="business-outline" size={16} />
                <Text className="text-sm text-muted">{item.office}</Text>
              </View>
            ) : null}
            {item.email || item.phone ? (
              <View className="flex-row gap-2">
                {item.email ? (
                  <Button size="sm" variant="secondary" className="flex-1" onPress={() => void Linking.openURL(`mailto:${item.email}`)}>
                    <Icon name="mail-outline" size={16} color="accent" />
                    <Button.Label>Email</Button.Label>
                  </Button>
                ) : null}
                {item.phone ? (
                  <Button size="sm" variant="secondary" className="flex-1" onPress={() => void Linking.openURL(`tel:${item.phone}`)}>
                    <Icon name="call-outline" size={16} color="accent" />
                    <Button.Label>Call</Button.Label>
                  </Button>
                ) : null}
              </View>
            ) : (
              <Text className="text-xs text-muted">No contact details shared.</Text>
            )}
          </Card>
        )}
      />
    </Screen>
  );
}
