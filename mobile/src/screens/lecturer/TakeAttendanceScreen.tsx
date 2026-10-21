/**
 * Lecturer's attendance scanner: a continuous kiosk that students walk up to one at a time.
 *
 * For each face:
 *  1. Liveness: as soon as a face is noticed inside the guide circle, a random challenge starts
 *     (see liveness/challenge.ts): e.g. "Smile", then "Turn your head to your right". Steps are
 *     revealed one at a time and all must be done within CHALLENGE_TIME_MS, so a photo or a
 *     pre-recorded video can't pass. Losing the face or running out of time throws the challenge
 *     away; the next attempt gets a fresh random one.
 *  2. Once every step is done and the student looks straight at the camera, a photo is taken,
 *     embedded on the phone (src/face/embed.ts) and matched 1:N against the course's enrolled
 *     faces stored on the phone. A match is recorded locally and queued for sync. No network is
 *     needed at any point.
 *  3. The result shows for RESULT_MS, then the scanner resets for the next student.
 *
 * When the camera can't recognise someone, "Mark by matric no." records them manually (labelled
 * as such on the dashboard).
 *
 * The camera stays active the whole time (deactivating it mid-capture makes the photo fail);
 * frames are simply ignored while a photo is being recognised or a result is on screen.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useKeepAwake } from 'expo-keep-awake';
import { BottomSheet, Button, Chip, SearchField, Spinner, useBottomSheetAwareHandlers } from 'heroui-native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, Text, Vibration, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { FaceCamera, type CameraFacing, type FaceCameraHandle, type FacePose } from '@/components/FaceCamera';
import { SyncBadge } from '@/components/SyncBadge';
import { Icon, SafeAreaView, type IconName } from '@/components/ui';
import {
  endSession,
  faceIndex,
  getSession,
  markPresent,
  presentStudents,
  roster,
  sessionCounts,
  student as getStudent,
  type LocalSession,
  type RosterStudent,
} from '@/db/lecturerStore';
import { NoFaceError, embedPhoto } from '@/face/embed';
import type { FaceIndex } from '@/face/matcher';
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
import { matchingSettings, syncManager, type Matching } from '@/sync/syncManager';
import { useSyncStatus } from '@/sync/useSyncStatus';
import { formatElapsed } from '@/utils/attendance';
import { discardFiles } from '@/utils/files';

type Nav = NativeStackNavigationProp<LecturerStackParamList, 'TakeAttendance'>;

// A challenge is abandoned when the face disappears for longer than this (e.g. someone else steps in)
const FACE_LOST_MS = 1200;
const RESULT_MS = 2500;
const RECENT_NAMES = 5;

type Tone = 'success' | 'accent' | 'danger' | 'warning';
type Phase =
  | { kind: 'scanning' }
  | { kind: 'recognising' }
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
  const [session, setSession] = useState<LocalSession | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const sync = useSyncStatus();
  const index = useRef<FaceIndex | null>(null);
  const matching = useRef<Matching | null>(null);

  // Mutable state the ~12/s face reports read and write without waiting for a render
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const facingRef = useRef(facing);
  facingRef.current = facing;
  const live = useRef<{ challenge: Challenge; detector: ActionDetector | null; lastSeen: number } | null>(null);
  const leaving = useRef(false);
  const manualOpenRef = useRef(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setLive = (next: { challenge: Challenge; detector: ActionDetector | null; lastSeen: number } | null) => {
    live.current = next;
    setChallenge(next ? { ...next.challenge } : null);
  };

  const refreshCounts = useCallback(async () => {
    const [c, present] = await Promise.all([sessionCounts(params.sessionUuid), presentStudents(params.sessionUuid)]);
    setCounts(c);
    setRecent(present.slice(0, RECENT_NAMES).map((p) => p.full_name));
  }, [params.sessionUuid]);

  const closeBecauseEnded = useCallback(() => {
    leaving.current = true;
    Alert.alert('Class ended', 'This class was ended or deleted on the dashboard.', [
      { text: 'OK', onPress: () => navigation.popToTop() },
    ]);
  }, [navigation]);

  // The class, its counters and recently marked names (also covers resuming a class)
  useEffect(() => {
    void (async () => {
      const s = await getSession(params.sessionUuid);
      if (!s || s.ended_at) {
        closeBecauseEnded();
        return;
      }
      setSession(s);
      await refreshCounts();
    })();
  }, [params.sessionUuid, refreshCounts, closeBecauseEnded]);

  // Faces to match against; rebuilt after each sync in case students joined or re-enrolled
  useEffect(() => {
    if (!session || sync.state === 'syncing') return;
    void faceIndex(session.course_id).then((i) => (index.current = i));
    void matchingSettings().then((m) => (matching.current = m));
    void refreshCounts();
  }, [session, sync.lastSyncAt, sync.state, refreshCounts]);

  useEffect(
    () =>
      syncManager.onEndedElsewhere((uuids) => {
        if (uuids.includes(params.sessionUuid)) closeBecauseEnded();
      }),
    [params.sessionUuid, closeBecauseEnded],
  );

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

  const recordMark = useCallback(
    async (studentId: number, method: 'face' | 'manual', confidence: number | null) => {
      const who = await getStudent(studentId);
      const outcome = await markPresent(params.sessionUuid, studentId, method, confidence);
      syncManager.poke();
      await refreshCounts();
      return { who, outcome };
    },
    [params.sessionUuid, refreshCounts],
  );

  const scan = useCallback(async () => {
    if (!cameraRef.current || phaseRef.current.kind !== 'scanning') return;
    phaseRef.current = { kind: 'recognising' };
    setPhase({ kind: 'recognising' });
    setLive(null);
    try {
      const photo = await cameraRef.current.capture();
      let vector: Float32Array;
      try {
        vector = (await embedPhoto(photo)).vector;
      } finally {
        discardFiles(photo.uri); // the student's photo never stays on the lecturer's phone
      }
      const faces = index.current;
      const m = matching.current;
      if (!faces || !m || faces.size === 0) {
        showResult({
          kind: 'result',
          tone: 'warning',
          icon: 'people-outline',
          title: 'No faces to match',
          lines: ['No student in this course has a face this phone can recognise.', 'Use "Mark by matric no." instead.'],
        });
        return;
      }
      const match = faces.identify(vector, m.threshold, m.margin);
      if (match.studentId === null) {
        showResult({
          kind: 'result',
          tone: 'danger',
          icon: 'close-circle',
          title: 'Not recognised',
          lines: ['Not a registered student of this course.', 'Check lighting and try again.'],
        });
        return;
      }
      const { who, outcome } = await recordMark(match.studentId, 'face', match.confidence);
      const lines = who ? [who.full_name, who.matric_no] : [`Student #${match.studentId}`];
      if (outcome === 'marked') {
        Vibration.vibrate(60);
        showResult({ kind: 'result', tone: 'success', icon: 'checkmark-circle', title: 'Marked present', lines });
      } else {
        showResult({ kind: 'result', tone: 'accent', icon: 'information-circle', title: 'Already marked', lines });
      }
    } catch (err) {
      if (err instanceof NoFaceError) {
        showResult({ kind: 'result', tone: 'warning', icon: 'scan-outline', title: 'No face found', lines: [err.message] });
      } else {
        showResult({ kind: 'result', tone: 'danger', icon: 'alert-circle', title: 'Try again', lines: [errorMessage(err, 'Recognition failed')] });
      }
    }
  }, [showResult, recordMark]);

  const markManually = useCallback(
    async (s: RosterStudent) => {
      setManualOpen(false);
      const { outcome } = await recordMark(s.id, 'manual', null);
      showResult({
        kind: 'result',
        tone: outcome === 'marked' ? 'success' : 'accent',
        icon: outcome === 'marked' ? 'checkmark-circle' : 'information-circle',
        title: outcome === 'marked' ? 'Marked present (manual)' : 'Already marked',
        lines: [s.full_name, s.matric_no],
      });
    },
    [recordMark, showResult],
  );

  // Liveness challenge, driven by FaceCamera reports (~12/s)
  const onFace = useCallback(
    (pose: FacePose | null) => {
      if (phaseRef.current.kind !== 'scanning' || manualOpenRef.current) return;
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

  manualOpenRef.current = manualOpen;

  const endClass = () =>
    Alert.alert(`End ${session?.course_code ?? 'class'}?`, 'Students can no longer be marked present after the class ends.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'End class',
        style: 'destructive',
        onPress: async () => {
          setEnding(true);
          try {
            await endSession(params.sessionUuid);
            syncManager.poke();
            leaving.current = true;
            navigation.replace('SessionSummary', { sessionUuid: params.sessionUuid });
          } catch (err) {
            setEnding(false);
            Alert.alert('Could not end class', errorMessage(err));
          }
        },
      },
    ]);

  const elapsed = session ? formatElapsed(now - new Date(session.started_at).getTime()) : '';
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
              <Text className="text-xl font-bold text-white">{session?.course_code ?? ''}</Text>
              <Text className="text-sm text-white/80" style={{ fontVariant: ['tabular-nums'] }}>{elapsed}</Text>
            </View>
            <Text className="text-xs text-white/70" numberOfLines={1}>{session?.course_title ?? ''}</Text>
          </View>
          <View className="items-center rounded-2xl bg-black/50 px-3 py-1.5">
            <Text className="text-xl font-bold text-white" style={{ fontVariant: ['tabular-nums'] }}>
              {counts ? counts.present : '–'}
              <Text className="text-sm font-semibold text-white/70">/{counts ? counts.expected : '–'}</Text>
            </Text>
            <Text className="text-[10px] uppercase tracking-wider text-white/70">present</Text>
          </View>
        </View>
        <View className="mt-3 flex-row items-center justify-between">
        <SyncBadge dark />
        <Pressable
          onPress={() => {
            setLive(null);
            setFacing((f) => (f === 'back' ? 'front' : 'back'));
          }}
          className="flex-row items-center gap-1.5 rounded-full bg-white/20 px-3 py-1.5"
        >
          <Ionicons name="camera-reverse-outline" size={16} color="white" />
          <Text className="text-xs font-semibold text-white">{facing === 'back' ? 'Back' : 'Front'} camera</Text>
        </Pressable>
        </View>
      </SafeAreaView>

      {/* Result / progress overlay */}
      {phase.kind !== 'scanning' ? (
        <View className="absolute inset-0 items-center justify-center p-8" pointerEvents="none">
          <View className="w-full max-w-xs items-center gap-1.5 rounded-3xl bg-surface px-6 py-7">
            {phase.kind === 'recognising' ? (
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
        <View className="flex-row gap-3">
          <Button variant="secondary" size="lg" className="flex-1" onPress={() => setManualOpen(true)}>
            <Icon name="keypad-outline" size={18} color="accent" />
            <Button.Label>Mark by matric no.</Button.Label>
          </Button>
          <Button variant="danger" size="lg" className="flex-1" onPress={endClass} isDisabled={ending}>
            {ending ? <Spinner color="white" /> : 'End class'}
          </Button>
        </View>
      </SafeAreaView>

      <ManualMarkSheet
        isOpen={manualOpen}
        onOpenChange={setManualOpen}
        sessionUuid={params.sessionUuid}
        onPick={(s) => void markManually(s)}
      />
    </View>
  );
}

/** Fallback when the camera can't recognise a student: find them in the local class list. */
function ManualMarkSheet({
  isOpen,
  onOpenChange,
  sessionUuid,
  onPick,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  sessionUuid: string;
  onPick: (s: RosterStudent) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RosterStudent[]>([]);

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      return;
    }
    let cancelled = false;
    void roster(sessionUuid, query).then((r) => !cancelled && setResults(r));
    return () => {
      cancelled = true;
    };
  }, [isOpen, query, sessionUuid]);

  return (
    <BottomSheet isOpen={isOpen} onOpenChange={onOpenChange}>
      <BottomSheet.Portal>
        <BottomSheet.Overlay />
        <BottomSheet.Content
          snapPoints={['75%']}
          enableDynamicSizing={false}
          enableOverDrag={false}
          keyboardBehavior="extend"
          contentContainerClassName="h-full"
        >
          <BottomSheet.Title>Mark by matric number</BottomSheet.Title>
          <BottomSheet.Description className="mb-3">
            For students the camera can't recognise. Shown as a manual mark on the dashboard.
          </BottomSheet.Description>
          <RosterSearch value={query} onChange={setQuery} />
          <BottomSheetScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-2 pb-10 pt-3">
            {results.map((s) => (
              <Pressable
                key={s.id}
                disabled={s.marked}
                onPress={() => onPick(s)}
                className={`flex-row items-center gap-3 rounded-2xl bg-default/60 p-3 ${s.marked ? 'opacity-50' : ''}`}
              >
                <View className="flex-1">
                  <Text className="text-base font-semibold text-foreground">{s.full_name}</Text>
                  <Text className="text-sm text-muted">{s.matric_no}{s.hasFace ? '' : ' · no face enrolled'}</Text>
                </View>
                {s.marked ? (
                  <Chip size="sm" variant="soft" color="success">Present</Chip>
                ) : (
                  <Icon name="add-circle-outline" size={24} color="accent" />
                )}
              </Pressable>
            ))}
            {results.length === 0 ? (
              <Text className="py-6 text-center text-sm text-muted">No student in this course matches.</Text>
            ) : null}
          </BottomSheetScrollView>
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  );
}

function RosterSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { onFocus, onBlur } = useBottomSheetAwareHandlers();
  return (
    <SearchField value={value} onChange={onChange}>
      <SearchField.Group>
        <SearchField.SearchIcon />
        <SearchField.Input placeholder="Matric number or name" autoCapitalize="characters" onFocus={onFocus} onBlur={onBlur} />
        <SearchField.ClearButton />
      </SearchField.Group>
    </SearchField>
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
