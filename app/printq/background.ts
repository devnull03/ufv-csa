import "server-only";
import { after } from "next/server";

/** Runs work after the response is sent; outside a request (scripts, tests) it just runs it. */
export function inBackground(task: () => Promise<unknown>) {
  try {
    after(task);
  } catch {
    void task().catch((error) => console.error("PrintQ background task failed", error));
  }
}
