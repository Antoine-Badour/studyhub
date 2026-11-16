# Studyspace

A shared study workspace with separate account logins, durable Supabase storage, optional Backblaze B2 file storage, and a server-side Google Gemini tutor.

## Run locally

1. Install Node.js 20 or later.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and add your Google Gemini API key as `GEMINI_API_KEY` when ready. You can also set `GEMINI_MODEL` and `PORT` there. Leave `DATABASE_URL` blank to use local SQLite, or set it to a Supabase Postgres URI.
4. Run `node server.js` and open `http://localhost:3000` in your browser.
5. Create the first account as the owner. After that, anyone who can reach the site can create a separate account from the sign-in screen.

The key is only read by the server. Never paste it into the browser or commit `.env`.

## What is included

- Responsive workspace with dark and light palettes, including the new Dino Discovery theme.
- Dashboard sourced from saved study data, subjects, study timer, courses and lessons.
- Gemini tutor with five teaching modes, saved/reopened chat history, server-side relevant memory context, and explicit remember/forget commands.
- Persistent personal and subject memories with search, edit, delete, clear, category, and timestamps. When enabled, Gemini can extract up to two durable learning facts after a tutoring exchange; the prompt asks it to avoid assumptions and sensitive secrets.
- Shared notes library with chapter folders, note labels, filters, and source selection to generate flashcards or quizzes from one note, a folder, or a label.
- Notes, PDF/DOCX/TXT text extraction (12 MB limit), and Gemini study-note generation with visual diagrams. Generated notes can be filed in a chapter folder and labeled when made from pasted text, documents, or YouTube videos.
- Shared notes library with folders, editable labels, and filters so both accounts can organize and find notes together.
- Study notes from public YouTube links using Gemini video understanding; generated notes keep a link to their source video.
- PDF, DOCX, TXT, and Markdown uploads with Backblaze B2 object storage, local fallback, server-side downloads/deletion, and saved Gemini study notes linked to the source file.
- Manual decks/cards, due queue, and a simplified SM-2 review schedule.
- Gemini generated structured learning paths, quizzes, flashcards, and problem solutions. Quiz questions/results are persisted and reviewable.
- Study-time and lesson/quiz analytics, preferences, local JSON export.
- Persistent study calendar for exams, deadlines, and timed or all-day study sessions, with a month grid and upcoming dashboard list.
- Email/password accounts with open self-registration, shared study content, sign-out, and separate password-protected logins.

## Data and privacy

In local development, credentials and hashed sessions are in `data/accounts.sqlite`; study content lives in one shared SQLite workspace at `data/users/user-<owner-id>.sqlite`. With `DATABASE_URL`, Supabase Postgres stores the separate account credentials and sessions plus one compressed SQLite snapshot for the shared workspace. The app loads it into temporary storage for signed-in requests and uses a database transaction lock to serialize access across Vercel instances. Both accounts see the same notes, folders, labels, memories, courses, documents, calendar, settings, and other study content; passwords and sessions remain separate. Keep `DATABASE_URL` server-side; never expose it in browser code.

Uploaded originals use random storage keys and are available only through the signed-in account's document records. Keep the app's `data` directory and local `uploads` directory on persistent private storage when hosting. Use HTTPS and set `NODE_ENV=production` so session cookies are marked Secure. Before public first-account setup, set a long random `STUDYSPACE_SETUP_TOKEN` on the server and enter it in the setup form. Back up each account from Settings → Export backup. Users can change their passwords in Settings.
Gemini calls use the official `@google/genai` SDK from server code only. The selected model defaults to `gemini-3.8-flash` and can be changed with `GEMINI_MODEL`. Public YouTube links are sent directly to Gemini for video understanding; private and unlisted videos are not supported. Google labels YouTube URL processing as a preview, so availability and limits may change. Document parsing is local; image OCR/question uploads, image rendering, and multimodal document Q&A are not implemented. Gemini is required for AI generated content; the app does not substitute simulated responses.

## Maintenance

### Connect Backblaze B2

1. Create a **private B2 bucket** and a **bucket-restricted application key**. Do not use the account master key. Give the key read, write, and delete access to that bucket so Studyspace can upload, download, and remove library files.
2. Copy the bucket name, bucket region (for example `us-west-004`), application key ID, and application key. The regional endpoint is `https://s3.<region>.backblazeb2.com`.
3. Add these settings to the private `.env` file beside `server.js` (never share or commit it):

   ```env
   B2_BUCKET_NAME=your-private-bucket
   B2_REGION=us-west-004
   B2_ENDPOINT=https://s3.us-west-004.backblazeb2.com
   B2_APPLICATION_KEY_ID=your-key-id
   B2_APPLICATION_KEY=your-application-key
   ```

4. Restart `node server.js`. New originals will be stored in B2. Older local uploads remain local until migrated manually.

With “Have Gemini create and save study notes” checked, uploading a document extracts its text locally, uploads the original, and saves a study guide in Notes & library. Larger extracted documents are summarized in chunks and combined. Image-only scanned PDFs need OCR, which is not included yet.

`AGENTS.md` records project rules. The server creates tables on startup. Stop it with Ctrl+C. `npm start` is also available for normal local use.

## Hosting on Vercel

1. Add a Supabase Postgres URI to Vercel's server-side environment as `DATABASE_URL`. Use Supabase's **Transaction pooler** URI for Vercel serverless hosting; never use a `NEXT_PUBLIC_` prefix for this secret.
2. Add `GEMINI_API_KEY`, `STUDYSPACE_SETUP_TOKEN`, and the five `B2_*` values from the Backblaze section to Vercel's Production environment.
3. Deploy the project from its Git repository. Vercel detects the Express app; files in `public/` are served as static assets.
4. Open the deployment and create the first account using `STUDYSPACE_SETUP_TOKEN`. Later visitors can register separate accounts.

### Move local accounts and study data to Supabase

Keep the local `data` and `uploads` folders intact and stop the local app before migrating. With `DATABASE_URL` and B2 settings set in `.env`, run `npm run db:check`, then `npm run db:migrate`. The migration copies account credentials and active sessions, moves local originals to B2, and imports the owner's shared SQLite workspace; it leaves local files untouched. It stops if Supabase already contains accounts, to protect existing data. No SQL Editor steps are needed; the migration creates the required tables.

The app also accepts `POSTGRES_URL`, which Supabase can provide through its Vercel integration. Vercel functions do not have durable local files, so uploads require B2.
