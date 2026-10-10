# Mobile app — UI Attendance (Expo + React Native + TypeScript)

One app, two roles (switch on the login screen):

* **Students** (the main audience) register, enrol their face, join courses and follow their
  attendance: exam eligibility per course (>= 75% in *that* course — there is no overall average),
  per-course history, "class in session" banners, lecturers' contacts.
  Students never mark themselves; they show their face to the lecturer's phone.
* **Lecturers** sign in with the email/password they registered on the web dashboard and can
  **only take attendance**: pick a course → Start class → students look at the phone and follow the
  random liveness prompts →
  End class. Course management, logs and statistics are all on the dashboard.

## Why a development build (not Expo Go)

`expo-face-detector` was removed from the Expo SDK. This app uses
`react-native-vision-camera` + `react-native-vision-camera-face-detector` (Google ML Kit) for
on-device face detection. Those are native modules, so the app runs as an **Expo development build**
on a phone — the workflow is still Expo managed (prebuild handles the native project).

The UI is built with [HeroUI Native](https://heroui.com/docs/native) (Expo SDK 54, React 19,
Reanimated 4, Uniwind / Tailwind v4). Theme overrides (University navy accent) live in `global.css`;
screens style with `className`.

## 1. Setup

```bash
cd mobile
bun install
npx expo install --fix        # aligns every expo-* / RN package with the installed SDK
```

iOS builds need a deployment target of 15.5 or newer (the ML Kit face-detector pod requires it).
This is already set via `expo-build-properties` in `app.json`; `npx expo prebuild` picks it up.

Edit `src/config.ts`:

```ts
export const API_BASE_URL = 'http://192.168.1.20:8000';   // your PC's LAN IP running the backend
export const DASHBOARD_URL = 'http://192.168.1.20:3000';  // shown to lecturers in the app
```

Find your LAN IP with `ipconfig` (Windows) or `ip addr` / `ifconfig` (Linux/macOS). Phone and PC must be on the same Wi-Fi.

## 2. Build & run on Android

Requires Android Studio (SDK + an emulator or a USB-debugging phone) and JDK 17.

```bash
npx expo run:android          # first build takes several minutes
```

After the first build, `npx expo start --dev-client` reloads JS instantly.

Alternatively build in the cloud with EAS: `npx eas build --profile development --platform android`.

## 3. Build & run on iOS (physical iPhone only)

Google ML Kit ships x86_64-only Simulator binaries and Xcode 26 no longer offers Rosetta
simulators, so on an Apple Silicon Mac the app **cannot run in the iOS Simulator** (xcodebuild
reports "Unable to find a destination" and lists no simulators). Use a real iPhone, which you
need anyway for the camera:

```bash
bunx expo run:ios --device      # pick your iPhone from the list; first build takes several minutes
```

Requirements: Xcode with the iOS platform installed, the iPhone plugged in, unlocked and trusted,
Developer Mode enabled on the phone (Settings → Privacy & Security → Developer Mode), and an
Apple ID signed into Xcode. `ios.appleTeamId` in `app.json` pins the signing team so
`expo prebuild --clean` keeps working without prompts; change it to your own team ID.

## Face enrolment (Face-ID style)

Registration is two steps: account details, then face enrolment. A student without an enrolled
face only sees the enrolment flow (and Log out) until it succeeds. The server refuses to join
courses without a face, and refuses a face that is already enrolled on another account.

`EnrolFaceScreen` asks the student to look straight at the camera, then turn left, right, up and
down. `FaceCamera` reports ML Kit head angles ~5×/s; when a pose is held inside the guide circle
for two consecutive reports a photo is taken automatically, the matching ring segment fills, and
after all five the photos are uploaded in one request. The server rejects the set if the photos
don't look like the same person.

Tuning knobs live at the top of `src/screens/EnrolFaceScreen.tsx` (`CENTER_MAX`, `TURN_MIN`,
`TILT_MIN`, `HOLD_REPORTS`). In a dev build the Metro log prints `[FaceCamera] yaw=… pitch=…`
every 2 s, which helps if a pose never registers on a particular phone.

## Taking attendance (lecturer mode)

`TakeAttendanceScreen` is a kiosk: the lecturer props the phone up (front camera by default so
students can read the prompts; toggle to back) and students come up one at a time. For each face:

1. **Liveness** (`src/liveness/challenge.ts`) — as soon as a face settles in the circle, two
   actions are picked at random from blink / smile / turn left / turn right / nod and shown **one
   at a time**, with a 20 s countdown for the whole challenge. Each detector needs a change
   (neutral → smile, open → closed → open, frontal → turned, down → back up), so a photo can't
   pass, and a replayed video can't know which prompts will come up. Losing the face for over
   1.2 s or running out of time discards the challenge; the next attempt gets a new one. When all
   steps are done, the photo is taken once the student looks straight at the camera. Phones that
   report no eye/smile probabilities get only head-movement actions. Face enrolment has no challenge.
2. **Capture + identify** — the photo goes to `POST /lecturer/sessions/{id}/scan`; the server
   matches it against every student registered for the course (1:N) and marks them present.
3. **Result** — green "Marked present" (with vibration), grey "Already marked", red "Not
   recognised", amber "No face found" — shown 2.5 s, then the scanner resets.

The top bar shows the elapsed time and the present/expected counter; the bottom shows the last
five names marked. The screen stays awake (`expo-keep-awake`). Leaving without ending asks for
confirmation. The class stays open and shows "Resume" on the course list. A lecturer can run
one class at a time; classes left open are auto-ended by the server after a few hours.

Tuning knobs: thresholds, `CHALLENGE_TIME_MS` and `CHALLENGE_STEPS` in `src/liveness/challenge.ts`;
`FACE_LOST_MS` and `RESULT_MS` in `src/screens/lecturer/TakeAttendanceScreen.tsx`.

## 4. Demo flow

Seed the backend (`python -m app.seed --reset`), then:

1. **Student** → "Create account" → fill in details → register face (5 poses) → Browse courses →
   Join (the lecturer sees a notification on the dashboard).
   Or log in as a seeded student `CSC/2021/001` / `password123` (they must enrol a face first).
2. **Lecturer** (on a second phone, or log out) → Lecturer tab → `ao.bello@ui.edu.ng` /
   `password123` → Start class on a course → the student follows the two prompts → green tick.
3. Student's Home shows "CSC401 is in session" and flips to "✓ You're marked present" within 10 s.
4. Lecturer → End class → summary. The full log and statistics are on the dashboard.
5. Student: Home / Courses → eligibility per course ("You can miss 2 more classes" / "Attend the next
   3 classes to qualify") → tap for detail, circular chart and history.

## Project layout

```
App.tsx                         providers (gesture root, HeroUI, auth) + navigator
global.css                      Tailwind v4 + HeroUI Native styles + theme overrides
src/config.ts                   server + dashboard URLs, thresholds
src/theme.ts                    raw colours for SVG overlays and native headers only
src/components/ui.tsx           shared HeroUI-based pieces (Screen, FormField, chips, states)
src/liveness/challenge.ts       random liveness challenge + action detectors
src/api/client.ts               axios + JWT interceptor + error helpers
src/api/endpoints.ts            typed API calls: studentApi, lecturerApi
src/api/types.ts                response types (mirror backend schemas)
src/db/database.ts              expo-sqlite JSON cache (student screens work offline, read-only)
src/context/AuthContext.tsx     role-aware session (student | lecturer), secure token storage
src/navigation/AppNavigator.tsx signed-out | face setup | student tabs | lecturer mode
src/components/FaceCamera.tsx   vision-camera + ML Kit (angles, eye-open, smile) + capture/compress
src/components/FaceGuideOverlay.tsx  circular guide, green when a face is present
src/components/CircularProgress.tsx  SVG attendance gauge
src/screens/*.tsx               student screens (Login, Register, FaceIntro, EnrolFace, Home,
                                Courses, Catalog, CourseDetail, Lecturers, Profile)
src/screens/lecturer/*.tsx      LecturerHome, TakeAttendance, SessionSummary
```

## Troubleshooting

* **"Cannot reach the server"** — wrong `API_BASE_URL`, backend not started with `--host 0.0.0.0`, or a firewall blocking port 8000.
* **Camera black / no face detected** — grant the camera permission; ML Kit needs reasonable light.
* **Capture fails** — never deactivate the camera (`active={false}`) before `capture()` has resolved; the scanner keeps the camera active and just ignores frames while uploading.
* **A liveness step never registers** — needs decent light on the face. Blink/smile need ML Kit classification; phones that never report it only get head-movement prompts. "Turn left/right" means the *student's* left/right.
* **"Not recognised" for a registered student** — have them re-enrol from Profile ("Re-enrol your face") in similar light to the classroom.
* **Enrolment stuck on one pose** — watch the `[FaceCamera]` lines in Metro: if `inGuide` stays false, move closer/centre the face; if the yaw/pitch never reaches the thresholds, lower `TURN_MIN`/`TILT_MIN`.
* **`Camera: ref is not a prop` / `Requiring unknown module "undefined"` at runtime** — you are rendering the `Camera` wrapper from `react-native-vision-camera-face-detector` (v1.8+ needs React 19 and Skia). `src/components/FaceCamera.tsx` deliberately uses VisionCamera's `Camera` plus the `useFaceDetector` hook instead; keep it that way.
* **Build errors mentioning worklets** — make sure `react-native-worklets-core/plugin` is in `babel.config.js` and run `npx expo start -c` to clear the cache.
* **Version mismatch warnings** — run `npx expo install --fix`.
