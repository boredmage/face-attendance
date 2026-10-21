# An Intelligent Mobile Face Recognition Based Attendance System

Final year project — Department of Computer Science, University of Ibadan.

Three parts:

| Folder | Who uses it | Stack |
|---|---|---|
| `backend/` | everything talks to it; sync hub for the lecturer's phone | Python, FastAPI, SQLAlchemy, Alembic, JWT, SQLite/PostgreSQL |
| `dashboard/` | **lecturers** (web): register, create courses, view logs & statistics | Next.js, TypeScript, Tailwind, Recharts |
| `mobile/` | **students** (full app) and **lecturers** (attendance-taking only, works offline) | Expo (React Native), vision-camera + ML Kit, Facenet512 on TFLite, SQLCipher |

## How it works

1. **Lecturer** registers on the dashboard and creates courses.
2. **Student** registers in the app and immediately enrols their face (Face-ID style: straight, left, right, up, down).
   They can then browse and join any course. The lecturer gets a dashboard notification for every join.
3. **In class**, the lecturer logs into the same app (Lecturer tab), taps **Start class**, and students take turns
   looking at the lecturer's phone and following a random 20-second liveness challenge (e.g. "smile", then
   "turn your head to your right", one prompt at a time). **The phone itself** identifies each face among the
   students registered for that course and marks them present, with no internet needed. The lecturer taps **End class**.
   Like a POS till, the phone keeps everything locally and syncs with the server automatically whenever it is online.
4. **After class**, the dashboard shows the class log (present / absent, arrival times), per-course and per-student
   statistics, at-risk students (< 75%), trends, and CSV exports. Students see their own history in the app and,
   for each course separately, whether they are eligible for its exam (>= 75% attendance in that course).

## Quick start with Docker (backend + dashboard)

```bash
docker compose up --build -d                                   # backend :8000, dashboard :3000
docker compose run --rm backend python -m app.seed --reset     # demo data, first time only
```

Then set `API_BASE_URL` in `mobile/src/config.ts` to `http://<your-PC-LAN-IP>:8000` and run the app
(`npx expo run:android`). Database and enrolment photos persist in the `backend-data` volume.
Copy `.env.example` to `.env` to change ports, the JWT secret, or to open the dashboard from a phone
(`PUBLIC_API_URL` / `CORS_ORIGINS`, then rebuild). The image has no TensorFlow: faces are embedded on
the phones. Old app versions that upload photos only need `WITH_DEEPFACE=true` and `FACE_LEGACY=true`.

## Quick start (without Docker)

```bash
# Terminal 1 — backend
cd backend && python3.13 -m venv .venv && source .venv/bin/activate   # Python 3.10–3.13
pip install -r requirements.txt && cp .env.example .env
python -m app.seed --reset
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000

# Terminal 2 — dashboard  → http://localhost:3000
cd dashboard && npm install && cp .env.example .env.local && npm run dev

# Terminal 3 — mobile
cd backend && python -m tools.convert_facenet_tflite && cd ..   # once: builds the on-device face model
cd mobile && bun install
# set API_BASE_URL in src/config.ts to http://<your-PC-LAN-IP>:8000
npx expo run:android
```

Demo logins (password `password123`): lecturer `ao.bello@ui.edu.ng`, students `CSC/2021/001` … `CSC/2021/008`.
Seeded students have no face enrolled yet — log in as one in the app to enrol, or register a new student.

See `backend/README.md`, `dashboard/README.md` and `mobile/README.md` for details, tests and troubleshooting.

## System overview

```
┌──────────────────────────────┐                        ┌──────────────────────────┐
│ Expo app: student            │  JWT (role=student)    │ FastAPI backend          │
│ · register, join, history    │ ─────────────────────▶ │ · /auth  (both roles)    │
│ · enrol face: embeds the     │  photos + embeddings   │ · /student/*             │
│   5 poses ON THE PHONE       │                        │ · /lecturer/* (dashboard)│
└──────────────────────────────┘                        │ · /lecturer/sync/*       │
┌──────────────────────────────┐  sync when online      │ · SQLAlchemy → SQLite/PG │
│ Expo app: lecturer (offline) │ ◀── pull: rosters,     └────────────▲─────────────┘
│ · encrypted local copy of    │     faces, deletions                │
│   courses + face embeddings  │ ──▶ push: queued                    │
│ · liveness + 1:N match       │     sessions & marks                │
│   on the phone               │                                     │
└──────────────────────────────┘                                     │
┌──────────────────────────────┐  JWT (role=lecturer)                │
│ Next.js dashboard            │ ────────────────────────────────────┘
│ · courses, logs, stats,      │
│   notifications, CSV, phone  │
└──────────────────────────────┘
```

Face recognition runs on the phones: students' phones compute their face embeddings at enrolment and
the lecturer's phone matches against the embeddings of its own students, stored encrypted (SQLCipher).
The server stores embeddings and enrolment photos but no longer runs a face model. See
`docs/offline-first-plan.md` for the design.
