/**
 * Circular cut-out overlay drawn on top of the camera preview.
 *
 * The ring turns green when a face is detected inside the frame. For Face-ID style enrolment it
 * also draws four arc segments around the ring (up / right / down / left) that fill in as each
 * head pose is captured, plus the ring itself for the straight-on pose. For the attendance liveness
 * challenge it can instead draw a countdown arc that shrinks as time runs out.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Mask, Path, Rect } from 'react-native-svg';

import { colors } from '@/theme';

export type PoseKey = 'center' | 'left' | 'right' | 'up' | 'down';
export const POSE_ORDER: PoseKey[] = ['center', 'left', 'right', 'up', 'down'];

export interface PoseProgress {
  captured: PoseKey[];
  /** Pose the user is currently being asked for (drawn emphasised). */
  target: PoseKey | null;
}

export interface Size {
  width: number;
  height: number;
}

/** Geometry of the face guide circle for a camera view of the given size. Shared with the pose logic. */
export function guideCircle({ width, height }: Size) {
  const r = Math.min(width, height) * 0.36;
  return { cx: width / 2, cy: height * 0.42, r };
}

// Screen-space angle (SVG convention: 0° = right, 90° = down) of each pose's arc segment
const SEGMENT_ANGLE: Record<Exclude<PoseKey, 'center'>, number> = { up: -90, right: 0, down: 90, left: 180 };
const SEGMENT_SPAN = 64;
const PENDING = 'rgba(255,255,255,0.35)';

function arcPath(cx: number, cy: number, r: number, centreDeg: number, spanDeg: number) {
  const start = ((centreDeg - spanDeg / 2) * Math.PI) / 180;
  const end = ((centreDeg + spanDeg / 2) * Math.PI) / 180;
  const x1 = cx + r * Math.cos(start);
  const y1 = cy + r * Math.sin(start);
  const x2 = cx + r * Math.cos(end);
  const y2 = cy + r * Math.sin(end);
  return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
}

export function FaceGuideOverlay({
  size,
  faceDetected,
  hint,
  poses,
  countdown,
}: {
  size: Size;
  faceDetected: boolean;
  hint: string;
  poses?: PoseProgress;
  /** Fraction of the liveness time left (1 -> 0); draws a shrinking arc around the ring. */
  countdown?: number | null;
}) {
  const { width, height } = size;
  if (width === 0 || height === 0) return null;
  const { cx, cy, r } = guideCircle(size);
  const centreDone = poses?.captured.includes('center') ?? false;
  const ringColor = centreDone || faceDetected ? colors.success : colors.white;
  const segmentRadius = r + 16;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={width} height={height}>
        <Defs>
          <Mask id="hole">
            <Rect width={width} height={height} fill="white" />
            <Circle cx={cx} cy={cy} r={r} fill="black" />
          </Mask>
        </Defs>
        {/* Dim everything except the circle */}
        <Rect width={width} height={height} fill="rgba(0,0,0,0.55)" mask="url(#hole)" />
        <Circle
          cx={cx}
          cy={cy}
          r={r}
          stroke={ringColor}
          strokeWidth={4}
          fill="none"
          strokeDasharray={faceDetected || centreDone ? undefined : '14 10'}
        />
        {poses
          ? (Object.keys(SEGMENT_ANGLE) as Array<keyof typeof SEGMENT_ANGLE>).map((pose) => {
              const captured = poses.captured.includes(pose);
              const isTarget = poses.target === pose;
              return (
                <Path
                  key={pose}
                  d={arcPath(cx, cy, segmentRadius, SEGMENT_ANGLE[pose], SEGMENT_SPAN)}
                  stroke={captured ? colors.success : isTarget ? colors.white : PENDING}
                  strokeWidth={captured || isTarget ? 7 : 4}
                  strokeLinecap="round"
                  fill="none"
                />
              );
            })
          : null}
        {countdown != null ? (
          <Circle
            cx={cx}
            cy={cy}
            r={segmentRadius}
            stroke={countdown > 0.3 ? colors.white : colors.warning}
            strokeWidth={6}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${2 * Math.PI * segmentRadius} ${2 * Math.PI * segmentRadius}`}
            strokeDashoffset={2 * Math.PI * segmentRadius * (1 - Math.max(0, Math.min(1, countdown)))}
            rotation={-90}
            origin={`${cx}, ${cy}`}
          />
        ) : null}
      </Svg>
      <View style={[styles.hintBox, { top: cy + segmentRadius + 22 }]}>
        <Text style={[styles.hint, faceDetected && { color: colors.success }]}>{hint}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hintBox: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: 24 },
  hint: { color: colors.white, fontSize: 16, fontWeight: '600', textAlign: 'center' },
});
