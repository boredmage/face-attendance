/** Circular attendance gauge drawn with react-native-svg, coloured by exam standing. */
import { useThemeColor } from 'heroui-native';
import React from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { attendanceTone } from '@/utils/attendance';

export function CircularProgress({
  percent,
  held,
  requiredPct,
  size = 132,
  strokeWidth = 12,
  label,
}: {
  percent: number;
  held: number;
  requiredPct: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(100, held ? percent : 0));
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - clamped / 100);
  const tone = attendanceTone(percent, held, requiredPct);
  const [track, color] = useThemeColor(['default', tone]);

  return (
    <View style={{ width: size, height: size }} className="items-center justify-center">
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={strokeWidth} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={offset}
          rotation={-90}
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <View className="absolute items-center">
        <Text style={{ color: held ? color : undefined }} className="text-3xl font-bold text-muted">
          {held ? `${Math.round(clamped)}%` : '—'}
        </Text>
        {label ? <Text className="mt-0.5 text-xs text-muted">{label}</Text> : null}
      </View>
    </View>
  );
}
