/**
 * Randomised active-liveness challenge for the attendance scanner.
 *
 * A single "blink" check can be beaten by replaying a video of someone blinking. Instead, once a
 * face is noticed the student gets CHALLENGE_STEPS actions picked at random (e.g. "smile", then
 * "turn your head to your right") and only sees the next one after finishing the current one, so
 * a recording can't anticipate them. Everything must be done within CHALLENGE_TIME_MS.
 *
 * Each detector looks for a *change* (neutral -> smile, open -> closed -> open, frontal -> turned),
 * never a static state, so a photo or a frozen frame that happens to match can't pass.
 *
 * Only used when taking attendance; face enrolment does not run a challenge.
 */

export type LivenessAction = 'blink' | 'smile' | 'turnLeft' | 'turnRight' | 'nod';

/** Total time to complete every step, counted from the moment the face is noticed. */
export const CHALLENGE_TIME_MS = 20000;
export const CHALLENGE_STEPS = 2;

/** Actions that need ML Kit's eye/smile classification (some phones never report it). */
const NEEDS_CLASSIFICATION: LivenessAction[] = ['blink', 'smile'];
const ALL_ACTIONS: LivenessAction[] = ['blink', 'smile', 'turnLeft', 'turnRight', 'nod'];

export const ACTION_PROMPT: Record<LivenessAction, { title: string; hint: string; icon: string }> = {
  blink: { title: 'Blink your eyes', hint: 'Close both eyes briefly, then open them', icon: 'eye-outline' },
  smile: { title: 'Smile', hint: 'Give a big smile', icon: 'happy-outline' },
  turnLeft: { title: 'Turn your head to your left', hint: 'Slowly, then look back', icon: 'arrow-back' },
  turnRight: { title: 'Turn your head to your right', hint: 'Slowly, then look back', icon: 'arrow-forward' },
  nod: { title: 'Nod your head', hint: 'Move your chin down, then back up', icon: 'swap-vertical' },
};

/** One face report, in the student's own frame of reference. */
export interface LivenessSample {
  yaw: number;
  pitch: number;
  /** -1 = turned to the student's left, 1 = their right, 0 = facing the camera. */
  turn: -1 | 0 | 1;
  eyesOpen: number | null;
  smiling: number | null;
}

/** Random, non-repeating actions. Left and right turns are never paired (too similar). */
export function pickChallenge(canClassify: boolean, steps = CHALLENGE_STEPS, random: () => number = Math.random): LivenessAction[] {
  const pool = ALL_ACTIONS.filter((a) => canClassify || !NEEDS_CLASSIFICATION.includes(a));
  const picked: LivenessAction[] = [];
  while (picked.length < steps && pool.length) {
    const action = pool.splice(Math.floor(random() * pool.length), 1)[0];
    picked.push(action);
    if (action === 'turnLeft' || action === 'turnRight') {
      const other = pool.indexOf(action === 'turnLeft' ? 'turnRight' : 'turnLeft');
      if (other >= 0 && pool.length > steps - picked.length) pool.splice(other, 1);
    }
  }
  return picked;
}

// Thresholds (probabilities 0..1, angles in degrees)
const EYES_OPEN = 0.7;
const EYES_CLOSED = 0.3;
const SMILE_NEUTRAL = 0.35;
const SMILE_ON = 0.75;
const FRONTAL_YAW = 12;
const TURN_YAW = 22;
const NOD_DELTA = 12;
const NOD_RETURN = 6;

/**
 * Watches the face stream for one action. `feed` returns true once the action has been performed.
 * Every detector first waits for a neutral starting state, so the previous step can't complete it.
 */
export class ActionDetector {
  private stage = 0;
  private baselinePitch = 0;

  constructor(readonly action: LivenessAction) {}

  feed(s: LivenessSample): boolean {
    switch (this.action) {
      case 'blink':
        if (s.eyesOpen == null) return false;
        if (this.stage === 0 && s.eyesOpen > EYES_OPEN) this.stage = 1;
        else if (this.stage === 1 && s.eyesOpen < EYES_CLOSED) this.stage = 2;
        else if (this.stage === 2 && s.eyesOpen > EYES_OPEN) return true;
        return false;

      case 'smile':
        if (s.smiling == null) return false;
        if (this.stage === 0 && s.smiling < SMILE_NEUTRAL) this.stage = 1;
        else if (this.stage === 1 && s.smiling > SMILE_ON) return true;
        return false;

      case 'turnLeft':
      case 'turnRight': {
        const want = this.action === 'turnLeft' ? -1 : 1;
        if (this.stage === 0 && Math.abs(s.yaw) < FRONTAL_YAW) this.stage = 1;
        else if (this.stage === 1 && s.turn === want && Math.abs(s.yaw) >= TURN_YAW) return true;
        return false;
      }

      case 'nod':
        if (this.stage === 0 && Math.abs(s.yaw) < FRONTAL_YAW) {
          this.baselinePitch = s.pitch;
          this.stage = 1;
        } else if (this.stage === 1 && Math.abs(s.pitch - this.baselinePitch) >= NOD_DELTA) {
          this.stage = 2;
        } else if (this.stage === 2 && Math.abs(s.pitch - this.baselinePitch) <= NOD_RETURN) {
          return true;
        }
        return false;
    }
  }
}

/** True when the face is square-on with eyes open: the moment to take the attendance photo. */
export function isReadyForPhoto(s: LivenessSample): boolean {
  return Math.abs(s.yaw) < FRONTAL_YAW && Math.abs(s.pitch) < FRONTAL_YAW && (s.eyesOpen == null || s.eyesOpen > 0.6);
}
