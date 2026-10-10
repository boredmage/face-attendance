# An Intelligent Mobile Face Recognition Based Attendance System

Final year project — Department of Computer Science, University of Ibadan.

Three parts:

| Folder | Who uses it | Stack |
|---|---|---|
| `backend/` | everything talks to it | Python, FastAPI, SQLAlchemy, DeepFace (Facenet512), JWT, SQLite/PostgreSQL |
| `dashboard/` | **lecturers** (web): register, create courses, view logs & statistics | Next.js, TypeScript, Tailwind, Recharts |
| `mobile/` | **students** (full app) and **lecturers** (attendance-taking only) | Expo (React Native), vision-camera + ML Kit face detection |

## How it works

1. **Lecturer** registers on the dashboard and creates courses.
2. **Student** registers in the app and immediately enrols their face (Face-ID style: straight, left, right, up, down).
   They can then browse and join any course. The lecturer gets a dashboard notification for every join.
3. **In class**, the lecturer logs into the same app (Lecturer tab), taps **Start class**, and students take turns
   looking at the lecturer's phone and following a random 20-second liveness challenge (e.g. "smile", then
   "turn your head to your right", one prompt at a time). The server identifies each face among the
   students registered for that course and marks them present. The lecturer taps **End class**.
4. **After class**, the dashboard shows the class log (present / absent, arrival times), per-course and per-student
   statistics, at-risk students (< 75%), trends, and CSV exports. Students see their own history in the app and,
   for each course separately, whether they are eligible for its exam (>= 75% attendance in that course).

## Quick start

```bash
# Terminal 1 — backend
cd backend && python3.13 -m venv .venv && source .venv/bin/activate   # Python 3.10–3.13
pip install -r requirements.txt && cp .env.example .env
python -m app.seed --reset
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000

# Terminal 2 — dashboard  → http://localhost:3000
cd dashboard && npm install && cp .env.example .env.local && npm run dev

# Terminal 3 — mobile
cd mobile && npm install
# set API_BASE_URL in src/config.ts to http://<your-PC-LAN-IP>:8000
npx expo run:android
```

Demo logins (password `password123`): lecturer `ao.bello@ui.edu.ng`, students `CSC/2021/001` … `CSC/2021/008`.
Seeded students have no face enrolled yet — log in as one in the app to enrol, or register a new student.

See `backend/README.md`, `dashboard/README.md` and `mobile/README.md` for details, tests and troubleshooting.

## System overview

```
┌──────────────────────────┐                        ┌──────────────────────────┐
│ Expo app                 │  JWT (role=student)    │ FastAPI backend          │
│ · Student: register,     │ ─────────────────────▶ │ · /auth  (both roles)    │
│   enrol face, join,      │                        │ · /student/*             │
│   history                │  JWT (role=lecturer)   │ · /lecturer/*            │
│ · Lecturer: start class, │ ─────────────────────▶ │ · DeepFace 1:N identify  │
│   liveness, scan, end    │   POST …/scan (photo)  │ · SQLAlchemy → SQLite/PG │
└──────────────────────────┘                        └────────────▲─────────────┘
┌──────────────────────────┐  JWT (role=lecturer)                │
│ Next.js dashboard        │ ────────────────────────────────────┘
│ · courses, logs, stats,  │
│   notifications, CSV     │
└──────────────────────────┘
```

Face embeddings never leave the server. The phone only detects that a face is present (and passes the liveness challenge) before capturing.
