# Offline-first attendance ("POS mode"): implementation plan

**Goal.** The lecturer's phone takes attendance the way a till takes payments. It always works
from local data and never waits on the network, and it syncs with the server whenever there is a
connection. The backend and dashboard stay the hub for sync and admin.

**Status (2026-10-15):** built on branch `offline-first`. Backend (migrations, device auth,
sync, on-device enrolment), mobile (TFLite pipeline, encrypted store, sync engine, screens) and
dashboard notes are done and tested. Two deviations from the text below: deletions are recorded in
a `tombstones` table rather than as `deleted_at` columns (so no existing query had to change), and
recognition embeds the captured photo (ML Kit on the still image) rather than the live frame.
**Still to do:** Phase 0 accuracy evaluation on the S23 with real students (`tools/eval_faces.py`),
then setting `FACE_DISTANCE_THRESHOLD`; turning `FACE_LEGACY` off once everyone has re-enrolled.

**Decisions (2026-10-15):**
- **Target device:** one dedicated lecturer phone, a Samsung Galaxy S23 (Snapdragon 8 Gen 2, 8 GB
  RAM). Students use their own phones, for signup and face enrolment only.
- **One active device per lecturer.** No multi-device coordination needed (§3.3).
- **Manual "mark by matric number" in the app** as an offline fallback when the camera fails (§7).
- **Offline limit:** soft warning at 7 days unsynced, strong warning at 14 days, and new classes
  blocked after 30 days. All three values are server settings, so they can go up to a full
  semester if needed (§6).

---

## 1. Target architecture

```
 Student phone                   Backend (FastAPI)                 Lecturer phone (Android)
 ─────────────                   ─────────────────                 ────────────────────────
 signup (online)  ───────────▶   accounts, courses, enrolments
 face enrolment:                 stores embeddings + photos        SQLite (encrypted)
   on-device model ──embeddings─▶ dup check (numpy only)            ├─ courses / roster / embeddings  ◀── PULL (deltas)
                                                                    ├─ sessions / marks
                                 /lecturer/sync/pull  ◀──────────── ├─ outbox (queued ops)          ──▶ PUSH (idempotent)
                                 /lecturer/sync/push  ◀────────────┘
 Dashboard (Next.js) ─────────▶  same DB: reports, edits, CSV
```

Principles:

1. **One code path.** Scans are always matched on the device and written to SQLite, online or
   offline. There is no separate "offline mode" that could break on its own.
2. **Every write is a queued operation.** The local row and its outbox entry are saved in one
   transaction.
3. **IDs come from the device.** Sessions and marks get UUIDs on the phone. The server
   de-duplicates by those IDs, so re-sending after a timeout is always safe.
4. **The same model makes every embedding.** Enrolment (student phone) and recognition (lecturer
   phone) share one TFLite model and one preprocessing step, tagged with `MODEL_VERSION`. The
   server stops running DeepFace and only compares vectors.

---

## 2. Phase 0: on-device model test (go / no-go)

Do this before anything else. Everything below depends on it.

| Task | Detail |
|---|---|
| Convert the model | Export DeepFace's Facenet512 Keras weights to TFLite (fp16, ~46 MB). The S23 handles this easily with the GPU delegate, so MobileFaceNet is no longer needed. Only reconsider it if cheaper devices are added later. |
| Preprocessing | Crop from the ML Kit face box with a margin, level the eyes using the eye landmarks (or require \|roll\| < 10° and skip this), resize to 160×160 RGB, scale pixels the same way DeepFace does for Facenet512. Write it once in `mobile/src/face/preprocess.ts` and mirror it in `backend/tools/embed_tflite.py` for evaluation. |
| Runtime | `react-native-fast-tflite` (works inside VisionCamera frame processors; Android GPU delegate with CPU fallback) plus `vision-camera-resize-plugin` for crop and resize inside the frame processor. |
| Accuracy | Collect ~20 volunteers × 5 enrolment poses + 5 "attendance" shots each, in lecture-hall lighting. Measure the genuine and impostor distance distributions, then pick `threshold` and `margin` (today 0.30 / 0.05) so that **false accepts ≈ 0** and false rejects stay < 5%. |
| Speed | On the S23: < 100 ms per embedding (expected ~20–40 ms on the GPU), and the frame rate during liveness checks must not drop noticeably. |
| Output | `docs/model-eval.md` with the numbers, the chosen model, the thresholds and `MODEL_VERSION = "fn512-tflite-v1"`. |

**Exit criteria:** accuracy as good as the current server or better, and the speed budget met on
the S23.

---

## 3. Phase 1: backend

### 3.1 Migrations
There is no Alembic yet (`create_all` only). **Add Alembic now.** The changes below alter
existing tables, and the seeded or demo database has to survive the upgrade.

### 3.2 Schema changes (`backend/app/models.py`)

| Table | Change |
|---|---|
| `students` | `embedding_model: str \| None`: the model that made `face_embedding`. `face_updated_at`: bumped on every (re-)enrolment and used for pull deltas. Store the photos of all poses, not just the frontal one, so faces can be re-embedded later if the model changes. |
| `enrollments` | `updated_at`, plus `removed_at` (a deletion marker instead of a hard delete), so a phone learns when a student leaves a course. |
| `courses` | `updated_at`, used for pull deltas (archiving, renames). |
| `class_sessions` | `uuid` (unique, from the device), `device_id`, `started_at_device`, `ended_at_device`, `synced_at`, `updated_at`, `deleted_at`. |
| `attendance` | `uuid` (unique), `device_id`, `marked_at_device`, `synced_at`, `updated_at`, `deleted_at` (an unmark becomes a deletion marker, not a row delete). Keep the `(student_id, session_id)` unique constraint. |
| **new** `devices` | `id (uuid)`, `lecturer_id`, `label`, `app_version`, `last_seen_at`, `revoked_at`. |
| **new** `sync_ops` | `op_id` (PK, from the device), `device_id`, `type`, `received_at`, `result`. This is the record that makes re-sent operations harmless. |
| **new** `refresh_tokens` | `id`, `device_id`, `token_hash`, `expires_at`, `revoked_at`. |

Every `updated_at` is set by the server on write. Pull deltas use it, never the device's clock.

### 3.3 Auth for devices that stay offline
Access tokens currently last 12 h (`jwt_expire_minutes = 720`), and the app **logs out on any
401**, which would wipe the offline queue. Changes:

- `POST /auth/lecturer/login` also takes `device_id` and returns a **refresh token** (90 days,
  rotated on each use, revocable from the dashboard).
- `POST /auth/refresh` returns a new access token and a rotated refresh token.
- Offline, the app keeps working with the cached session. It doesn't need a valid token to
  take attendance. Tokens only matter for syncing.
- A 401 during sync triggers a refresh. If the refresh fails, show "Sign in again to sync" but
  **keep the local data and the queue**.
- **One active device per lecturer.** Logging in on a new phone makes it the active device and
  sets `revoked_at` on the previous one. A revoked device can still **push** its queued ops for
  7 days, so no attendance is lost, but it can't pull or start new classes, and it shows
  "This account is now used on another phone". After its queue is empty it wipes itself.

### 3.4 Sync endpoints (new `backend/app/routers/sync.py`)

**`GET /lecturer/sync/pull?since=<cursor>`**
Returns everything the device needs that changed since the cursor, for the lecturer's courses:
```json
{
  "server_time": "2026-10-15T09:00:00Z",
  "cursor": "2026-10-15T09:00:00.123456Z",
  "courses":     [{ "id", "code", "title", "is_active", "updated_at" }],
  "students":    [{ "id", "matric_no", "full_name", "embedding_model", "embeddings": "<base64 float32[]>", "face_updated_at" }],
  "enrollments": [{ "course_id", "student_id", "joined_at", "removed": false }],
  "sessions":    [{ "uuid", "ended_at", "deleted": false }],
  "full_resync": false
}
```
- Students are sent once even if they take several courses. Embeddings go as base64 float32,
  about 5× smaller than JSON floats.
- `sessions` only carries changes made from the dashboard (ended or deleted there), so a
  device's live class can react.
- Paginate when there is a lot of data (`limit`, `has_more`). The first sync for a big course is
  the largest download.
- `full_resync: true` when the cursor is too old or the model version changed.

**`POST /lecturer/sync/push`**
```json
{ "device_id": "…", "device_time": "2026-10-15T09:00:05Z",
  "ops": [
    { "op_id": "…", "type": "session.start",   "payload": { "uuid", "course_id", "started_at", "venue", "topic" } },
    { "op_id": "…", "type": "attendance.mark", "payload": { "uuid", "session_uuid", "student_id", "marked_at", "method", "confidence" } },
    { "op_id": "…", "type": "attendance.unmark","payload": { "session_uuid", "student_id" } },
    { "op_id": "…", "type": "session.end",     "payload": { "uuid", "ended_at" } },
    { "op_id": "…", "type": "session.delete",  "payload": { "uuid" } }
  ] }
```
Response: one result per op, `applied | duplicate | rejected` (with a reason).

Rules:
- Operations are applied in order inside one DB transaction per batch, up to 200 ops. An
  `op_id` already in `sync_ops` returns `duplicate` with the original result.
- **Clock correction.** `offset = server_now − device_time`. If |offset| > 2 min, adjust the
  device timestamps by the offset and keep the raw values in the `*_device` columns. The
  dashboard flags sessions that needed a big correction.
- **Rejected:** a course that isn't the lecturer's, a student removed from the course *before*
  the session started, or a mark for an unknown `session_uuid` with no `session.start` earlier
  in the queue.
- **Allowed:** sessions that arrive already ended. Overlapping sessions can only come from a
  revoked device that is still sending its queue. They are accepted and flagged.
- `attendance.mark` with `method: "manual"` (matric-number fallback) follows the same rules as
  face marks, with `confidence: null`.
- If the dashboard ended or deleted a session before the device synced, dashboard wins for
  `ended_at`/`deleted`. Marks recorded before that point are still accepted.
- `close_stale_sessions` keeps working on server time. The device applies the same 4 h rule
  locally (see §5).
- Update `devices.last_seen_at`.

### 3.5 Enrolment without DeepFace on the server
New `POST /student/enrol-face` (v2), multipart:
- `embeddings`: JSON `float[][]` from the on-device model, `model_version`, plus the pose photos.
- The server checks: `model_version == settings.face_model_version`, the right vector length,
  all poses are the same person (`check_same_person`, plain numpy), and no duplicate across
  accounts (`find_duplicate`). Then it normalises and stores the embeddings and all photos, and
  bumps `face_updated_at`.
- Remove `deepface`, `tf-keras` and `opencv-python` from `requirements.txt`. Remove the
  `/sessions/{id}/scan` endpoint after the rollout (§8). The server becomes much lighter: no
  TensorFlow, so it starts fast and is easy to host.
- *Optional hardening:* embed the frontal photo on the server with the same TFLite model
  (`ai-edge-litert`) and reject the upload if it doesn't match the submitted embedding. This
  blocks a modified app from uploading fake vectors.

### 3.6 Dashboard edits keep working
`mark_manually` and `unmark` now set `updated_at` and deletion markers, so pulls and pushes
stay consistent. `CourseStats` and every report query must **exclude rows marked deleted**.

### 3.7 Backend tests (`backend/tests/test_sync.py`)
- Re-pushing the same batch gives the same result with no duplicate rows.
- Marks before their `session.start` in the same batch, and in the next batch.
- Student removed from the course before vs after the session started.
- Clock offset correction; dashboard ends a session while the device is offline.
- Pull cursor: only changed rows; deletion markers delivered; `full_resync` on a model change.
- Refresh-token rotation, reuse detection and revocation.
- Enrol v2: wrong vector length, wrong model version, different person across poses, duplicate face.

---

## 4. Phase 2: mobile data layer (`mobile/src/db/`)

### 4.1 Encrypted SQLite
- `app.json`: `["expo-sqlite", { "useSQLCipher": true }]`.
- A 32-byte key from `expo-crypto`, stored in SecureStore, applied with `PRAGMA key` before
  anything else.
- Keep the student-side `cache` table as it is.

### 4.2 Local schema (lecturer)
```sql
meta(key TEXT PRIMARY KEY, value TEXT)            -- pull cursor, last_sync_at, device_id, lecturer_id, model_version
courses(id INTEGER PRIMARY KEY, code, title, is_active, updated_at)
students(id INTEGER PRIMARY KEY, matric_no, full_name, embedding_model, embeddings BLOB, face_updated_at)
enrollments(course_id, student_id, joined_at, removed INTEGER, PRIMARY KEY(course_id, student_id))
sessions(uuid TEXT PRIMARY KEY, server_id INTEGER, course_id, started_at, ended_at, venue, topic, deleted INTEGER)
marks(uuid TEXT PRIMARY KEY, session_uuid, student_id, marked_at, method, confidence, deleted INTEGER,
      UNIQUE(session_uuid, student_id))
outbox(seq INTEGER PRIMARY KEY AUTOINCREMENT, op_id TEXT UNIQUE, type, payload TEXT, created_at,
       attempts INTEGER DEFAULT 0, last_error TEXT, state TEXT DEFAULT 'pending')  -- pending | sent | rejected
```

### 4.3 Repository (`mobile/src/db/attendanceRepo.ts`)
- `startSession(courseId, venue, topic)`, `endSession(uuid)`, `markPresent(sessionUuid, studentId, confidence)`
  (returns `marked | already_marked`), `sessionCounts(uuid)`, `liveSession()`, `recentNames(uuid)`.
- Each one writes the row **and** the outbox entry inside `withTransactionAsync`, then calls
  `syncManager.poke()`.
- `applyPull(payload)`: one transaction that upserts and applies deletion markers.

### 4.4 Data lifecycle
- **Logout:** if the outbox has pending ops, warn: "N records not yet synced. Sync now / Log out
  anyway". After confirming, wipe all lecturer tables.
- **A different lecturer logs in on this device:** wipe first (compare against `meta.lecturer_id`).
- Make `onUnauthorized` (in `AuthContext`) **not** log out a lecturer automatically. Route it to
  the refresh flow instead (§3.3).

---

## 5. Phase 3: on-device recognition (`mobile/src/face/`)

| File | Purpose |
|---|---|
| `model.ts` | Loads `assets/models/fn512.tflite` with `useTensorflowModel` (GPU delegate, CPU fallback) and exports `MODEL_VERSION`. Metro: add `tflite` to `assetExts`. |
| `preprocess.ts` | Worklet: crop, level and resize the frame to a 160×160 float32 tensor, using the ML Kit box and eye landmarks. Must match the Phase 0 pipeline exactly. |
| `embed.ts` | `embedFace(frame, face)` runs inside the frame processor and returns an L2-normalised `Float32Array(512)`. |
| `matcher.ts` | `buildIndex(candidates)` packs all of a course's templates into one `Float32Array` (rows normalised) plus a row→student map. `identify(vec, index)` does dot products, takes the best distance per student, then applies the **same threshold + margin rule** as `face_service.identify`. 1,000 students × 5 poses × 512 ≈ 2.5 M multiplies, under 10 ms. Pure TS, unit-tested. |

Changes to `FaceCamera.tsx`: add an opt-in `onEmbedding` mode. When the liveness challenge is
done and `isReadyForPhoto` passes, compute the embedding **from the live frame** (no photo
saved). Liveness and embedding then come from the same frames, which also makes it harder to
swap in a photo between the check and the capture. Keep `capture()` for enrolment, which also
uploads photos.

---

## 6. Phase 4: sync engine (`mobile/src/sync/`)

`SyncManager` (singleton, only one run at a time):
- **When it runs:** app start, login, app returns to foreground, `expo-network` reports a
  connection, `poke()` after each local write (with a 2 s debounce), every 5 min while the app
  is open, and in the background via `expo-background-task` (Android WorkManager, at least
  every 15 min).
- **Each run:** refresh the token if needed, then **push** (oldest pending ops, batches of 200,
  mark each result `sent` or `rejected`), then **pull** (apply, advance the cursor, repeat while
  `has_more`).
- **Retries:** network or 5xx errors back off exponentially (5 s → 5 min, with jitter). A
  `rejected` op is kept and shown to the lecturer, never retried in silence.
- **Model change:** if the pull shows a different `model_version`, mark students with old
  embeddings as "needs re-enrolment" and leave them out of matching.
- **Status for the UI** (`useSyncStatus()` hook): `{ state: 'synced'|'syncing'|'offline'|'error'|'auth_needed'|'stale'|'blocked', pending, rejected, lastSyncAt }`.
- **Offline limit:** each pull returns `offline_policy: { warn_days: 7, strong_warn_days: 14,
  block_days: 30 }` (server settings `sync_warn_days`, `sync_strong_warn_days`,
  `sync_block_days`), and the device stores it in `meta`. Days are counted from the last
  *successful* sync:
  - **≥ 7 days:** a yellow badge, "Last synced 8 days ago, connect when you can."
  - **≥ 14 days:** an orange banner on the home screen and a confirmation before starting a
    class. The roster is likely out of date: new joiners aren't recognised and removed students
    may still be.
  - **≥ 30 days:** starting a **new** class is blocked until a sync. A class already running
    can still finish, and nothing queued is ever deleted.
  - Refresh tokens last 90 days, longer than the block period, so a sync after a long gap
    doesn't also need a new sign-in.

---

## 7. Phase 5: app screens

### Lecturer
- **`SyncBadge` component** in the header of every lecturer screen: "✓ Synced 2 min ago",
  "⟳ 3 waiting", "⚠ Offline, saved on this phone" or "Sign in to sync". Tapping it opens a
  sheet with Sync now, last sync, pending and rejected counts, and roster age.
- **`LecturerHomeScreen`:** courses come from SQLite (`lecturerApi.courses()` is no longer
  called). Each course shows "N students · M without face · roster updated X ago". Start and
  resume class go through the repository. If a live session is more than 4 h old, end it
  automatically (same rule as the server).
- **Manual mark (fallback):** a "Mark by matric no." button on `TakeAttendanceScreen` opens a
  sheet that searches the local roster by matric number or name, then calls
  `repo.markPresent(..., method: 'manual')`. Present students are listed in the session summary
  with an **Undo** action (`attendance.unmark`). Manual marks are labelled "Manual" on the
  dashboard and in the CSV, as dashboard marks are today, so lecturers can audit them.
- **`TakeAttendanceScreen`:** replace `lecturerApi.scan` with `embed → identify → repo.markPresent`.
  Counts and recent names come from local data. The "class ended from dashboard" check moves to
  the pull (a `sessions[].ended_at` arrives, so show an alert and close). Results appear much
  faster because there is no upload.
- **`SessionSummaryScreen`:** read from local data, and add "Will sync automatically" when offline.
- **First run with no data yet:** "Connect to the internet once to download your courses."

### Student
- **`EnrolFaceScreen`:** compute embeddings on the device per pose, then upload embeddings,
  `model_version` and photos to enrol v2. Enrolment **still needs internet**. Signup already
  does, and it keeps duplicate-face detection on the server.
- **Re-enrol prompt:** if `embedding_model` is outdated, show a home-screen banner: "Update your
  face scan so lecturers can recognise you."

---

## 8. Phase 6: dashboard and rollout

**Dashboard**
- Session rows get a "Recorded offline · synced 10:42" note, plus a warning icon if the clock
  correction was large.
- Profile → **Attendance device:** the active phone (label, last sync), plus **Sign out this
  device**, which revokes it (same push-only grace as in §3.3). Shows a warning when the last
  sync is older than `sync_warn_days`.
- Course page: "N students need to re-enrol (new face model)".

**Rollout (existing data)**
1. Ship the backend with v2 enrolment and sync endpoints. Keep `/scan` and the DeepFace path
   behind `FACE_LEGACY=true` for now.
2. Ship the app. Students re-enrol (banner), and lecturers see progress on the dashboard.
3. Once enough students have re-enrolled, set `FACE_LEGACY=false`, remove `/scan` and DeepFace,
   and clear legacy embeddings.

For the demo or defence database, simply reseed and re-enrol test students.

---

## 9. Security and privacy (Nigeria Data Protection Act 2023)
- Face embeddings on lecturer phones are biometric data. Encrypt them at rest (SQLCipher), keep
  only students of that lecturer's courses, wipe on logout or revoke, and add an optional app
  lock (device biometrics / PIN via `expo-local-authentication`).
- No raw photos are stored on the lecturer's device; only embeddings.
- Update the consent text at student signup: the face template is stored on the server and on
  the lecturer's attendance device.
- Trust model: the lecturer's device is trusted, as it is today. Clock corrections are kept and
  flagged, never silently discarded.

---

## 10. Build order and checkpoints

| # | Work | Checkpoint |
|---|---|---|
| 0 | Model test (§2) | `docs/model-eval.md`: go / no-go |
| 1 | Alembic + schema + refresh tokens | Existing tests pass; migration runs on the seeded DB |
| 2 | Sync push/pull + tests | `test_sync.py` green |
| 3 | Enrol v2 (numpy-only server) | Student enrols from a dev build; duplicate check works |
| 4 | Mobile SQLite + repository + matcher unit tests | Matcher gives the same results as the Python `identify` on the eval set |
| 5 | Sync engine + `SyncBadge` | Airplane-mode test: run a class, kill the app, reopen, reconnect, dashboard correct |
| 6 | Switch the lecturer screens over | Full class of 10+ students offline; no network calls in the scan loop |
| 7 | Dashboard notes, devices, re-enrol progress | — |
| 8 | Remove legacy DeepFace + `/scan` | Server image has no TensorFlow |

### End-to-end acceptance test
1. Lecturer logs in on Wi-Fi; courses and rosters download automatically.
2. Airplane mode on. Start class, scan 10 students (with liveness), end class, start a second class.
3. Kill the app mid-class, reopen, resume, keep scanning.
4. Mark a student on the dashboard for the same session *before* the phone reconnects.
5. Reconnect. Within seconds the badge shows synced, the dashboard shows both sessions with the
   correct times and the "recorded offline" note, and nothing is duplicated.
6. Set the phone clock 1 h wrong and repeat. Times are corrected and the session is flagged.

---

## 11. Open questions
- None blocking. If phones other than the S23 are added later, repeat the Phase 0 speed test on
  them.
