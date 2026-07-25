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
    return { available: false };
  } catch (err: any) {
    console.warn(`[AppUpdate] Update check failed:`, err);
    return {
      available: false,
      error: err?.message || err?.toString() || 'Could not check for application updates.'
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
