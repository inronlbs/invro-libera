

export interface StudentProfile {
  id: string;
  classId: string;
  rollNumber: string;
  name: string;
}

export function isTauriEnvironment(): boolean {
  // @ts-expect-error - __TAURI_INTERNALS__ is injected dynamically by the Tauri webview component at runtime
  return typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined;
}

export async function getClientSession(): Promise<StudentProfile | null> {
  // If we're the host running in Tauri, the generic session is null for student views.
  if (isTauriEnvironment()) {
    return null;
  }

  const stored = localStorage.getItem('invron_student_session');
  if (stored) {
    try {
      return JSON.parse(stored) as StudentProfile;
    } catch {
      return null;
    }
  }

  return null;
}

export function setClientSession(student: StudentProfile) {
  localStorage.setItem('invron_student_session', JSON.stringify(student));
}

export function logoutClientSession() {
  localStorage.removeItem('invron_student_session');
}

export async function getStudentsList(): Promise<StudentProfile[]> {
  try {
    const port = window.location.port || '3000';
    const response = await fetch(`http://${window.location.hostname}:${port}/api/students`);
    if (response.ok) {
      return await response.json();
    }
  } catch (error) {
    console.error("Failed to fetch student roster from local host server:", error);
  }
  return [];
}
