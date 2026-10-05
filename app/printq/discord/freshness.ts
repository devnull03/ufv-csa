/** Discord's x-signature-timestamp is Unix seconds; accept five minutes either way so captured requests can't be replayed later. */
export function isFreshTimestamp(timestamp: string, now = Date.now(), toleranceSeconds = 300) {
  const seconds = Number(timestamp);
  return timestamp.trim() !== "" && Number.isFinite(seconds) && Math.abs(now / 1000 - seconds) <= toleranceSeconds;
}
