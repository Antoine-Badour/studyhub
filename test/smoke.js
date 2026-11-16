const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'studyspace-smoke-'));
const dataDir = path.join(temp, 'data');
const uploadDir = path.join(temp, 'uploads');
const setupToken = 'smoke-test-setup-token-2026';
let child;
let output = '';
let passed = 0;

function check(condition, message) {
  assert.ok(condition, message);
  passed++;
  process.stdout.write(`✓ ${message}\n`);
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function startServer() {
  const port = await freePort();
  child = spawn(process.execPath, [path.join(root, 'server.js')], {
    cwd: root,
    env: { ...process.env, PORT: String(port), NODE_ENV: 'production', STUDYSPACE_SETUP_TOKEN: setupToken, STUDYSPACE_DATA_DIR: dataDir, STUDYSPACE_UPLOAD_DIR: uploadDir, STUDYSPACE_FORCE_SQLITE: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) throw new Error(`Server exited during startup:\n${output}`);
    try {
      const response = await fetch(`${base}/api/auth/me`);
      if (response.ok) return base;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start:\n${output}`);
}

async function stopServer() {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill();
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3000))]);
}

async function request(base, route, { method = 'GET', body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${base}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();
  return { response, data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

async function register(base, email, password, extra = {}) {
  return request(base, '/api/auth/register', { method: 'POST', body: { email, password, ...extra } });
}

async function main() {
  let base = await startServer();
  check((await request(base, '/')).response.status === 200, 'serves the app shell');
  check((await request(base, '/app.js')).data.includes("$('#sidebar').addEventListener('click'"), 'Settings navigation is delegated from the full sidebar');
  check((await request(base, '/app.js')).data.includes("['dino','Dino Discovery'"), 'Dino Discovery theme is registered');
  check((await request(base, '/dino-background.svg')).response.status === 200, 'serves the dinosaur theme artwork');
  const organizerScript = await request(base, '/shared-notes.js');
  check(organizerScript.response.ok && organizerScript.data.includes('generateFromSavedNotes') && organizerScript.data.includes('A whole chapter folder') && organizerScript.data.includes('Notes with a label'), 'serves saved-note quiz and flashcard source selection');
  const rendererScript = await request(base, '/notes-renderer.js');
  const rendererContext = { esc: value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]) };
  vm.runInNewContext(rendererScript.data, rendererContext);
  const chart = rendererContext.renderStudyNotes('## Trend\n```study-diagram\n{"kind":"graph","title":"Source values","x_label":"Time","y_label":"Rate","points":[{"x":0,"y":1},{"x":2,"y":4,"label":"Peak </text><script>"}]}\n```');
  check(rendererScript.response.ok && chart.includes('<svg') && chart.includes('class="graph-line"') && chart.includes('&lt;script&gt;') && !chart.includes('<script>'), 'renders source-based graphs safely in study notes');

  const unauthorized = await request(base, '/api/notes');
  check(unauthorized.response.status === 401, 'blocks private API requests without a session');
  const badSetup = await register(base, 'owner@example.test', 'correct-horse-smoke', { setupToken: 'wrong-token' });
  check(badSetup.response.status === 403, 'rejects an incorrect production setup token');

  const owner = await register(base, 'owner@example.test', 'correct-horse-smoke', { setupToken });
  check(owner.response.status === 201 && !!owner.cookie, 'creates the first owner account');
  check(/HttpOnly/i.test(owner.response.headers.get('set-cookie') || '') && /Secure/i.test(owner.response.headers.get('set-cookie') || ''), 'sets an HttpOnly, Secure production session cookie');
  const ownerCookie = owner.cookie;
  const ownerStatus = await request(base, '/api/status', { cookie: ownerCookie });
  check(ownerStatus.data.account.email === 'owner@example.test', 'returns the signed-in account status');
  const settingsWrite = await request(base, '/api/settings', { method: 'PUT', cookie: ownerCookie, body: { language: 'English', explanation: 'simple' } });
  const settingsRead = await request(base, '/api/settings', { cookie: ownerCookie });
  check(settingsWrite.response.ok && settingsRead.data.language === 'English', `reads and saves account settings (${JSON.stringify({ write: settingsWrite.data, read: settingsRead.data })})`);

  const ownerNote = await request(base, '/api/notes', { method: 'POST', cookie: ownerCookie, body: { title: 'Owner private note', body: 'Owner only' } });
  check(ownerNote.response.ok, 'saves notes to the shared study space');
  const folder = await request(base, '/api/note-folders', { method: 'POST', cookie: ownerCookie, body: { name: 'Biology review' } });
  const organized = await request(base, `/api/notes/${ownerNote.data.id}`, { method: 'PATCH', cookie: ownerCookie, body: { folder_id: folder.data.id, labels: ['biology', 'exam'] } });
  check(folder.response.status === 201 && organized.response.ok, 'creates note folders and saves labels');
  const chapterNotes = await request(base, `/api/notes?folder_id=${folder.data.id}`, { cookie: ownerCookie });
  check(chapterNotes.response.ok && chapterNotes.data.length === 1 && JSON.parse(chapterNotes.data[0].labels).includes('biology'), 'loads all notes from a chapter folder with their labels');
  const second = await register(base, 'partner@example.test', 'partner-password-2026');
  check(second.response.status === 201 && !!second.cookie, 'allows self-registration without an invite');
  const partnerCookie = second.cookie;
  const partnerNotes = await request(base, '/api/notes', { cookie: partnerCookie });
  const sharedSettings = await request(base, '/api/settings', { cookie: partnerCookie });
  const sharedOrganized = await request(base, `/api/notes/${ownerNote.data.id}`, { cookie: partnerCookie });
  check(partnerNotes.response.ok && partnerNotes.data.length === 1 && partnerNotes.data[0].title === 'Owner private note' && sharedSettings.data.language === 'English', 'both accounts see the same study data and preferences');
  check(sharedOrganized.data.folder_name === 'Biology review' && JSON.parse(sharedOrganized.data.labels).join(',') === 'biology,exam', 'folders and labels are shared across accounts');
  const renamedFolder = await request(base, `/api/note-folders/${folder.data.id}`, { method: 'PATCH', cookie: partnerCookie, body: { name: 'Biology final review' } });
  check(renamedFolder.response.ok && (await request(base, `/api/notes/${ownerNote.data.id}`, { cookie: ownerCookie })).data.folder_name === 'Biology final review', 'folder changes appear in both accounts');
  const partnerNote = await request(base, '/api/notes', { method: 'POST', cookie: partnerCookie, body: { title: 'Partner shared note', body: 'Visible to both accounts' } });
  const partnerRead = await request(base, `/api/notes/${ownerNote.data.id}`, { cookie: partnerCookie });
  const ownerRead = await request(base, `/api/notes/${partnerNote.data.id}`, { cookie: ownerCookie });
  check(partnerNote.response.ok && partnerRead.data.title === 'Owner private note' && ownerRead.data.title === 'Partner shared note', 'both accounts can read and add notes in the shared library');

  const wrongPassword = await request(base, '/api/account/password', { method: 'POST', cookie: ownerCookie, body: { currentPassword: 'wrong-password', newPassword: 'new-owner-password-2026' } });
  check(wrongPassword.response.status === 401, 'rejects a wrong current password');
  const changedPassword = await request(base, '/api/account/password', { method: 'POST', cookie: ownerCookie, body: { currentPassword: 'correct-horse-smoke', newPassword: 'new-owner-password-2026' } });
  const oldLogin = await request(base, '/api/auth/login', { method: 'POST', body: { email: 'owner@example.test', password: 'correct-horse-smoke' } });
  const newLogin = await request(base, '/api/auth/login', { method: 'POST', body: { email: 'owner@example.test', password: 'new-owner-password-2026' } });
  check(changedPassword.response.ok && oldLogin.response.status === 401 && newLogin.response.status === 200, 'changes the password and invalidates the old credential');

  await stopServer();
  base = await startServer();
  const ownerAfterRestart = await request(base, '/api/notes', { cookie: ownerCookie });
  const partnerAfterRestart = await request(base, '/api/notes', { cookie: partnerCookie });
  check(ownerAfterRestart.response.ok && ownerAfterRestart.data.some(n=>n.title==='Owner private note') && ownerAfterRestart.data.some(n=>n.title==='Partner shared note') && partnerAfterRestart.data.length===ownerAfterRestart.data.length, 'persists one shared workspace across accounts and restarts');
  const logout = await request(base, '/api/auth/logout', { method: 'POST', cookie: ownerCookie, body: {} });
  const afterLogout = await request(base, '/api/auth/me', { cookie: ownerCookie });
  check(logout.response.ok && afterLogout.data.authenticated === false, 'logs out and revokes the current session');

  await stopServer();
  process.stdout.write(`\n${passed} smoke checks passed.\n`);
}

main().catch(async error => {
  process.stderr.write(`${error.stack || error}\n`);
  if (output) process.stderr.write(`\nServer output:\n${output}\n`);
  await stopServer();
  process.exitCode = 1;
}).finally(() => {
  try { fs.rmSync(temp, { recursive: true, force: true }); } catch {}
});
