import "server-only";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { runJobs } from "../jobs";

// The built-in scheduler, started with the server (see startup.ts).
//
// Always: PrintQ's jobs every 5 minutes (hold expiry, reminders, upload
// cleanup, Discord board refresh).
//
// Optional: the site's own scheduled endpoints, which are called by an external
// scheduler today. Set a number of minutes to have this server call them
// instead (and stop the external caller, or they'll run twice):
//   SCHEDULE_EVENT_REMINDERS_MINUTES   GET /api/events/reminders
//   SCHEDULE_UFV_NEWS_MINUTES          GET /api/announcements/ufv-news
//
// Every run takes a Postgres advisory lock, so with several server instances a
// job still runs once at a time.

const log = (message: string) => console.log(`[scheduler] ${message}`);
const globalState = globalThis as unknown as { printqScheduler?: NodeJS.Timeout[] };

async function withLock(name: string, task: () => Promise<unknown>) {
  await db().transaction(async (tx) => {
    const [row] = (await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtext(${`printq:job:${name}`})) AS ok`)) as unknown as { ok: boolean }[];
    if (!row?.ok) return; // another instance is running it
    await task();
  });
}

function every(name: string, minutes: number, task: () => Promise<unknown>) {
  const run = () =>
    withLock(name, task).catch((error) => console.error(`[scheduler] ${name} failed`, error));
  const first = setTimeout(run, 30_000); // let the server finish starting
  const repeat = setInterval(run, minutes * 60_000);
  first.unref();
  repeat.unref();
  globalState.printqScheduler!.push(first, repeat);
  log(`${name}: every ${minutes} min`);
}

/** Calls one of the site's own token-protected endpoints on this server. */
function siteEndpoint(path: string, token: string | undefined) {
  return async () => {
    const response = await fetch(`http://127.0.0.1:${process.env.PORT ?? 3000}${path}`, {
      headers: { authorization: token ?? "" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`${path} answered ${response.status}`);
  };
}

const minutesFrom = (value: string | undefined) => {
  const minutes = Number(value);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
};

export function startScheduler() {
  if (globalState.printqScheduler) return; // already running (dev reloads)
  globalState.printqScheduler = [];
  every("printq-jobs", 5, () => runJobs());

  const optional: [string, string | undefined, string, string | undefined][] = [
    ["event-reminders", process.env.SCHEDULE_EVENT_REMINDERS_MINUTES, "/api/events/reminders", process.env.AUTH_TOKEN_EVENT_REMINDERS],
    ["ufv-news", process.env.SCHEDULE_UFV_NEWS_MINUTES, "/api/announcements/ufv-news", process.env.AUTH_TOKEN_UFV_NEWS],
  ];
  for (const [name, setting, path, token] of optional) {
    const minutes = minutesFrom(setting);
    if (minutes === null) continue;
    if (!token) {
      console.warn(`[scheduler] ${name}: set its AUTH_TOKEN_* to schedule it; skipping`);
      continue;
    }
    every(name, minutes, siteEndpoint(path, token));
  }
}

export function stopScheduler() {
  for (const timer of globalState.printqScheduler ?? []) clearTimeout(timer);
  globalState.printqScheduler = undefined;
}
