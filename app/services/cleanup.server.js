import { cleanupOldData } from "../db.server";

let lastCleanup = 0;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Run data cleanup if enough time has passed since last run.
 * Call this from a loader or on app startup — it debounces to once per day.
 */
export async function maybeRunCleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;

  lastCleanup = now;
  try {
    const result = await cleanupOldData(90);
    if (result.deletedConversations > 0) {
      console.log(`Cleanup: deleted ${result.deletedConversations} old conversations`);
    }
  } catch (error) {
    console.error('Cleanup error:', error);
  }
}
