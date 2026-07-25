/**
 * Student Login — Invro Libera
 * Light-mode design matching the old Invro+ login page.
 * Students can only log in once the teacher starts a session for their class.
 */

import { useState, useEffect, useCallback } from 'react';
import { type StudentProfile } from '../services/localAuth';
import { usePwaInstall } from '../hooks/usePwaInstall';

interface StudentLoginProps {
  onLogin: (student: StudentProfile) => void;
}

interface SessionInfo {
  active: boolean;
  class_id: string | null;
}

export default function StudentLogin({ onLogin }: StudentLoginProps) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [rollNumber, setRollNumber] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(false);
  const { isInstallable, isInstalled, promptInstall } = usePwaInstall();

  const host = window.location.hostname;
  const port = window.location.port || '3000';

  // Poll the Host server every 3 seconds to check if the teacher started a session
  const fetchSession = useCallback(async () => {
    try {
      const res = await fetch(`http://${host}:${port}/api/session`);
      if (res.ok) {
        const info: SessionInfo = await res.json();
        setSession(info);

        // When session becomes active, also fetch the student roster
        if (info.active) {
          const studentsRes = await fetch(`http://${host}:${port}/api/students`);
          if (studentsRes.ok) {
            setStudents(await studentsRes.json());
          }
        }
      } else {
        setIsOffline(true);
      }
    } catch {
      // Server not reachable yet — keep polling
      setIsOffline(true);
    } finally {
      setLoading(false);
    }
  }, [host, port]);

  useEffect(() => {
    void fetchSession();
    const interval = setInterval(fetchSession, 3000);
    return () => clearInterval(interval);
  }, [fetchSession]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!rollNumber.trim()) {
      setError('Please enter your roll number.');
      return;
    }

    const student = students.find(
      s => s.classId === session?.class_id && s.rollNumber === rollNumber.trim()
    );

    if (student) {
      onLogin(student);
    } else {
      setError('Invalid Roll Number for this class session.');
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-[#fafbfc]">
        <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-[#1f70af]/20 border-t-[#1f70af]"></div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center bg-[#fafbfc] px-4 overflow-hidden">

      {/* Background Illustrations — scattered book icons */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden select-none" aria-hidden="true">
        <span className="material-symbols-outlined absolute -top-6 -left-8 text-[220px] text-blue-400/[.08] -rotate-12">auto_stories</span>
        <span className="material-symbols-outlined absolute top-24 left-20 text-[80px] text-amber-400/[.10] rotate-6">bookmark</span>
        <span className="material-symbols-outlined absolute top-6 left-60 text-[64px] text-emerald-400/[.08] rotate-12">school</span>
        <span className="material-symbols-outlined absolute -top-4 right-8 text-[140px] text-violet-400/[.08] rotate-12">menu_book</span>
        <span className="material-symbols-outlined absolute top-32 right-4 text-[76px] text-rose-400/[.10] -rotate-6">science</span>
        <span className="material-symbols-outlined absolute bottom-4 -left-6 text-[160px] text-orange-400/[.08] rotate-6">import_contacts</span>
        <span className="material-symbols-outlined absolute bottom-36 left-24 text-[72px] text-yellow-400/[.10] -rotate-12">lightbulb</span>
        <span className="material-symbols-outlined absolute -bottom-8 right-4 text-[180px] text-indigo-400/[.08] -rotate-12">library_books</span>
        <span className="material-symbols-outlined absolute top-1/2 -left-10 text-[120px] text-purple-400/[.08] -translate-y-1/2 rotate-12">history_edu</span>
        <span className="material-symbols-outlined absolute top-1/2 -right-8 text-[110px] text-sky-400/[.08] -translate-y-1/2 -rotate-12">biotech</span>
      </div>

      <div className="relative z-10 w-full max-w-[380px]">

        {/* PWA Install Button */}
        {!isInstalled && isInstallable && (
          <div className="absolute -top-16 right-[-10px] sm:-right-8">
            <button
              onClick={promptInstall}
              className="px-4 py-1.5 bg-white/90 backdrop-blur-sm border border-[#1f70af]/20 shadow-sm text-[#1f70af] text-xs font-bold rounded-full hover:bg-[#1f70af] hover:text-white transition-all flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[16px]">download</span>
              Install App
            </button>
          </div>
        )}

        {/* Logo */}
        <div className="flex justify-center mb-10">
          <img
            src="/assets/logos/logo.png"
            alt="Invro Libera"
            className="h-20 w-auto object-contain"
          />
        </div>

        {/* Session NOT active — Waiting Screen or Offline Screen */}
        {!session?.active ? (
          <div className="text-center">
            {isOffline ? (
              <>
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-50 text-red-500 mb-4">
                  <span className="material-symbols-outlined text-2xl">wifi_off</span>
                </div>
                <h2 className="text-xl font-semibold text-slate-900">
                  Server Offline
                </h2>
                <p className="mt-2 text-slate-500 text-sm leading-relaxed max-w-[300px] mx-auto">
                  Cannot connect to Invro Libera. Please ensure the host server is running on the teacher's PC.
                </p>
                <div className="flex justify-center mt-6">
                  <div className="px-3 py-1 bg-slate-100 rounded-full flex items-center gap-2 text-xs text-slate-500 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-pulse"></span>
                    Retrying connection...
                  </div>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-xl font-semibold text-slate-900">
                  Waiting for Session
                </h2>
                <p className="mt-2 text-slate-400 text-sm leading-relaxed max-w-[300px] mx-auto">
                  Your teacher has not started a class session yet. This page will update automatically.
                </p>
                <div className="flex justify-center gap-1.5 mt-8">
                  <span className="w-2 h-2 rounded-full bg-[#1f70af] animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 rounded-full bg-[#1f70af] animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 rounded-full bg-[#1f70af] animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </>
            )}
          </div>
        ) : (
          /* Session IS active — Login Form */
          <>
            <div className="text-center mb-8">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-100 text-emerald-600 text-xs font-semibold mb-4">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Session Active
              </div>
              <h2 className="text-xl font-semibold text-slate-900">
                Student Login
              </h2>
              <p className="mt-1 text-slate-400 text-sm">
                Class: <strong className="text-slate-600">{session.class_id}</strong>
              </p>
            </div>

            {error && (
              <div className="mb-5 flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg bg-red-50 border border-red-100">
                <span className="material-symbols-outlined text-red-500 text-[18px]">error</span>
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-[13px] font-medium text-slate-600 mb-1" htmlFor="rollNumber">
                  Roll Number
                </label>
                <input
                  id="rollNumber"
                  type="text"
                  required
                  value={rollNumber}
                  onChange={(e) => setRollNumber(e.target.value)}
                  placeholder="e.g. 15"
                  className="w-full h-10 px-3 rounded-md border border-slate-200 bg-white text-slate-900 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1f70af]/15 focus:border-[#1f70af] transition-all"
                />
              </div>

              <button
                type="submit"
                className="w-full h-10 rounded-md bg-[#1f70af] hover:bg-[#1a6193] text-white text-sm font-medium transition-all active:scale-[0.98] flex items-center justify-center gap-2"
              >
                Enter Library
              </button>
            </form>
          </>
        )}

        {/* Footer */}
        <div className="mt-10 flex justify-center gap-3 text-[11px] text-slate-300">
          <span>Invro Libera</span>
          <span>·</span>
          <span>© 2026 Invron Labs</span>
        </div>
      </div>
    </div>
  );
}
