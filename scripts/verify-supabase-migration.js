const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { gunzipSync } = require('node:zlib');
const Database = require('better-sqlite3');
const postgres = require('postgres').default;

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && !Object.hasOwn(process.env, match[1])) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) throw new Error('DATABASE_URL is missing from .env.');
const sql = postgres(url, { max: 1, prepare: false, ssl: 'require', connect_timeout: 10, pipeline: false });
const temporary = [];

async function main() {
  const marker = await sql`SELECT 1 FROM studyspace_migrations WHERE name='sqlite-to-supabase-v1'`;
  if (!marker.length) throw new Error('The SQLite-to-Supabase migration marker is missing.');
  const accounts = await sql`SELECT id FROM studyspace_accounts ORDER BY id`;
  const workspaces = await sql`SELECT account_id,db_data FROM studyspace_user_databases ORDER BY account_id`;
  const owners = await sql`SELECT id FROM studyspace_accounts WHERE is_owner=1`;
  if (owners.length !== 1) throw new Error(`Expected one owner account but found ${owners.length}.`);
  if (workspaces.length !== 1 || workspaces[0].account_id !== owners[0].id) throw new Error(`Expected one shared workspace for owner ${owners[0].id}, found ${workspaces.length}.`);
  const leakedTests = await sql`SELECT COUNT(*)::int n FROM studyspace_accounts WHERE email LIKE 'codex-supabase-smoke-%@example.test'`;
  if (leakedTests[0].n) throw new Error(`${leakedTests[0].n} temporary Supabase test account(s) remain.`);

  let notes = 0;
  let documents = 0;
  let localOriginals = 0;
  let b2Originals = 0;
  for (const workspace of workspaces) {
    const filename = path.join(os.tmpdir(), `studyspace-verify-${workspace.account_id}-${process.pid}.sqlite`);
    temporary.push(filename);
    fs.writeFileSync(filename, gunzipSync(workspace.db_data), { mode: 0o600 });
    const db = new Database(filename, { readonly: true, fileMustExist: true });
    try {
      notes += db.prepare('SELECT COUNT(*) n FROM notes').get().n;
      const docTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='documents'").get();
      if (docTable) {
        documents += db.prepare('SELECT COUNT(*) n FROM documents').get().n;
        localOriginals += db.prepare("SELECT COUNT(*) n FROM documents WHERE storage_backend='local' AND storage_key IS NOT NULL").get().n;
        b2Originals += db.prepare("SELECT COUNT(*) n FROM documents WHERE storage_backend='backblaze' AND storage_key IS NOT NULL").get().n;
      }
    } finally {
      db.close();
    }
  }
  console.log(`Verified ${accounts.length} account(s) and one shared Supabase workspace.`);
  console.log(`Imported study content: ${notes} note(s), ${documents} document record(s).`);
  console.log(`File references: ${b2Originals} in B2, ${localOriginals} still local.`);
}

main()
  .catch(error => {
    console.error(`Supabase migration verification failed (${error.code || error.name}): ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const filename of temporary) try { fs.unlinkSync(filename); } catch {}
    await sql.end();
  });
