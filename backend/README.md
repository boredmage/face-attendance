# Backend — Face Recognition Attendance API

Python 3.10–3.13 (TensorFlow has no 3.14 wheels yet) · FastAPI · SQLAlchemy · DeepFace · JWT

## 1. Install

```bash
cd backend
python3.13 -m venv .venv          # any 3.10–3.13 works; 3.14 cannot install TensorFlow
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt    # deepface + tf-keras are large (~1 GB); be patient
cp .env.example .env
```

If DeepFace/TensorFlow will not install on your machine yet, set `FACE_BACKEND=mock` in
`.env` — every endpoint works, but recognition is fake (a scan always matches the closest enrolled student). Switch back to `deepface` for the real demo.

## 2. Seed demo data and run

```bash
python -m app.seed --reset    # --reset is required when upgrading from the v1 (student self-marking) schema
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

(If you moved the project folder, the venv's `uvicorn`/`pytest` launchers break; `python -m ...` always works.)

Swagger UI: http://localhost:8000/docs

Demo logins (password `password123`):

* Lecturers (dashboard + lecturer mode in the app): `ao.bello@ui.edu.ng` (CSC401, CSC407), `ft.ibrahim@ui.edu.ng` (CSC403), `rk.adeyemi@ui.edu.ng` (MAT401)
* Students (app): `CSC/2021/001` … `CSC/2021/008`

The seed creates ten weeks of ended classes with attendance so the dashboard has statistics to show.

## 3. Enrol faces

New students enrol their face in the app straight after registering (look straight, then turn
left, right, up and down; a photo is captured at each pose). They cannot join courses until they have.
Seeded students have no face yet: log in as them in the app, or use photo files:

```bash
python enrol_face_cli.py CSC/2021/001 frontal.jpg [left.jpg right.jpg ...]   # frontal photo first
```

A face that is already enrolled on another account is rejected, so one person cannot hold two accounts.

On start-up the server loads the model and detector weights in the background (first run
downloads ~200 MB into `~/.deepface/weights`); the log prints `face recognition ready` when done.

## 4. Run tests

```bash
python -m pytest -q
```

Tests use a throw-away SQLite file and `FACE_BACKEND=mock`, so they run without TensorFlow.

## Troubleshooting

* **Every enrolment says "No face detected"** even with a clear selfie — check the server log for
  `detector opencv failed`. DeepFace's OpenCV, SSD and YuNet detectors all break on
  `opencv-python` 5.x; `requirements.txt` pins 4.x. Fix with `pip install "opencv-python<5"`.
* **The first enrolment times out** — the server was still downloading model weights. Wait for
  `face recognition ready` in the log (start-up warm-up), then retry.

## 5. PostgreSQL (optional)

```
DATABASE_URL=postgresql+psycopg2://postgres:postgres@localhost:5432/attendance
```

The schema is created and upgraded automatically on start-up (Alembic, see `migrations/`).
Databases made before migrations existed are detected and upgraded in place.

## 6. The on-device face model

Faces are recognised on the phones, not here. Both the student app (enrolment) and the
lecturer's phone (attendance) run the same TFLite model, which you generate once from the
DeepFace weights (needs the full `requirements.txt`, including TensorFlow):

```bash
python -m tools.convert_facenet_tflite      # writes ../mobile/assets/models/facenet512.tflite (~47 MB)
```

The script checks the TFLite output against the Keras model. To choose the match threshold for
real conditions, take photos with the attendance phone (one folder per person, `enrol*.jpg` =
enrolment poses, anything else = attendance shots) and run:

```bash
python -m tools.eval_faces path/to/photos   # prints genuine/impostor distances + a suggested threshold
```

Set the result as `FACE_DISTANCE_THRESHOLD`; phones pick it up on their next sync.

`enrol_face_cli.py` enrols a student from photo files with the same model and crop rules
(YuNet standing in for ML Kit), handy for demos.

## Offline sync (lecturer phone)

The lecturer's phone keeps its own encrypted copy of their courses, rosters and face
embeddings, takes attendance with no network, and syncs whenever it can:

* `GET /lecturer/sync/pull?since=<cursor>`: changes since the last pull (or a full snapshot):
  courses, enrolments, students with base64 float32 embeddings, recent sessions/marks, deletions
  (tombstones), plus the matching threshold and offline policy.
* `POST /lecturer/sync/push`: queued operations (`session.start`, `session.end`,
  `attendance.mark`, `attendance.unmark`). Each `op_id` is applied at most once, so re-sending is
  safe. Timestamps are corrected when the phone's clock is off by more than
  `SYNC_CLOCK_TOLERANCE_SECONDS`.
* Signing in from the app (with a `device_id`) returns a rotating refresh token
  (`/auth/refresh`, `REFRESH_TOKEN_DAYS`). A lecturer has one active phone; signing in on another
  makes the old one push-only for `SYNC_REVOKED_GRACE_DAYS`.
* The phone warns after `SYNC_WARN_DAYS` / `SYNC_STRONG_WARN_DAYS` without a sync and refuses to
  start new classes after `SYNC_BLOCK_DAYS`.
* `FACE_LEGACY=true` (default for now) still accepts photo-only enrolment from old app versions and
  the old `/scan` endpoint. Set it to `false` once every student has re-enrolled.

See `docs/offline-first-plan.md` for the full design.

## Endpoints

Auth (no token):

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/student/register` | create a student account → JWT |
| POST | `/auth/student/login` | `{matric_no, password}` → JWT |
| POST | `/auth/lecturer/register` | create a lecturer account (dashboard sign-up) → JWT |
| POST | `/auth/lecturer/login` | `{email, password}` → JWT; with `device_id` (the app) also a refresh token |
| POST | `/auth/refresh` | `{refresh_token}` → new access + refresh token (lecturer phones) |

Tokens carry a role; a student token cannot call `/lecturer/*` and vice versa (403).

Student (`/student/*`, `/auth/student/me`):

| Method | Path | Purpose |
|---|---|---|
| POST | `/student/enrol-face` | multipart `images` (up to 8, frontal first) + `embeddings` (JSON, computed on the phone) + `model_version` |
| GET | `/student/dashboard` | per-course standing (same rows as `/student/courses`), live classes right now, recent attendance |
| GET | `/student/catalog?q=` | all active courses, with `joined` flag |
| POST | `/student/courses/{id}/join` | join a course (face must be enrolled) → lecturer notified |
| GET | `/student/courses` | my courses with held / attended / % and exam standing (`eligible`, `classes_to_qualify`, `can_miss`, `required_pct`) |
| GET | `/student/courses/{id}` | class history + at-risk flag + exam standing |
| GET | `/student/lecturers` | my lecturers + contact details |

Lecturer (`/lecturer/*`, `/auth/lecturer/me` GET/PATCH):

| Method | Path | Purpose |
|---|---|---|
| GET | `/lecturer/overview` | dashboard statistics: KPIs, trend, per course, per weekday, at-risk students, live classes |
| GET / POST | `/lecturer/courses` | list / create courses |
| GET / PATCH / DELETE | `/lecturer/courses/{id}` | detail (students, sessions, trend) / edit or archive / delete (only if no classes) |
| DELETE | `/lecturer/courses/{id}/students/{sid}` | remove a student from the course |
| GET | `/lecturer/courses/{id}/export.csv` | attendance register (P / A per class) |
| GET | `/lecturer/sync/pull`, POST `/lecturer/sync/push` | offline sync for the lecturer's phone (see above) |
| GET | `/lecturer/devices`, POST `/lecturer/devices/{id}/revoke` | the lecturer's attendance phones / sign one out |
| POST | `/lecturer/courses/{id}/sessions` | start a class now (legacy online flow; the app now syncs sessions) |
| GET | `/lecturer/sessions?course_id=&state=live\|ended` | class logs |
| GET / DELETE | `/lecturer/sessions/{id}` | present + absent lists / delete a class started by mistake |
| POST | `/lecturer/sessions/{id}/scan` | legacy (`FACE_LEGACY`): multipart `image` → identify on the server |
| POST | `/lecturer/sessions/{id}/end` | end the class |
| PUT / DELETE | `/lecturer/sessions/{id}/attendance/{sid}` | manual correction: mark present / remove mark |
| GET | `/lecturer/sessions/{id}/export.csv` | one class as CSV |
| GET | `/lecturer/notifications` | "student joined" notifications + unread count |
| POST | `/lecturer/notifications/read-all`, `/lecturer/notifications/{id}/read` | mark read |

## How attendance is taken

1. The lecturer taps **Start class** on their phone (lecturer mode of the app). No network needed.
2. Each student looks at the lecturer's phone and completes a random liveness challenge (on-device, ML Kit).
3. The phone embeds the face (Facenet512, TFLite) and compares it with every student registered
   for the course, using the embeddings it synced earlier (1:N). The closest student is marked
   present if their distance is below `FACE_DISTANCE_THRESHOLD` (0.30) **and** beats the runner-up
   by `FACE_IDENTIFY_MARGIN` (0.05), so two look-alikes are never confused silently. Students the
   camera can't recognise can be marked by matric number (shown as "manual").
4. The lecturer taps **End class**. Classes left running are ended automatically after
   `SESSION_AUTO_END_HOURS` (4), on the phone and on the server.
5. The phone uploads everything through `/lecturer/sync/push` as soon as it has internet.

## How statistics are counted

* A class counts for every enrolled student once it has ended, including classes held before they
  joined the course: joining after three classes means three classes missed.
* If a student was marked present, the class counts for them straight away (even while live).
* Course / overview averages pool present ÷ expected over ended classes. Below 75% = at risk.
