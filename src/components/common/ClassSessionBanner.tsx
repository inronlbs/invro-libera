import { useState, useEffect } from 'react';
import { discoverTeacherHost, type TeacherHostInfo } from '../../services/telemetryService';
import { getStudentsList, setClientSession, type StudentProfile } from '../../services/localAuth';

export function ClassSessionBanner({ onSessionJoined }: { onSessionJoined?: (student: StudentProfile) => void }) {
  const [hostInfo, setHostInfo] = useState<TeacherHostInfo | null>(null);
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');
  const [isDismissed, setIsDismissed] = useState<boolean>(false);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;

    const checkHost = async () => {
      const info = await discoverTeacherHost();
      if (!cancelled && info.is_active && info.active_class) {
        setHostInfo(info);
        const roster = await getStudentsList();
        if (!cancelled) setStudents(roster);
      } else if (!cancelled) {
        setHostInfo(null);
      }
    };

    checkHost();
    const interval = setInterval(checkHost, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!hostInfo || !hostInfo.is_active || !hostInfo.active_class || isDismissed) {
    return null;
  }

  const handleJoin = () => {
    const student = students.find((s) => s.id === selectedStudentId);
    if (student) {
      setClientSession(student);
      setIsModalOpen(false);
      if (onSessionJoined) onSessionJoined(student);
    }
  };

  return (
    <>
      {/* Top Session Active Banner */}
      <div className="bg-gradient-to-r from-primary-600 to-indigo-600 text-white px-4 py-2 text-sm flex items-center justify-between shadow-md z-40 relative">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
          <span className="font-semibold">
            Class Session Active: {hostInfo.active_class} {hostInfo.active_division ? `- Div ${hostInfo.active_division}` : ''}
          </span>
          <span className="text-primary-100 text-xs hidden md:inline">
            ({hostInfo.school_name || 'Teacher Host'})
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsModalOpen(true)}
            className="px-3 py-1 bg-white text-primary-700 hover:bg-primary-50 rounded-md font-medium text-xs shadow-sm transition-colors"
          >
            Join Session / Select Name
          </button>
          <button
            onClick={() => setIsDismissed(true)}
            className="text-primary-200 hover:text-white text-xs px-2 py-1"
          >
            Dismiss
          </button>
        </div>
      </div>

      {/* Select Student Roll Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in duration-150">
            <h3 className="text-lg font-bold text-slate-800 mb-1">Select Your Name / Roll Number</h3>
            <p className="text-xs text-slate-500 mb-4">
              Class <strong className="text-slate-700">{hostInfo.active_class}</strong> session is active on the teacher host.
            </p>

            {students.length > 0 ? (
              <div className="space-y-3">
                <select
                  value={selectedStudentId}
                  onChange={(e) => setSelectedStudentId(e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-slate-50"
                >
                  <option value="">-- Choose your name --</option>
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      Roll {s.rollNumber} - {s.name}
                    </option>
                  ))}
                </select>

                <div className="flex items-center justify-end gap-2 pt-3">
                  <button
                    onClick={() => setIsModalOpen(false)}
                    className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    disabled={!selectedStudentId}
                    onClick={handleJoin}
                    className="px-4 py-2 rounded-xl text-sm font-medium bg-primary-600 hover:bg-primary-700 text-white disabled:opacity-50 transition-colors shadow-sm"
                  >
                    Pair & Join Class
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center py-6">
                <p className="text-sm text-slate-500 mb-3">No student roster loaded for this class yet.</p>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-medium"
                >
                  Continue Reading Standalone
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
