import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { syncOnLaunch } from './catalogSync';

export interface TelemetryPayload {
  device_name: string;
  student_id?: string;
  student_name?: string;
  class_division?: string;
  current_book_id: string;
  current_book_title: string;
  current_page: number;
  total_pages?: number;
  reading_time_seconds: number;
  timestamp: string;
}

export interface TeacherHostInfo {
  is_active: boolean;
  host_ip?: string;
  host_port: number;
  active_class?: string;
  active_division?: string;
  school_name?: string;
}

let pingInterval: ReturnType<typeof setInterval> | null = null;
let activeReadingTimeSeconds = 0;

/**
 * Discover if a Teacher Host is active on local LAN
 */
export async function discoverTeacherHost(): Promise<TeacherHostInfo> {
  try {
    return await invoke<TeacherHostInfo>('discover_teacher_host');
  } catch (err) {
    console.warn('[Telemetry] Teacher host discovery error:', err);
    return { is_active: false, host_port: 3000 };
  }
}

/**
 * Start sending 5-second telemetry pings while a student is actively reading a book
 */
export function startTelemetryPing(
  bookId: string,
  bookTitle: string,
  getCurrentPage: () => number,
  getTotalPages: () => number | undefined,
  studentInfo?: { id: string; name: string; classId: string },
  onForceLogout?: () => void
) {
  stopTelemetryPing();
  activeReadingTimeSeconds = 0;

  pingInterval = setInterval(async () => {
    activeReadingTimeSeconds += 5;

    const payload: TelemetryPayload = {
      device_name: window.location.hostname || 'Lab-PC',
      student_id: studentInfo?.id,
      student_name: studentInfo?.name,
      class_division: studentInfo?.classId,
      current_book_id: bookId,
      current_book_title: bookTitle,
      current_page: getCurrentPage(),
      total_pages: getTotalPages(),
      reading_time_seconds: activeReadingTimeSeconds,
      timestamp: new Date().toISOString()
    };

    try {
      await invoke('send_telemetry_ping', { payload });
    } catch (err) {
      if (err === 'FORCE_LOGOUT') {
        console.warn('[Telemetry] Force logout received from Teacher Host');
        stopTelemetryPing();
        if (onForceLogout) onForceLogout();
      }
    }
  }, 5000);
}

/**
 * Stop active telemetry pings
 */
export function stopTelemetryPing() {
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
}

/**
 * Listen for remote book download triggers sent by Teacher Host
 */
export function listenForRemoteDownloadTriggers(onDownloadTriggered?: () => void) {
  listen<string | null>('remote_download_requested', async (event) => {
    console.log('[Telemetry] Remote download triggered by teacher:', event.payload);
    try {
      await syncOnLaunch();
      if (onDownloadTriggered) onDownloadTriggered();
    } catch (err) {
      console.error('[Telemetry] Error executing remote download trigger:', err);
    }
  });
}
