/**
 * Front camera preview with on-device face detection (react-native-vision-camera +
 * Google ML Kit via react-native-vision-camera-face-detector's `useFaceDetector` hook).
 *
 * We render VisionCamera's own `Camera` and run the detector in a frame processor ourselves
 * instead of using the face-detector package's `Camera` wrapper: that wrapper (v1.8+) reads
 * `ref` as a plain prop, which only works on React 19, and it always calls
 * `useSkiaFrameProcessor`, which requires the optional @shopify/react-native-skia package.
 * Doing it here keeps the camera ref (needed for `takePhoto`) working on React 18.
 *
 * Used both by the student's Face-ID style enrolment (front camera) and by the lecturer's
 * attendance scanner (front or back camera, with eye-open / smile classification for the liveness challenge).
 *
 * Reports two things to the parent a few times per second:
 *   - `onFaceStateChange(detected)`  - whether a face is in view (drives the green ring)
 *   - `onFace(pose | null)`          - head angles, eye-open / smile probabilities (when `classify`) and
 *                                      whether the face sits inside the guide circle
 *
 * Exposes `capture()` through a ref: it takes a photo, downsizes/compresses it to JPEG (with
 * the EXIF rotation applied) and returns its file URI and size, ready for src/face/embed.ts.
 * The camera must stay `active` while `capture()` runs.
 */
import * as ImageManipulator from 'expo-image-manipulator';
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import {
  Camera,
  runAtTargetFps,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import { useFaceDetector, type Face, type FrameFaceDetectionOptions } from 'react-native-vision-camera-face-detector';
import { Worklets } from 'react-native-worklets-core';

import { Button } from 'heroui-native';

import { CAPTURE_JPEG_QUALITY, CAPTURE_MAX_WIDTH } from '@/config';
import { discardFiles } from '@/utils/files';

import { FaceGuideOverlay, guideCircle, type PoseProgress, type Size } from './FaceGuideOverlay';

export interface CapturedImage {
  uri: string;
  width: number;
  height: number;
}

export interface FaceCameraHandle {
  capture(): Promise<CapturedImage>;
}

export interface FacePose {
  /** Head turn in degrees (ML Kit yaw). Use `turn` for the on-screen direction. */
  yaw: number;
  /** Head tilt in degrees. Positive = looking up. */
  pitch: number;
  roll: number;
  /**
   * Which side of the *screen* the face is turned towards: -1 = left, 1 = right, 0 = facing the
   * camera. Derived from the nose position inside the face box, so it matches the mirrored
   * preview the user sees regardless of how the camera frame is oriented.
   */
  turn: -1 | 0 | 1;
  /** True when the face is centred inside the guide circle at a usable size. */
  inGuide: boolean;
  /** Face box in the camera view's coordinate space (same space as the overlay). */
  bounds: { x: number; y: number; width: number; height: number };
  /** Average of ML Kit's left/right eye-open probabilities (0..1); null unless `classify` is on. */
  eyesOpen: number | null;
  /** ML Kit's smiling probability (0..1); null unless `classify` is on. */
  smiling: number | null;
}

export type CameraFacing = 'front' | 'back';

interface Props {
  active: boolean;
  onFaceStateChange?: (detected: boolean) => void;
  onFace?: (pose: FacePose | null) => void;
  /** Overrides the default "position your face" hint text. */
  hint?: string;
  /** Multi-pose progress to draw around the guide ring. */
  poses?: PoseProgress;
  /** Liveness countdown (fraction of time left) to draw around the guide ring. */
  countdown?: number | null;
  /** Which camera to use. Default 'front'. */
  facing?: CameraFacing;
  /** Also report eye-open and smile probabilities (needed for the liveness challenge). Default false. */
  classify?: boolean;
  /** How often ML Kit runs on the stream. Default 5, or 12 when `classify` is on so blinks aren't missed. */
  detectionFps?: number;
}

// Shape of what the frame-processor worklet sends back to the JS thread
interface RawFace {
  yaw: number;
  pitch: number;
  roll: number;
  bounds: { x: number; y: number; width: number; height: number };
  nose: { x: number; y: number } | null;
  leftEye: number | null;
  rightEye: number | null;
  smile: number | null;
}

// How often to run ML Kit on the camera stream. For enrolment guidance a few times per second is
// plenty and keeps the frame-processor thread free; a blink lasts ~150 ms, so liveness needs more.
const DETECTION_FPS = 5;
const CLASSIFY_FPS = 12;
// Below this |yaw| the head counts as facing the camera when working out `turn`
const TURN_DEAD_ZONE_DEG = 8;

const BASE_DETECTOR_OPTIONS: FrameFaceDetectionOptions = {
  performanceMode: 'fast',
  landmarkMode: 'all', // nose position tells us which way the head is turned on screen
  contourMode: 'none',
  classificationMode: 'none',
  minFaceSize: 0.2, // ignore tiny faces in the background
  trackingEnabled: false,
  autoMode: true, // scale/mirror results into the camera view's coordinate space
};

function largestFace(faces: Face[]): Face {
  'worklet';
  let best = faces[0];
  for (let i = 1; i < faces.length; i++) {
    const f = faces[i];
    if (f.bounds.width * f.bounds.height > best.bounds.width * best.bounds.height) best = f;
  }
  return best;
}

function toPose(raw: RawFace, size: Size): FacePose {
  const { cx, cy, r } = guideCircle(size);
  const faceCx = raw.bounds.x + raw.bounds.width / 2;
  const faceCy = raw.bounds.y + raw.bounds.height / 2;
  const offset = Math.hypot(faceCx - cx, faceCy - cy);
  const widthRatio = raw.bounds.width / (2 * r);
  const inGuide = offset <= r * 0.55 && widthRatio >= 0.3 && widthRatio <= 1.4;

  let turn: -1 | 0 | 1 = 0;
  if (Math.abs(raw.yaw) >= TURN_DEAD_ZONE_DEG) {
    // Nose drifts towards the side the face is turned to; fall back to the yaw sign without landmarks
    const noseOffset = raw.nose ? (raw.nose.x - faceCx) / raw.bounds.width : raw.yaw;
    turn = noseOffset < 0 ? -1 : 1;
  }
  const eyes = [raw.leftEye, raw.rightEye].filter((p): p is number => p != null && p >= 0);
  const eyesOpen = eyes.length ? eyes.reduce((a, b) => a + b, 0) / eyes.length : null;
  const smiling = raw.smile != null && raw.smile >= 0 ? raw.smile : null;
  return { yaw: raw.yaw, pitch: raw.pitch, roll: raw.roll, turn, inGuide, bounds: raw.bounds, eyesOpen, smiling };
}

export const FaceCamera = forwardRef<FaceCameraHandle, Props>(function FaceCamera(
  { active, onFaceStateChange, onFace, hint, poses, countdown, facing = 'front', classify = false, detectionFps },
  ref,
) {
  const camera = useRef<Camera>(null);
  const device = useCameraDevice(facing);
  const fps = detectionFps ?? (classify ? CLASSIFY_FPS : DETECTION_FPS);
  const { hasPermission, requestPermission } = useCameraPermission();
  const [faceDetected, setFaceDetected] = useState(false);
  const [viewSize, setViewSize] = useState<Size>({ width: 0, height: 0 });
  const lastState = useRef(false);
  const sizeRef = useRef(viewSize);
  const onFaceStateChangeRef = useRef(onFaceStateChange);
  const onFaceRef = useRef(onFace);
  const lastDebugLog = useRef(0);
  useEffect(() => {
    onFaceStateChangeRef.current = onFaceStateChange;
    onFaceRef.current = onFace;
  });

  // ML Kit scales its results to the window size we give it, so wait for the real view size
  const detectorOptions = useMemo<FrameFaceDetectionOptions>(
    () => ({
      ...BASE_DETECTOR_OPTIONS,
      cameraFacing: facing,
      classificationMode: classify ? 'all' : 'none',
      windowWidth: viewSize.width || 1,
      windowHeight: viewSize.height || 1,
    }),
    [viewSize.width, viewSize.height, facing, classify],
  );
  const { detectFaces } = useFaceDetector(detectorOptions);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    sizeRef.current = { width, height };
    setViewSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
  }, []);

  // Runs on the JS thread `fps` times per second
  const handleRaw = useCallback((raw: RawFace | null) => {
    const detected = raw != null;
    if (detected !== lastState.current) {
      lastState.current = detected;
      setFaceDetected(detected);
      onFaceStateChangeRef.current?.(detected);
    }
    if (!onFaceRef.current) return;
    const pose = raw ? toPose(raw, sizeRef.current) : null;
    if (__DEV__ && pose && Date.now() - lastDebugLog.current > 2000) {
      lastDebugLog.current = Date.now();
      console.log(
        `[FaceCamera] yaw=${pose.yaw.toFixed(0)} pitch=${pose.pitch.toFixed(0)} turn=${pose.turn} inGuide=${pose.inGuide} ` +
          `box=${Math.round(pose.bounds.x)},${Math.round(pose.bounds.y)} ${Math.round(pose.bounds.width)}x${Math.round(pose.bounds.height)} view=${sizeRef.current.width}x${sizeRef.current.height}`,
      );
    }
    onFaceRef.current(pose);
  }, []);
  // Bridge from the frame-processor worklet back to JS
  const report = useMemo(() => Worklets.createRunOnJS(handleRaw), [handleRaw]);

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';
      runAtTargetFps(fps, () => {
        'worklet';
        try {
          const faces = detectFaces(frame);
          if (faces.length === 0) {
            report(null);
            return;
          }
          const face = largestFace(faces);
          report({
            yaw: face.yawAngle,
            pitch: face.pitchAngle,
            roll: face.rollAngle,
            bounds: face.bounds,
            nose: face.landmarks?.NOSE_BASE ?? null,
            // ML Kit reports -1 / undefined when classification is off or it can't tell
            leftEye: face.leftEyeOpenProbability ?? null,
            rightEye: face.rightEyeOpenProbability ?? null,
            smile: face.smilingProbability ?? null,
          });
        } catch {
          // A frame ML Kit could not process; skip it rather than crash the processor
        }
      });
    },
    [detectFaces, report, fps],
  );

  useImperativeHandle(ref, () => ({
    async capture() {
      if (!camera.current) throw new Error('Camera not ready');
      const photo = await camera.current.takePhoto({ flash: 'off', enableShutterSound: false });
      // Compress: resize to CAPTURE_MAX_WIDTH and re-encode as JPEG
      const original = `file://${photo.path}`;
      try {
        const result = await ImageManipulator.manipulateAsync(
          original,
          [{ resize: { width: CAPTURE_MAX_WIDTH } }],
          { compress: CAPTURE_JPEG_QUALITY, format: ImageManipulator.SaveFormat.JPEG },
        );
        return { uri: result.uri, width: result.width, height: result.height };
      } finally {
        // Only the compressed copy is used; the caller deletes it when done (discardFiles)
        discardFiles(original);
      }
    },
  }));

  if (!hasPermission) {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-black p-8">
        <Text className="text-center text-base text-white">Camera access is needed to recognise faces.</Text>
        <Button onPress={() => void requestPermission()}>Grant camera permission</Button>
      </View>
    );
  }
  if (!device) {
    return (
      <View className="flex-1 items-center justify-center bg-black p-8">
        <Text className="text-base text-white">No {facing} camera found on this device.</Text>
      </View>
    );
  }

  const sized = viewSize.width > 0 && viewSize.height > 0;
  return (
    <View style={StyleSheet.absoluteFill} onLayout={onLayout}>
      <Camera
        ref={camera}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={active}
        photo
        frameProcessor={sized ? frameProcessor : undefined}
        pixelFormat="yuv"
      />
      <FaceGuideOverlay
        size={viewSize}
        faceDetected={faceDetected}
        poses={poses}
        countdown={countdown}
        hint={hint ?? (faceDetected ? 'Face detected — hold still' : 'Position your face inside the circle')}
      />
    </View>
  );
});

