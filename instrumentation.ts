// Runs once when the Next.js server starts.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PUBLIC_PRINTQ_ENABLED !== "true") return;
  // PrintQ: bring the database up to date and start its scheduled jobs.
  const { startPrintQ } = await import("./app/printq/setup/startup");
  await startPrintQ();
}
