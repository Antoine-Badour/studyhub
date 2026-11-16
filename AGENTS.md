# Studyspace project notes

- Studyspace is a personal learning platform. Keep Gemini as the only AI provider.
- Gemini calls must remain server-side; read `GEMINI_API_KEY` from the environment and never persist or return it.
- SQLite is the durable source of truth for the shared study workspace. Keep study content and memory separate from transient UI state.
- Keep local account credentials and hashed sessions in `data/accounts.sqlite`; local shared study content is in the owner's SQLite file under `data/users`. In production, use Supabase for credentials, sessions, and the durable shared SQLite workspace snapshot. Protect every `/api` route except `/api/auth/*` with a signed-in session; keep credentials private while allowing every signed-in member to access the shared study workspace.
- The first account is the owner; after setup, allow account self-registration. Keep passwords salted and hashed and sessions in HttpOnly cookies. Accounts have separate logins and share notes, folders, labels, courses, memories, files, calendar entries, and other study content.
- Do not fabricate AI output or learning analytics. Show an actionable unavailable message when Gemini is not configured.
- Keep uploads bounded and treat extracted document text as untrusted input.
- Store original learning files in a private Backblaze B2 bucket via its S3-compatible API when configured. Keep B2 credentials in `.env` on the server; never expose them in the browser or logs.
- Preserve a local upload fallback while B2 is not configured, and report the actual destination.
- Generate document notes only from successfully extracted document text and link them to the source document. YouTube notes may be generated from a public video URL by passing it directly to Gemini server-side, and must link the saved note to that URL.
- Include useful study aids and at least one source-grounded visual diagram in AI-generated study notes. Render diagrams safely in the notes viewer.
- Run `node server.js` to start the application. See README.md for setup and data locations.
