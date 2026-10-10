# Dashboard — Lecturer web app

Next.js 16 (App Router) · React 19 · Tailwind CSS 4 · Recharts 3

Lecturers register here, create their courses, and see attendance logs and statistics.
Attendance itself is taken from the **mobile app** (lecturer sign-in → Start class → scan faces).
Students never use this dashboard.

## Setup

```bash
cd dashboard
npm install
cp .env.example .env.local      # then edit if the API isn't on localhost:8000
npm run dev                     # http://localhost:3000
```

The backend must allow the dashboard's origin (`CORS_ORIGINS=http://localhost:3000` in `backend/.env`,
comma-separated if you serve it from elsewhere).

| Variable | Default | Meaning |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | FastAPI backend base URL (baked in at build time) |

Demo login after `python -m app.seed`: `ao.bello@ui.edu.ng` / `password123`.

Production: `npm run build && npm start`.

## Pages

| Route | What it shows |
|---|---|
| `/login`, `/register` | Lecturer sign-in and sign-up (title, name, staff ID, email, department, faculty, phone, office, password) |
| `/` | Overview: KPI tiles, live-class card (refreshes every 5 s while you scan on your phone), attendance trend, average by course, weekday stats, students at risk (< 75%), recent classes. New lecturers get a 3-step getting-started card instead |
| `/courses` | Course cards with stats, create-course modal, show-archived toggle |
| `/courses/[id]` | Course KPIs, per-class trend, registered students (search, sort, status, face-enrolled, remove), classes, edit / archive / delete, attendance-register CSV export |
| `/sessions` | Class logs across all courses, filter by course and live/ended (`?course=1&state=ended`) |
| `/sessions/[id]` | One class: present list (time, minutes after start, method, match confidence), absent list with *Mark present*, *Remove* a mark, arrivals histogram, CSV export, End class, Delete |
| `/notifications` | "Student joined" feed; mark one or all read |
| `/profile` | Edit the details students see |

The top bar's bell polls every 20 s. When a new student joins one of your courses, its badge
updates and a toast appears.

## Structure

```
src/
  app/
    (auth)/            login + register, split branding layout
    (app)/             signed-in pages; layout redirects to /login without a session
  components/          Shell (sidebar, drawer, bell), ui primitives, charts, tables, course form, toast
  lib/
    api.ts             typed fetch wrapper + types mirroring backend/app/schemas.py
    auth.tsx           AuthProvider (JWT in localStorage, 401 → logout)
    hooks.ts           useApi(fetcher, key, pollMs)
    format.ts          dates in the browser's local time, percentages, thresholds
```

Attendance thresholds match the mobile app: ≥ 75% good (green), 50–74% warning (amber), < 50% at risk (red).
Status badges always carry an icon and the number, so the meaning never relies on colour alone.
