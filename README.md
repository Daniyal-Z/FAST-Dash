# FAST-Dash

Class timetables and exam datesheets for FAST NUCES, as a builder rather than a
spreadsheet: pick your programme, year and section, and keep only the courses
you actually take.

Two pages, one design language:

- **Timetable** — your week as a grid, with clash detection and PNG export.
- **Datesheet** — your exams in order, with same-slot clashes flagged.

Each page shows whatever an administrator last published, and can be taken back
down again from `/admin` when a sheet is out of date.

## How it works

There is no backend. The React app talks to Supabase directly, so there is no
server to cold-start and no wait for the first visitor after a quiet period.

```
Admin (browser)                       Student (browser)
  sign in  ──► Supabase Auth            page load
  upload .xlsx                             │
     │  parsed IN THE BROWSER (SheetJS)    │  read metadata (~1 kB)
     ▼                                     │  fetch payload only if it changed
  validation report                        ▼
     │  "Publish"                       render (localStorage-cached)
     ▼
  datasets (upsert) + upload_log + raw .xlsx archived to Storage
```

Publishing takes effect immediately — no commit, no rebuild, no redeploy.

## Layout

```
frontend/            Vite + React 19 app (the whole product)
  src/lib/parsers/   Excel -> JSON. Pure functions, no DOM, no network.
  src/routes/        Landing, Timetable, Datesheet, Admin
  src/styles/        tokens.css is the design system
  scripts/           parser verification
supabase/
  schema.sql         tables, RLS policies, storage bucket
  functions/         admin-invite (the only server-side code)
fixtures/            real workbooks + the golden dataset, used by the verifier
```

## Getting started

```bash
npm run install:app            # installs into frontend/
cp frontend/.env.example frontend/.env.local   # then fill in URL + key
npm run dev
```

The app lives in `frontend/`. The root `package.json` is a thin wrapper with no
dependencies of its own, so `dev`, `build`, `lint`, `verify:parsers` and
`verify:supabase` all work from the repository root or from `frontend/`.

Without credentials the app still runs; every page shows a "not connected"
state instead of crashing.

### Supabase setup

1. Create a project (free tier is enough — the data is well under 1 MB).
2. Run `supabase/schema.sql` in the SQL editor.
3. Create your own user under **Authentication → Users**, then insert it into
   `public.admins` (the SQL file ends with the exact statement).
4. Turn **off** "Allow new users to sign up" — accounts come only from invites.
5. Copy the project URL and key into `frontend/.env.local`. The quickest
   source for both is the **Connect** button at the top of the dashboard;
   otherwise the URL is under **Settings → Data API** and the key under
   **Settings → API Keys**. Either a publishable key (`sb_publishable_…`) or a
   legacy `anon` key works — both map to the same `anon` role. Never use a
   secret / `service_role` key here; it bypasses RLS and would be compiled
   into the browser bundle.
6. Deploy the invite function (no global install needed):
   ```bash
   npx supabase login
   npx supabase link --project-ref <your-ref>
   npx supabase functions deploy admin-invite
   ```
   Do this **after** step 3 — the function authorises callers by looking them
   up in `public.admins`, so without that row every invite returns 403.
7. Check it:
   ```bash
   npm run verify:supabase
   ```
   This uses only the anon key — the same access a student's browser has — so
   it confirms the tables exist, that anonymous visitors can read the datasets,
   and, importantly, that they **cannot** write to them. It also flags whether
   public signup is still enabled.

The anon key is meant to be public. Row Level Security is the real boundary:
reads are open, and every write requires a row in `public.admins`.

### Deploying

Vercel, with **Root Directory** set to `frontend`. Add `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` as environment variables. Pushes to `main` deploy
automatically.

`frontend/vercel.json` handles the SPA rewrite, without which a hard refresh on
`/timetable` returns 404. It has to live inside the Root Directory — Vercel does
not read a `vercel.json` from above it.

Then add `SUPABASE_URL` and `SUPABASE_ANON_KEY` as **repository secrets** so
`.github/workflows/keepalive.yml` can run. Free Supabase projects pause after
seven days with no traffic, which a term break can easily hit; the workflow
makes one read a day to prevent it.

## Verifying the parsers

```bash
npm run verify:parsers
```

The timetable parser is checked against `fixtures/timetable-golden.json` — the
dataset that was previously hardcoded into the app and served to real students.
It must reproduce all 518 offerings, 748 meetings and every field exactly. The
datesheet parser is run against seven real workbooks spanning three semesters.

Two differences from that golden copy are deliberate, and the verifier prints
them on every run: course titles are whitespace-collapsed, and MSP-3A is
labelled year 2 rather than year 1 (the original extraction mis-read the
`MS (SPM) Fall 2025` heading because of the space before the bracket).

## Notes on the source workbooks

These are maintained by hand and are not consistent. The parsers absorb what
they can and report the rest in the admin validation report, which is why
nothing is published without a human confirming it first:

- Filenames disagree with contents. `Spring 2025 Final.xlsx` is headed
  "MIDTERM - I"; `Spring 2025 Mid 2.xlsx` is headed "FOR FINAL EXAMS". The
  parser trusts the heading, and the label stays editable before publishing.
- Dates mix two- and four-digit years within a single column (`20-Sep-2025`
  alongside `27-Feb-25`).
- Exam times occasionally sit off the period grid (`10:30`), so a class is
  matched to the band that contains it rather than by an exact start time.
- Course codes are not unique: `DS3004` is both a lecture and its lab, and
  `CSXXXX` is a placeholder covering four unrelated MCI courses.
