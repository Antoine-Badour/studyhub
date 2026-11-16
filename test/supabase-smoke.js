const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const postgres = require('postgres').default;

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && !Object.hasOwn(process.env, match[1])) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for Supabase integration checks.');
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const testEmails = [`codex-supabase-smoke-a-${suffix}@example.test`, `codex-supabase-smoke-b-${suffix}@example.test`];
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, ssl: 'require', connect_timeout: 10, pipeline: false });
let child;
let output = '';
let passed = 0;
let ownerWorkspaceId = null;
let workspaceBackup = null;

function check(condition, description) {
  assert.ok(condition, description);
  passed++;
  process.stdout.write(`✓ ${description}\n`);
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function request(base, route, { method = 'GET', body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${base}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  return { response, data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

async function startServer() {
  const port = await freePort();
  child = spawn(process.execPath, [path.join(root, 'server.js')], {
    cwd: root,
    env: { ...process.env, PORT: String(port), NODE_ENV: 'production', STUDYSPACE_FORCE_SQLITE: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(`Remote-backed app exited during startup.\n${output}`);
    try { if ((await fetch(`${base}/api/auth/me`)).ok) return base; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Remote-backed app did not start.\n${output}`);
}

async function stopServer() {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill();
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3000))]);
}

async function cleanup() {
  await stopServer();
  await sql`DELETE FROM studyspace_accounts WHERE email LIKE 'codex-supabase-smoke-%@example.test'`;
  if (workspaceBackup && ownerWorkspaceId !== null) await sql`UPDATE studyspace_user_databases SET db_data=${workspaceBackup},updated_at=CURRENT_TIMESTAMP WHERE account_id=${ownerWorkspaceId}`;
  await sql.end();
}

async function main() {
  const owner = await sql`SELECT id FROM studyspace_accounts WHERE is_owner=1 LIMIT 1`;
  if (!owner.length) throw new Error('The migrated owner account is missing.');
  ownerWorkspaceId = owner[0].id;
  const savedWorkspace = await sql`SELECT db_data FROM studyspace_user_databases WHERE account_id=${ownerWorkspaceId}`;
  if (!savedWorkspace.length) throw new Error('The owner shared workspace is missing.');
  workspaceBackup = Buffer.from(savedWorkspace[0].db_data);
  const owners = await sql`SELECT COUNT(*)::int AS n FROM studyspace_accounts WHERE is_owner=1`;
  check((await sql`SELECT 1 FROM studyspace_migrations WHERE name='sqlite-to-supabase-v1'`).length === 1, 'migration marker exists in Supabase');
  check((await sql`SELECT COUNT(*)::int AS n FROM studyspace_user_databases`)[0].n === owners[0].n, 'Supabase has one stored shared workspace');

  const base = await startServer();
  const a = await request(base, '/api/auth/register', { method: 'POST', body: { email: testEmails[0], password: 'remote-smoke-password-a' } });
  check(a.response.status === 201 && !!a.cookie, 'creates and signs in a Supabase-backed account');
  const folder = await request(base, '/api/note-folders', { method: 'POST', cookie: a.cookie, body: { name: `Shared folder ${suffix}` } });
  const firstNote = await request(base, '/api/notes', { method: 'POST', cookie: a.cookie, body: { title: 'Remote note A', body: 'Saved to compressed shared Supabase workspace.', folder_id: folder.data.id, labels: ['shared', 'integration'] } });
  const readA = await request(base, '/api/notes', { cookie: a.cookie });
  check(folder.response.status === 201 && firstNote.response.ok && readA.data.some(note => note.title === 'Remote note A'), 'persists notes, folders, and labels through Supabase');

  const b = await request(base, '/api/auth/register', { method: 'POST', body: { email: testEmails[1], password: 'remote-smoke-password-b' } });
  const readB = await request(base, '/api/notes', { cookie: b.cookie });
  check(b.response.status === 201 && readB.data.some(note => note.title === 'Remote note A'), 'new accounts join the shared Supabase workspace');
  const sharedNote = await request(base, `/api/notes/${firstNote.data.id}`, { cookie: b.cookie });
  check(sharedNote.data.folder_name === `Shared folder ${suffix}` && JSON.parse(sharedNote.data.labels).join(',') === 'shared,integration', 'shared account can see note folders and labels');
  const secondNote = await request(base, '/api/notes', { method: 'POST', cookie: b.cookie, body: { title: 'Remote note B', body: 'Visible to both accounts.' } });
  const crossRead = await request(base, `/api/notes/${firstNote.data.id}`, { cookie: b.cookie });
  const visibleToA = await request(base, '/api/notes', { cookie: a.cookie });
  check(secondNote.response.ok && crossRead.data.title === 'Remote note A' && visibleToA.data.some(note => note.title === 'Remote note B'), 'both accounts can read and add shared Supabase notes');
  process.stdout.write(`\n${passed} Supabase integration checks passed. Temporary accounts and workspace edits will be removed.\n`);
}

main()
  .catch(error => {
    process.stderr.write(`${error.stack || error}\n`);
    if (output) process.stderr.write(`\nApp output:\n${output}\n`);
    process.exitCode = 1;
  })
  .finally(() => cleanup().catch(error => {
    process.stderr.write(`Could not clean up temporary integration accounts (${error.code || error.name}).\n`);
    process.exitCode = 1;
  }));
