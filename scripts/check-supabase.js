const fs = require('node:fs');
const path = require('node:path');
const postgres = require('postgres').default;

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && !Object.hasOwn(process.env, match[1])) {
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is missing from .env.');
  process.exitCode = 1;
} else {
  const sql = postgres(process.env.DATABASE_URL, {
    max: 1,
    prepare: false,
    ssl: 'require',
    connect_timeout: 10,
    pipeline: false,
  });
  sql`select 1 as ok`
    .then(async rows => {
      console.log(rows[0]?.ok === 1 ? 'Supabase connection succeeded.' : 'Supabase returned an unexpected response.');
      await sql.end();
      if (rows[0]?.ok !== 1) process.exitCode = 1;
    })
    .catch(async error => {
      console.error(`Supabase connection failed (${error.code || error.name}). The connection string was not printed.`);
      await sql.end({ timeout: 1 });
      process.exitCode = 1;
    });
}
