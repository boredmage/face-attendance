/**
 * Lecturer's attendance scanner: a continuous kiosk that students walk up to one at a time.
 *
 * For each face:
 *  1. Liveness: as soon as a face is noticed inside the guide circle, a random challenge starts
 *     (see liveness/challenge.ts): e.g. "Smile", then "Turn your head to your right". Steps are
 *     revealed one at a time and all must be done within CHALLENGE_TIME_MS, so a photo or a
 *     pre-recorded video can't pass. Losing the face or running out of time throws the challenge
 *     away; the next attempt gets a fresh random one.
 *  2. Once every step is done and the student looks straight at the camera, a photo is taken and
 *     POSTed to /lecturer/sessions/{id}/scan, where the server identifies the student among
 *     everyone registered for the course (1:N) and records them present.
 *  3. The result shows for RESULT_MS, then the scanner resets for the next student.
 *
 * The camera stays active the whole time (deactivating it mid-capture makes the photo fail);
 * frames are simply ignored while a photo is uploading or a result is on screen.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import axios from 'axios';
import { useKeepAwake } from 'expo-keep-awake';
import { Button, Chip, Spinner } from 'heroui-native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, Text, Vibration, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { lecturerApi } from '@/api/endpoints';
import type { ScanResult } from '@/api/types';
import { FaceCamera, type CameraFacing, type FaceCameraHandle, type FacePose } from '@/components/FaceCamera';
import { Icon, SafeAreaView, type IconName } from '@/components/ui';
import {
  ACTION_PROMPT,
  ActionDetector,
  CHALLENGE_TIME_MS,
  isReadyForPhoto,
  pickChallenge,
  type LivenessAction,
  type LivenessSample,
} from '@/liveness/challenge';
import type { LecturerStackParamList } from '@/navigation/types';
import { formatElapsed } from '@/utils/attendance';

type Nav = NativeStackNavigationProp<LecturerStackParamList, 'TakeAttendance'>;

// A challenge is abandoned when the face disappears for longer than this (e.g. someone else steps in)
const FACE_LOST_MS = 1200;
const RESULT_MS = 2500;
const RECENT_NAMES = 5;

type Tone = 'success' | 'accent' | 'danger' | 'warning';
type Phase =
  | { kind: 'scanning' }
  | { kind: 'uploading' }
  | { kind: 'result'; tone: Tone; icon: IconName; title: string; lines: string[] };

/** Liveness progress for the face currently in front of the camera. `step === actions.length` = take the photo. */
type Challenge = { actions: LivenessAction[]; step: number; startedAt: number };

export function TakeAttendanceScreen() {
  useKeepAwake();
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<RouteProp<LecturerStackParamList, 'TakeAttendance'>>();
  const cameraRef = useRef<FaceCameraHandle>(null);

  // Front camera by default so the student can read the challenge prompts on screen
  const [facing, setFacing] = useState<CameraFacing>('front');
  const [phase, setPhase] = useState<Phase>({ kind: 'scanning' });
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [counts, setCounts] = useState<{ present: number; expected: number } | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [now, setNow] = useState(Date.now());
  const [ending, setEnding] = useState(false);

  // Mutable state the ~12/s face reports read and write without waiting for a render
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const facingRef = useRef(facing);
  facingRef.current = facing;
  const live = useRef<{ challenge: Challenge; detector: ActionDetector | null; lastSeen: number } | null>(null);
  const leaving = useRef(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setLive = (next: { challenge: Challenge; detector: ActionDetector | null; lastSeen: number } | null) => {
    live.current = next;
    setChallenge(next ? { ...next.challenge } : null);
  };

  // Initial counter + recently marked names (also covers resuming a class)
  useEffect(() => {
    lecturerApi
      .sessionDetail(params.sessionId)
      .then((d) => {
        setCounts({ present: d.session.present, expected: d.session.expected });
        setRecent(d.present.slice(-RECENT_NAMES).reverse().map((p) => p.full_name));
      })
      .catch(() => undefined);
  }, [params.sessionId]);

  // Class timer, and a faster tick while a challenge countdown is running
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), challenge ? 200 : 1000);
    return () => clearInterval(id);
  }, [challenge]);

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  // Leaving while the class is live: confirm, since students can't be marked until it's resumed
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (e) => {
        if (leaving.current) return;
        e.preventDefault();
        Alert.alert('Leave without ending?', 'The class stays open. You can resume it later from your course list.', [
          { text: 'Stay', style: 'cancel' },
          {
            text: 'Leave',
            style: 'destructive',
            onPress: () => {
              leaving.current = true;
              navigation.dispatch(e.data.action);
            },
          },
        ]);
      }),
    [navigation],
  );

  const showResult = useCallback((result: Phase & { kind: 'result' }) => {
    setLive(null);
    phaseRef.current = result; // stop further face reports before the next render
    setPhase(result);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setPhase({ kind: 'scanning' }), RESULT_MS);
  }, []);

  const scan = useCallback(async () => {
    if (!cameraRef.current || phaseRef.current.kind !== 'scanning') return;
    phaseRef.current = { kind: 'uploading' };
    setPhase({ kind: 'uploading' });
    setLive(null);
    let uri: string;
    try {
      uri = (await cameraRef.current.capture()).uri;
    } catch (err) {
      showResult({ kind: 'result', tone: 'warning', icon: 'camera-outline', title: 'Try again', lines: [errorMessage(err, 'Could not take photo')] });
      return;
    }
    try {
      const r: ScanResult = await lecturerApi.scan(params.sessionId, uri);
      setCounts({ present: r.present, expected: r.expected });
      if (r.status === 'marked' && r.student) {
        Vibration.vibrate(60);
        const name = r.student.full_name;
        setRecent((names) => [name, ...names.filter((n) => n !== name)].slice(0, RECENT_NAMES));
        showResult({ kind: 'result', tone: 'success', icon: 'checkmark-circle', title: 'Marked present', lines: [name, r.student.matric_no] });
      } else if (r.status === 'already_marked' && r.student) {
        showResult({ kind: 'result', tone: 'accent', icon: 'information-circle', title: 'Already marked', lines: [r.student.full_name, r.student.matric_no] });
      } else {
        showResult({
          kind: 'result',
          tone: 'danger',
          icon: 'close-circle',
          title: 'Not recognised',
          lines: ['Not a registered student of this course.', 'Check lighting and try again.'],
        });
      }
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      if (status === 422) {
        showResult({ kind: 'result', tone: 'warning', icon: 'scan-outline', title: 'No face found', lines: ['Come closer, face the camera and try again.'] });
      } else if (status === 400 && /ended/i.test(errorMessage(err))) {
        leaving.current = true;
        Alert.alert('Class ended', 'This class was ended (perhaps from the dashboard).', [
          { text: 'OK', onPress: () => navigation.popToTop() },
        ]);
      } else {
        showResult({ kind: 'result', tone: 'danger', icon: 'alert-circle', title: 'Error', lines: [errorMessage(err, 'Recognition failed')] });
      }
    }
  }, [params.sessionId, showResult, navigation]);

  // Liveness challenge, driven by FaceCamera reports (~12/s)
  const onFace = useCallback(
    (pose: FacePose | null) => {
      if (phaseRef.current.kind !== 'scanning') return;
      const t = Date.now();
      const current = live.current;

      if (!current) {
        // Start a fresh random challenge the moment a face settles inside the circle
        if (!pose?.inGuide) return;
        const canClassify = pose.eyesOpen != null && pose.smiling != null;
        const actions = pickChallenge(canClassify);
        setLive({ challenge: { actions, step: 0, startedAt: t }, detector: new ActionDetector(actions[0]), lastSeen: t });
        return;
      }

      if (t - current.challenge.startedAt > CHALLENGE_TIME_MS) {
        showResult({
          kind: 'result',
          tone: 'warning',
          icon: 'timer-outline',
          title: "Time's up",
          lines: ['The liveness check was not completed in time.', 'Look at the camera to try again.'],
        });
        return;
      }
      if (!pose) {
        if (t - current.lastSeen > FACE_LOST_MS) setLive(null);
        return;
      }
      current.lastSeen = t;

      const sample: LivenessSample = {
        yaw: pose.yaw,
        pitch: pose.pitch,
        // FaceCamera's `turn` is screen-relative; the front preview is mirrored, the back one is not
        turn: facingRef.current === 'front' ? pose.turn : ((-pose.turn) as -1 | 0 | 1),
        eyesOpen: pose.eyesOpen,
        smiling: pose.smiling,
      };
      const { actions, step } = current.challenge;
      if (step < actions.length) {
        if (current.detector?.feed(sample)) {
          const next = step + 1;
          setLive({
            challenge: { ...current.challenge, step: next },
            detector: next < actions.length ? new ActionDetector(actions[next]) : null,
            lastSeen: t,
          });
        }
      } else if (pose.inGuide && isReadyForPhoto(sample)) {
        void scan();
      }
    },
    [scan, showResult],
  );

  const endClass = () =>
    Alert.alert(`End ${params.courseCode}?`, 'Students can no longer be marked present after the class ends.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'End class',
        style: 'destructive',
        onPress: async () => {
          setEnding(true);
          try {
            const session = await lecturerApi.endSession(params.sessionId);
            leaving.current = true;
            navigation.replace('SessionSummary', { session });
          } catch (err) {
            setEnding(false);
            Alert.alert('Could not end class', errorMessage(err));
          }
        },
      },
    ]);

  const elapsed = formatElapsed(now - new Date(params.startedAt).getTime());
  const msLeft = challenge ? Math.max(0, CHALLENGE_TIME_MS - (now - challenge.startedAt)) : null;

  return (
    <View className="flex-1 bg-black">
      <FaceCamera
        ref={cameraRef}
        active
        facing={facing}
        classify
        onFace={onFace}
        hint=" "
        countdown={msLeft != null && phase.kind === 'scanning' ? msLeft / CHALLENGE_TIME_MS : null}
      />

      {/* Top bar */}
      <SafeAreaView edges={['top']} className="absolute left-0 right-0 top-0 px-4 pt-2" pointerEvents="box-none">
        <View className="flex-row items-center gap-3">
          <Pressable onPress={() => navigation.goBack()} hitSlop={12} className="size-10 items-center justify-center rounded-full bg-black/40">
            <Ionicons name="chevron-back" size={22} color="white" />
          </Pressable>
          <View className="flex-1">
            <View className="flex-row items-center gap-2">
              <View className="size-2.5 rounded-full bg-danger" />
              <Text className="text-xl font-bold text-white">{params.courseCode}</Text>
              <Text className="text-sm text-white/80" style={{ fontVariant: ['tabular-nums'] }}>{elapsed}</Text>
            </View>
            <Text className="text-xs text-white/70" numberOfLines={1}>{params.courseTitle}</Text>
          </View>
          <View className="items-center rounded-2xl bg-black/50 px-3 py-1.5">
            <Text className="text-xl font-bold text-white" style={{ fontVariant: ['tabular-nums'] }}>
              {counts ? counts.present : '–'}
              <Text className="text-sm font-semibold text-white/70">/{counts ? counts.expected : '–'}</Text>
            </Text>
            <Text className="text-[10px] uppercase tracking-wider text-white/70">present</Text>
          </View>
        </View>
        <Pressable
          onPress={() => {
            setLive(null);
            setFacing((f) => (f === 'back' ? 'front' : 'back'));
          }}
          className="mt-3 flex-row items-center gap-1.5 self-end rounded-full bg-white/20 px-3 py-1.5"
        >
          <Ionicons name="camera-reverse-outline" size={16} color="white" />
          <Text className="text-xs font-semibold text-white">{facing === 'back' ? 'Back' : 'Front'} camera</Text>
        </Pressable>
      </SafeAreaView>

      {/* Result / progress overlay */}
      {phase.kind !== 'scanning' ? (
        <View className="absolute inset-0 items-center justify-center p-8" pointerEvents="none">
          <View className="w-full max-w-xs items-center gap-1.5 rounded-3xl bg-surface px-6 py-7">
            {phase.kind === 'uploading' ? (
              <>
                <Spinner size="lg" />
                <Text className="mt-2 text-base text-muted">Recognising…</Text>
              </>
            ) : (
              <>
                <Icon name={phase.icon} size={48} color={phase.tone} />
                <Text className="mt-1 text-xl font-bold text-foreground">{phase.title}</Text>
                {phase.lines.map((l, i) => (
                  <Text key={i} className={i === 0 ? 'text-center text-lg font-semibold text-foreground' : 'text-center text-sm text-muted'}>
                    {l}
                  </Text>
                ))}
              </>
            )}
          </View>
        </View>
      ) : null}

      {/* Bottom: liveness prompt, recently marked, End class */}
      <SafeAreaView edges={['bottom']} className="absolute left-0 right-0 bottom-0 gap-3 p-4">
        {phase.kind === 'scanning' ? <ChallengeCard challenge={challenge} msLeft={msLeft} /> : null}
        {recent.length ? (
          <View className="rounded-2xl bg-black/50 px-3 py-2">
            <Text className="text-[10px] font-bold uppercase tracking-wider text-white/60">Recently marked</Text>
            <Text className="mt-0.5 text-sm text-white" numberOfLines={1}>{recent.join(' · ')}</Text>
          </View>
        ) : null}
        <Button variant="danger" size="lg" onPress={endClass} isDisabled={ending}>
          {ending ? <Spinner color="white" /> : 'End class'}
        </Button>
      </SafeAreaView>
    </View>
  );
}

/** What the student should do right now. Only the current step is ever shown. */
function ChallengeCard({ challenge, msLeft }: { challenge: Challenge | null; msLeft: number | null }) {
  if (!challenge) {
    return (
      <View className="flex-row items-center gap-3 rounded-3xl bg-surface p-4">
        <View className="size-12 items-center justify-center rounded-full bg-accent/10">
          <Icon name="scan-outline" size={24} color="accent" />
        </View>
        <View className="flex-1">
          <Text className="text-base font-semibold text-foreground">Next student</Text>
          <Text className="text-sm text-muted">Stand in front of the camera with your face inside the circle.</Text>
        </View>
      </View>
    );
  }
  const { actions, step } = challenge;
  const done = step >= actions.length;
  const prompt = done
    ? { title: 'Look straight at the camera', hint: 'Hold still — taking your photo', icon: 'camera-outline' }
    : ACTION_PROMPT[actions[step]];
  const seconds = Math.ceil((msLeft ?? 0) / 1000);
  return (
    <View className="rounded-3xl bg-surface p-4">
      <View className="mb-3 flex-row items-center justify-between">
        <Chip size="sm" variant="soft" color="accent">
          {done ? 'Final check' : `Step ${step + 1} of ${actions.length}`}
        </Chip>
        <Chip size="sm" variant="soft" color={seconds <= 5 ? 'danger' : 'default'}>
          {`${seconds}s left`}
        </Chip>
      </View>
      <View className="flex-row items-center gap-3">
        <View className="size-14 items-center justify-center rounded-full bg-accent">
          <Icon name={prompt.icon as IconName} size={28} color="accent-foreground" />
        </View>
        <View className="flex-1">
          <Text className="text-xl font-bold text-foreground">{prompt.title}</Text>
          <Text className="text-sm text-muted">{prompt.hint}</Text>
        </View>
      </View>
      <View className="mt-4 flex-row gap-1.5">
        {actions.map((a, i) => (
          <View key={a} className={`h-1.5 flex-1 rounded-full ${i < step ? 'bg-success' : i === step ? 'bg-accent' : 'bg-default'}`} />
        ))}
      </View>
    </View>
  );
}
