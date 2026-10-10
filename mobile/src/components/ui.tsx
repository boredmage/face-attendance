/**
 * App-wide building blocks on top of HeroUI Native: screen wrapper, page header, form field,
 * attendance meter / eligibility chip, and loading / error / empty states.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Button, Chip, FieldError, Input, Label, Spinner, TextField, useThemeColor, type ThemeColor } from 'heroui-native';
import React from 'react';
import { Text, View, type TextInputProps } from 'react-native';
import { SafeAreaView as RNSafeAreaView, type Edge } from 'react-native-safe-area-context';
import { withUniwind } from 'uniwind';

import { attendanceTone, type Tone } from '@/utils/attendance';

/** SafeAreaView that accepts `className` (third-party components need Uniwind's HOC). */
export const SafeAreaView = withUniwind(RNSafeAreaView);

export type IconName = React.ComponentProps<typeof Ionicons>['name'];

/** Ionicons tinted with a HeroUI theme colour (defaults to muted). */
export function Icon({
  name,
  size = 20,
  color = 'muted',
}: {
  name: IconName;
  size?: number;
  color?: ThemeColor;
}) {
  const tint = useThemeColor(color);
  return <Ionicons name={name} size={size} color={tint} />;
}

export function Screen({
  children,
  edges = ['top', 'left', 'right'],
  className,
}: {
  children: React.ReactNode;
  edges?: Edge[];
  className?: string;
}) {
  return (
    <SafeAreaView edges={edges} className={`flex-1 bg-background ${className ?? ''}`}>
      {children}
    </SafeAreaView>
  );
}

/** Large page title with an optional subtitle and trailing action. */
export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <View className="mb-5 flex-row items-start gap-3">
      <View className="flex-1">
        <Text className="text-3xl font-bold tracking-tight text-foreground">{title}</Text>
        {subtitle ? <Text className="mt-1 text-sm text-muted">{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function SectionTitle({ children, right }: { children: string; right?: React.ReactNode }) {
  return (
    <View className="mb-3 mt-6 flex-row items-center justify-between">
      <Text className="text-xs font-semibold uppercase tracking-wider text-muted">{children}</Text>
      {right}
    </View>
  );
}

/** Labelled HeroUI text field with inline validation error. */
export function FormField({
  label,
  error,
  ...input
}: TextInputProps & { label: string; error?: string | null }) {
  return (
    <TextField isInvalid={!!error} className="mb-4">
      <Label>{label}</Label>
      <Input {...input} />
      {error ? <FieldError>{error}</FieldError> : null}
    </TextField>
  );
}

const TONE_BAR: Record<Tone, string> = { success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger' };
const TONE_TEXT: Record<Tone, string> = { success: 'text-success', warning: 'text-warning', danger: 'text-danger' };

/** Horizontal attendance bar with a tick at the exam-eligibility threshold. */
export function AttendanceBar({ pct, requiredPct, held }: { pct: number; requiredPct: number; held: number }) {
  const tone = attendanceTone(pct, held);
  return (
    <View className="h-2 overflow-hidden rounded-full bg-default">
      <View className={`h-2 rounded-full ${TONE_BAR[tone]}`} style={{ width: `${Math.min(100, held ? pct : 0)}%` }} />
      <View className="absolute top-0 h-2 w-0.5 bg-foreground/40" style={{ left: `${requiredPct}%` }} />
    </View>
  );
}

export function PercentText({ pct, held, className }: { pct: number; held: number; className?: string }) {
  return (
    <Text className={`font-bold ${held ? TONE_TEXT[attendanceTone(pct, held)] : 'text-muted'} ${className ?? ''}`}>
      {held ? `${Math.round(pct)}%` : '—'}
    </Text>
  );
}

/** "Eligible" / "Not eligible" for one course's exam. */
export function EligibilityChip({ eligible, held, size = 'sm' }: { eligible: boolean; held: number; size?: 'sm' | 'md' }) {
  if (!held) {
    return (
      <Chip size={size} variant="soft" color="default">
        No classes yet
      </Chip>
    );
  }
  return (
    <Chip size={size} variant="soft" color={eligible ? 'success' : 'danger'}>
      {eligible ? 'Eligible' : 'Not eligible'}
    </Chip>
  );
}

export function PresenceChip({ attended, live }: { attended: boolean; live?: boolean }) {
  if (attended) {
    return (
      <Chip size="sm" variant="soft" color="success">
        Present
      </Chip>
    );
  }
  if (live) {
    return (
      <Chip size="sm" variant="soft" color="accent">
        In progress
      </Chip>
    );
  }
  return (
    <Chip size="sm" variant="soft" color="danger">
      Absent
    </Chip>
  );
}

export function LoadingState({ message = 'Loading…' }: { message?: string }) {
  return (
    <View className="flex-1 items-center justify-center gap-3 bg-background p-8">
      <Spinner size="lg" />
      <Text className="text-sm text-muted">{message}</Text>
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View className="flex-1 items-center justify-center gap-4 bg-background p-8">
      <View className="size-14 items-center justify-center rounded-full bg-danger/10">
        <Icon name="cloud-offline-outline" size={28} color="danger" />
      </View>
      <Text className="text-center text-base text-foreground">{message}</Text>
      {onRetry ? (
        <Button variant="secondary" onPress={onRetry}>
          Try again
        </Button>
      ) : null}
    </View>
  );
}

export function EmptyState({ icon, title, message, action }: { icon: IconName; title: string; message?: string; action?: React.ReactNode }) {
  return (
    <View className="items-center gap-2 px-6 py-12">
      <View className="mb-2 size-14 items-center justify-center rounded-full bg-accent/10">
        <Icon name={icon} size={26} color="accent" />
      </View>
      <Text className="text-center text-base font-semibold text-foreground">{title}</Text>
      {message ? <Text className="text-center text-sm text-muted">{message}</Text> : null}
      {action ? <View className="mt-3 self-stretch">{action}</View> : null}
    </View>
  );
}

/** Small "offline — cached data" banner. */
export function OfflineNote() {
  return (
    <View className="mb-4 flex-row items-center gap-2 rounded-xl bg-warning/10 px-3 py-2">
      <Icon name="cloud-offline-outline" size={16} color="warning" />
      <Text className="text-xs text-warning">Offline — showing the last saved data</Text>
    </View>
  );
}
