/** One course's attendance and exam eligibility, as a tappable card (Home and My Courses). */
import { Card } from 'heroui-native';
import React from 'react';
import { Pressable, Text, View } from 'react-native';

import type { CourseSummary } from '@/api/types';
import { standingText } from '@/utils/attendance';

import { AttendanceBar, EligibilityChip, PercentText } from './ui';

export function StandingCard({ course: c, onPress, showLecturer }: { course: CourseSummary; onPress: () => void; showLecturer?: boolean }) {
  return (
    <Pressable onPress={onPress} className="active:opacity-80">
      <Card className="gap-3 p-4">
        <View className="flex-row items-start gap-3">
          <View className="flex-1">
            <Text className="text-base font-bold text-foreground">{c.code}</Text>
            <Text className="text-sm text-muted" numberOfLines={2}>{c.title}</Text>
            {showLecturer ? <Text className="mt-0.5 text-xs text-muted">{c.lecturer_name}</Text> : null}
          </View>
          <View className="items-end gap-1">
            <PercentText pct={c.attendance_pct} held={c.classes_held} className="text-2xl" />
            <EligibilityChip eligible={c.eligible} held={c.classes_held} />
          </View>
        </View>
        <AttendanceBar pct={c.attendance_pct} requiredPct={c.required_pct} held={c.classes_held} />
        <View className="flex-row justify-between">
          <Text className="text-xs text-muted">
            {c.classes_attended} of {c.classes_held} classes attended
          </Text>
          <Text className="text-xs text-muted">Exam needs {c.required_pct}%</Text>
        </View>
        <Text className="text-sm text-foreground">{standingText(c)}</Text>
      </Card>
    </Pressable>
  );
}
