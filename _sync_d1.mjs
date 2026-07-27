import { DatabaseSync } from 'node:sqlite';
import { execSync } from 'child_process';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const LOCAL_DB = 'local-server/local.db';
const db = new DatabaseSync(LOCAL_DB);

const tables = process.argv.slice(2).length > 0 ? process.argv.slice(2) :
  db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all().map(r => r.name);

console.log('Tables:', tables.join(', '));

for (const table of tables) {
  const rows = db.prepare(`SELECT * FROM "${table}"`).all();
  if (rows.length === 0) {
    console.log(`  ${table}: empty, skip`);
    continue;
  }
  const cols = Object.keys(rows[0]);
  const colList = cols.map(c => `"${c}"`).join(', ');

  const lines = [`DELETE FROM "${table}";`];
  for (const row of rows) {
    const vals = cols.map(c => {
      const v = row[c];
      if (v === null || v === undefined) return 'NULL';
      if (typeof v === 'number') return String(v);
      return `'${String(v).replace(/'/g, "''")}'`;
    });
    lines.push(`INSERT INTO "${table}" (${colList}) VALUES (${vals.join(', ')});`);
  }

  const tmpFile = join(tmpdir(), `_d1sync_${table}.sql`);

  const CHUNK = 40;
  let ok = true;
  for (let i = 0; i < lines.length && ok; i += CHUNK) {
    const chunk = lines.slice(i, i + CHUNK).join('\n');
    writeFileSync(tmpFile, chunk, 'utf-8');

    try {
      execSync(`npx wrangler d1 execute secretary-db --remote --file="${tmpFile}"`, {
        cwd: 'D:/myproject/darling-dupe-maker',
        stdio: 'pipe',
        encoding: 'utf-8',
        timeout: 60000
      });
    } catch (e) {
      const msg = e.stderr || e.message || '';
      console.log(`    ERR: ${msg.slice(0, 300)}`);
      ok = false;
      break;
    }

    const progress = Math.min(i + CHUNK - 1, rows.length);
    console.log(`    ${progress}/${rows.length}`);
  }

  if (ok) console.log(`  ${table}: OK ${rows.length} rows`);

  if (existsSync(tmpFile)) unlinkSync(tmpFile);
}

db.close();
console.log('Done');
