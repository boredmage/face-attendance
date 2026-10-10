/** Short confirmation after a class ends. Full logs and statistics are on the dashboard. */
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card, Separator } from 'heroui-native';
import React from 'react';
import { Text, View } from 'react-native';

import { Icon, Screen } from '@/components/ui';
import type { LecturerStackParamList } from '@/navigation/types';
import { formatTime } from '@/utils/attendance';

export function SessionSummaryScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<LecturerStackParamList>>();
  const { params } = useRoute<RouteProp<LecturerStackParamList, 'SessionSummary'>>();
  const s = params.session;

  return (
    <Screen className="items-center justify-center px-6">
      <View className="mb-5 size-24 items-center justify-center rounded-full bg-success/15">
        <Icon name="checkmark" size={52} color="success" />
      </View>
      <Text className="text-3xl font-bold tracking-tight text-foreground">{s.course_code} ended</Text>
      <Text className="mb-8 mt-1 text-sm text-muted">
        {formatTime(s.started_at)} – {s.ended_at ? formatTime(s.ended_at) : 'now'}
        {s.duration_minutes != null ? ` · ${s.duration_minutes} min` : ''}
      </Text>

      <Card className="flex-row items-center self-stretch py-5">
        <Stat value={String(s.present)} label="Present" />
        <Separator orientation="vertical" />
        <Stat value={String(Math.max(0, s.expected - s.present))} label="Absent" />
        <Separator orientation="vertical" />
        <Stat value={`${Math.round(s.attendance_pct)}%`} label="Turnout" />
      </Card>

      <Text className="mt-4 text-center text-sm text-muted">The full attendance log for this class is on your dashboard.</Text>
      <Button size="lg" className="mt-8 self-stretch" onPress={() => navigation.popToTop()}>
        Done
      </Button>
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
