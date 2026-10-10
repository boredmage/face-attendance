/**
 * One-time face enrolment, Face-ID style.
 *
 * The student looks straight at the camera, then slowly turns their head left, right, up and
 * down. Each time the head holds a required pose inside the guide circle, a photo is captured
 * automatically and the matching segment of the ring fills in. The five photos are then sent
 * to /student/enrol-face, which stores one DeepFace embedding per pose so the lecturer's phone
 * can recognise the student in class from any reasonable angle.
 *
 * Used twice: as the mandatory last step of registration (the navigator only unlocks the app once
 * the refreshed student has `face_enrolled`), and later from Home to re-enrol.
 */
import { useNavigation } from '@react-navigation/native';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Button, Spinner } from 'heroui-native';
import { Text, Vibration, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { studentApi } from '@/api/endpoints';
import { type CapturedImage, FaceCamera, type FaceCameraHandle, type FacePose } from '@/components/FaceCamera';
import { POSE_ORDER, type PoseKey } from '@/components/FaceGuideOverlay';
import { Icon, SafeAreaView } from '@/components/ui';
import { useAuth, useStudent } from '@/context/AuthContext';

type Phase = { kind: 'capturing' } | { kind: 'uploading' } | { kind: 'done'; images: number } | { kind: 'error'; message: string };

// Head-angle thresholds (degrees) for each pose
const CENTER_MAX = 12;
const TURN_MIN = 20;
const TILT_MIN = 14;
// A pose must be seen this many consecutive times (~5 reports/s) before the photo is taken,
// so we never capture mid-movement.
const HOLD_REPORTS = 2;

const POSE_HINT: Record<PoseKey, string> = {
  center: 'Look straight at the camera and hold still',
  left: 'Slowly turn your head to the left',
  right: 'Now slowly turn your head to the right',
  up: 'Tilt your head up a little',
  down: 'And now tilt your head down',
};

/** Which enrolment pose (if any) the current head position satisfies. */
function classify(face: FacePose): PoseKey | null {
  if (!face.inGuide) return null;
  const yaw = Math.abs(face.yaw);
  const pitch = Math.abs(face.pitch);
  if (yaw <= CENTER_MAX && pitch <= CENTER_MAX) return 'center';
  if (yaw >= TURN_MIN && yaw >= pitch) return face.turn < 0 ? 'left' : face.turn > 0 ? 'right' : null;
  if (pitch >= TILT_MIN) return face.pitch > 0 ? 'up' : 'down';
  return null;
}

export function EnrolFaceScreen() {
  const navigation = useNavigation();
  const { refreshStudent } = useAuth();
  // First enrolment: refreshing the student swaps the whole navigator, so only do it on "Continue"
  const student = useStudent();
  const firstEnrolment = useRef(!student.face_enrolled).current;
  const [finishing, setFinishing] = useState(false);
  const cameraRef = useRef<FaceCameraHandle>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'capturing' });
  const [captured, setCaptured] = useState<Partial<Record<PoseKey, CapturedImage>>>({});
  const [face, setFace] = useState<FacePose | null>(null);

  // Mutable capture bookkeeping that must not lag behind renders
  const capturedRef = useRef(captured);
  const hold = useRef<{ pose: PoseKey | null; count: number }>({ pose: null, count: 0 });
  const capturing = useRef(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const capturedKeys = useMemo(() => POSE_ORDER.filter((p) => captured[p]), [captured]);
  const target = POSE_ORDER.find((p) => !captured[p]) ?? null;

  const reset = useCallback(() => {
    capturedRef.current = {};
    hold.current = { pose: null, count: 0 };
    setCaptured({});
    setPhase({ kind: 'capturing' });
  }, []);

  const upload = useCallback(
    async (images: Record<PoseKey, CapturedImage>) => {
      setPhase({ kind: 'uploading' });
      try {
        const result = await studentApi.enrolFace(POSE_ORDER.map((p) => images[p].uri));
        if (!firstEnrolment) await refreshStudent().catch(() => undefined);
        setPhase({ kind: 'done', images: result.images_used });
      } catch (err) {
        setPhase({ kind: 'error', message: errorMessage(err, 'Enrolment failed') });
      }
    },
    [refreshStudent, firstEnrolment],
  );

  const finish = useCallback(async () => {
    if (!firstEnrolment) {
      navigation.goBack();
      return;
    }
    setFinishing(true);
    try {
      await refreshStudent(); // face_enrolled is now true -> the navigator opens the app
    } catch (err) {
      setFinishing(false);
      setPhase({ kind: 'error', message: errorMessage(err, 'Could not reach the server') });
    }
  }, [firstEnrolment, navigation, refreshStudent]);

  const capturePose = useCallback(
    async (pose: PoseKey) => {
      if (!cameraRef.current || capturing.current) return;
      capturing.current = true;
      try {
        const image = await cameraRef.current.capture();
        if (phaseRef.current.kind !== 'capturing') return;
        const next = { ...capturedRef.current, [pose]: image };
        capturedRef.current = next;
        setCaptured(next);
        Vibration.vibrate(30);
        if (POSE_ORDER.every((p) => next[p])) {
          await upload(next as Record<PoseKey, CapturedImage>);
        }
      } catch {
        // Photo failed (e.g. camera busy); the pose will simply be retried on the next report
      } finally {
        capturing.current = false;
        hold.current = { pose: null, count: 0 };
      }
    },
    [upload],
  );

  const onFace = useCallback(
    (pose: FacePose | null) => {
      setFace(pose);
      if (phaseRef.current.kind !== 'capturing' || capturing.current) return;
      const key = pose ? classify(pose) : null;
      // The frontal photo is the reference the server compares the others against, so it goes first
      const wanted = key && !capturedRef.current[key] && (key === 'center' || capturedRef.current.center);
      if (!wanted) {
        hold.current = { pose: null, count: 0 };
        return;
      }
      hold.current = hold.current.pose === key ? { pose: key, count: hold.current.count + 1 } : { pose: key, count: 1 };
      if (hold.current.count >= HOLD_REPORTS) void capturePose(key);
    },
    [capturePose],
  );

  if (phase.kind === 'done') {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-background p-8">
        <View className="mb-5 size-24 items-center justify-center rounded-full bg-success/15">
          <Icon name="checkmark" size={52} color="success" />
        </View>
        <Text className="text-2xl font-bold text-foreground">Face enrolled</Text>
        <Text className="mt-2 text-center text-base text-muted">
          {phase.images} photos of your face were saved. In class, look at your lecturer's phone and follow the
          on-screen prompts to be marked present.
        </Text>
        <Button size="lg" className="mt-8 self-stretch" onPress={() => void finish()} isDisabled={finishing}>
          {finishing ? <Spinner color="white" /> : 'Continue'}
        </Button>
      </SafeAreaView>
    );
  }

  let hint: string;
  if (!face) hint = 'Position your face inside the circle';
  else if (!face.inGuide) hint = 'Centre your face in the circle';
  else if (target) hint = POSE_HINT[target];
  else hint = 'All done';

  return (
    <View className="flex-1 bg-black">
      <FaceCamera
        ref={cameraRef}
        active={phase.kind === 'capturing'}
        onFace={onFace}
        hint={phase.kind === 'capturing' ? hint : ' '}
        poses={{ captured: capturedKeys, target }}
      />
      <SafeAreaView edges={['bottom']} className="absolute left-0 right-0 bottom-0 p-4">
        <View className="items-center gap-2 rounded-3xl bg-surface p-5">
          {phase.kind === 'error' ? (
            <>
              <Icon name="alert-circle" size={32} color="danger" />
              <Text className="text-center text-base text-foreground">{phase.message}</Text>
              <Button className="mt-2 self-stretch" onPress={reset}>Try again</Button>
            </>
          ) : phase.kind === 'uploading' ? (
            <>
              <Spinner size="lg" />
              <Text className="text-center text-sm text-muted">Saving your face… this can take a few seconds</Text>
            </>
          ) : (
            <>
              <View className="mb-1 flex-row gap-1.5 self-stretch">
                {POSE_ORDER.map((p) => (
                  <View key={p} className={`h-1.5 flex-1 rounded-full ${captured[p] ? 'bg-success' : p === target ? 'bg-accent' : 'bg-default'}`} />
                ))}
              </View>
              <Text className="text-lg font-bold text-foreground">
                {capturedKeys.length} of {POSE_ORDER.length} captured
              </Text>
              <Text className="text-center text-sm text-muted">
                Keep your face inside the circle and move your head slowly to fill the ring. Good lighting, no glasses or cap.
              </Text>
              {capturedKeys.length > 0 ? (
                <Button variant="ghost" size="sm" onPress={reset}>Start over</Button>
              ) : null}
            </>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

