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

Tables are created automatically on startup.

## Endpoints

Auth (no token):

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/student/register` | create a student account → JWT |
| POST | `/auth/student/login` | `{matric_no, password}` → JWT |
| POST | `/auth/lecturer/register` | create a lecturer account (dashboard sign-up) → JWT |
| POST | `/auth/lecturer/login` | `{email, password}` → JWT |

Tokens carry a role; a student token cannot call `/lecturer/*` and vice versa (403).

Student (`/student/*`, `/auth/student/me`):

| Method | Path | Purpose |
|---|---|---|
| POST | `/student/enrol-face` | multipart `images` (up to 8, frontal first) → one embedding per photo |
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
| POST | `/lecturer/courses/{id}/sessions` | start a class now (one live class per lecturer) |
| GET | `/lecturer/sessions?course_id=&state=live\|ended` | class logs |
| GET / DELETE | `/lecturer/sessions/{id}` | present + absent lists / delete a class started by mistake |
| POST | `/lecturer/sessions/{id}/scan` | multipart `image` → identify the student among the class and mark them |
| POST | `/lecturer/sessions/{id}/end` | end the class |
| PUT / DELETE | `/lecturer/sessions/{id}/attendance/{sid}` | manual correction: mark present / remove mark |
| GET | `/lecturer/sessions/{id}/export.csv` | one class as CSV |
| GET | `/lecturer/notifications` | "student joined" notifications + unread count |
| POST | `/lecturer/notifications/read-all`, `/lecturer/notifications/{id}/read` | mark read |

## How attendance is taken

1. The lecturer taps **Start class** on their phone (lecturer mode of the app).
2. Each student looks at the lecturer's phone and completes a random liveness challenge (on-device, ML Kit);
   the phone sends one photo to `/lecturer/sessions/{id}/scan`.
3. The server embeds the face (DeepFace, Facenet512) and compares it with every student registered
   for the course (1:N). The closest student is marked present if their distance is below
   `FACE_DISTANCE_THRESHOLD` (0.30) **and** beats the runner-up by `FACE_IDENTIFY_MARGIN` (0.05),
   so two look-alikes are never confused silently.
4. The lecturer taps **End class**. Classes left running are ended automatically after
   `SESSION_AUTO_END_HOURS` (4).

## How statistics are counted

* A class counts for a student once it has ended, if they had joined the course before it started.
  Classes held before a student joined never count against them.
* If a student was marked present, the class counts for them straight away (even while live).
* Course / overview averages pool present ÷ expected over ended classes. Below 75% = at risk.
