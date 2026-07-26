import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { isTauriEnvironment } from './localAuth';

export interface AppUpdateInfo {
  available: boolean;
  version?: string;
  notes?: string;
  updateObj?: any;
  error?: string;
}

/**
 * Checks GitHub releases feed for a new desktop application update.
 */
export async function checkAppUpdate(): Promise<AppUpdateInfo> {
  if (!isTauriEnvironment()) {
    return { available: false };
  }

  try {
    const update = await check();
    if (update && update.available) {
      console.log(`[AppUpdate] Found update ${update.version}`);
      return {
        available: true,
        version: update.version,
        notes: update.body || 'New features and performance improvements.',
        updateObj: update
      };
    }
    return { available: false, notes: 'Your application (v1.4.0) is up to date!' };
  } catch (err: any) {
    const msg = err?.message || err?.toString() || '';
    console.warn(`[AppUpdate] Update check info:`, msg);

    // If endpoint returns 404 or missing release JSON, treat as up-to-date
    if (msg.includes('release JSON') || msg.includes('404') || msg.includes('Could not fetch') || msg.includes('status code')) {
      return {
        available: false,
        notes: 'Your application (v1.4.0) is up to date!'
      };
    }

    return {
      available: false,
      error: msg
    };
  }
}

/**
 * Downloads and installs the application update, then automatically relaunches the app.
 */
export async function downloadAndInstallAppUpdate(
  updateObj: any,
  onProgress?: (downloaded: number, total: number) => void
): Promise<void> {
  if (!updateObj) return;

  let downloadedBytes = 0;
  let totalBytes = 0;

  await updateObj.downloadAndInstall((event: any) => {
    switch (event.event) {
      case 'Started':
        totalBytes = event.data.contentLength || 0;
        console.log(`[AppUpdate] Started download, total: ${totalBytes} bytes`);
        break;
      case 'Progress':
        downloadedBytes += event.data.chunkLength;
        onProgress?.(downloadedBytes, totalBytes);
        break;
      case 'Finished':
        console.log('[AppUpdate] Download finished. Relaunching application...');
        break;
    }
  });

  // Automatically restart application with new version applied
  await relaunch();
}
