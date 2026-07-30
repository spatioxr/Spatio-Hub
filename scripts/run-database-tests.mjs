import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import process from 'node:process';

const verificationFiles = [
  'supabase/verify/phase1_schema.sql',
  'supabase/verify/hrms_004_role_access.sql',
  'supabase/verify/hrms_010_work_sessions.sql',
  'supabase/verify/hrms_011_work_breaks.sql',
  'supabase/verify/hrms_012_daily_reports.sql',
  'supabase/verify/hrms_013_work_entry_audit.sql',
  'supabase/verify/hrms_016_work_switching.sql',
  'supabase/verify/hrms_018_daily_report_workflow.sql',
  'supabase/verify/hrms_021_personal_timesheet.sql',
  'supabase/verify/hrms_022_scoped_timesheets.sql',
  'supabase/verify/hrms_026_project_administration.sql',
  'supabase/verify/hrms_028_activity_administration.sql',
  'supabase/verify/hrms_032_timezone_duration.sql',
  'supabase/verify/hrms_033_leave_balances.sql',
  'supabase/verify/hrms_034_leave_workflow.sql',
  'supabase/verify/hrms_041_role_launch_smoke.sql',
  'supabase/verify/hrms_044_people_directory.sql',
  'supabase/verify/hrms_045_admin_settings.sql',
];

const psqlArguments = [
  '-X',
  '--set',
  'ON_ERROR_STOP=1',
  '--tuples-only',
  '--no-align',
  '--quiet',
];

const databaseEnvironment = () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return null;

  const parsed = new URL(databaseUrl);
  return {
    ...process.env,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || '5432',
    PGDATABASE: parsed.pathname.slice(1) || 'postgres',
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGSSLMODE: parsed.searchParams.get('sslmode') || process.env.PGSSLMODE,
  };
};

const commandFor = (sql) => {
  const env = databaseEnvironment();
  if (env) {
    return {
      command: 'psql',
      args: psqlArguments,
      env,
      input: sql,
    };
  }

  return {
    command: 'docker',
    args: [
      'exec',
      '-i',
      'supabase_db_spatio-people',
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      ...psqlArguments,
    ],
    env: process.env,
    input: sql,
  };
};

const runVerification = async (file) => {
  const sql = await readFile(file, 'utf8');
  const { command, args, env, input } = commandFor(sql);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      reject(new Error(
        `${command} is unavailable. Install PostgreSQL client tools or start the local Supabase stack with Docker. ${error.message}`,
      ));
    });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${file} failed:\n${stderr || stdout}`));
        return;
      }

      const resultLine = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .findLast((line) => /^(t|true|f|false)\|\{/i.test(line));

      if (!/^(t|true)(\||$)/i.test(resultLine || '')) {
        reject(new Error(`${file} did not report all_checks_pass=true:\n${stdout}`));
        return;
      }

      resolve(resultLine);
    });

    child.stdin.end(input);
  });
};

let failed = false;

for (const file of verificationFiles) {
  try {
    await runVerification(file);
    console.log(`PASS ${file}`);
  } catch (error) {
    failed = true;
    if (process.env.GITHUB_ACTIONS) {
      const annotation = error.message
        .replaceAll('%', '%25')
        .replaceAll('\r', '%0D')
        .replaceAll('\n', '%0A');
      console.error(`::error file=${file},title=Database verification failed::${annotation}`);
    }
    console.error(`FAIL ${file}`);
    console.error(error.message);
    break;
  }
}

if (failed) process.exitCode = 1;
