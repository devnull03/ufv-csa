// Runs once when the Next.js server starts.
export async function register() {
  // The import sits inside the runtime check so the edge bundle leaves it out.
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PUBLIC_PRINTQ_ENABLED === "true") {
    // PrintQ: bring the database up to date and start its scheduled jobs.
    const { startPrintQ } = await import("./app/printq/setup/startup");
    await startPrintQ();
  }
}
