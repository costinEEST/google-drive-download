import { stat, utimes } from "node:fs/promises";

export async function fileExists(filePath, modified, overwrite = false) {
  if (overwrite) return false;

  try {
    const stats = await stat(filePath);
    if (modified) {
      return Math.floor(stats.mtime.getTime() / 1000) === modified;
    }
    return true;
  } catch {
    return false;
  }
}

export async function setModifiedTime(filePath, timestamp) {
  if (!timestamp) return;

  try {
    const date = new Date(timestamp * 1000);
    await utimes(filePath, date, date);
  } catch (error) {
    // Silently fail
  }
}
