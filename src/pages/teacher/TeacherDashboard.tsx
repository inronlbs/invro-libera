import { useState, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getSettings } from '../../db';
import type { StudentProfile } from '../../services/localAuth';
import type { Book } from '../../db';

interface LiveStudent {
  student_id: string;
  book_id: string | null;
  last_seen: number;
}

export default function TeacherDashboard() {
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeClass, setActiveClass] = useState<string | null>(null);
  const [liveStudents, setLiveStudents] = useState<LiveStudent[]>([]);
  const [schoolName, setSchoolName] = useState('');
  const [labName, setLabName] = useState('');
  const [localIp, setLocalIp] = useState('127.0.0.1');
  const [deviceId, setDeviceId] = useState('');
  const [showClassModal, setShowClassModal] = useState(false);

  const loadState = async () => {
    try {
      const [loadedStudents, loadedBooks, session, name, ip] = await Promise.all([
        invoke<StudentProfile[]>('get_students'),
        invoke<Book[]>('get_book_catalog'),
        invoke<string | null>('get_active_session'),
        invoke<string>('get_school_name'),
        invoke<string>('get_local_ip').catch(() => '127.0.0.1'),
      ]);
      setStudents(loadedStudents);
      setBooks(loadedBooks);
      setActiveClass(session);
      setLocalIp(ip);
      
      const dbSettings = await getSettings();
      if (dbSettings.licenseSchool) {
        setSchoolName(dbSettings.licenseSchool);
        setLabName(dbSettings.licenseLab || '');
        setDeviceId(dbSettings.licenseDeviceId || '');
      } else {
        setSchoolName(name);
        setLabName('');
        setDeviceId('');
      }

      if (session) {
        const live: LiveStudent[] = await invoke('get_active_students');
        setLiveStudents(live);
      } else {
        setLiveStudents([]);
      }
    } catch (error) {
      console.error("Failed to load state:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadState();
    const interval = setInterval(() => {
        void loadState();
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleEndSession = async () => {
    try {
      await invoke('end_session');
      await invoke('stop_session');
      setActiveClass(null);
      setLiveStudents([]);
    } catch (error) {
      console.error("Failed to end session:", error);
    }
  };

  const handleKickStudent = async (studentId: string) => {
    try {
      await invoke('kick_student', { studentId });
      await loadState();
    } catch (error) {
      console.error("Failed to kick student:", error);
    }
  };

  const uniqueClasses = Array.from(new Set(students.map(s => String(s.classId || '')))).filter(Boolean).sort();
  const activeStudents = activeClass ? students.filter(s => s.classId === activeClass) : [];

  const classGroups = useMemo(() => {
    const groups: Record<string, string[]> = {};
    uniqueClasses.forEach(cls => {
      if (!cls || cls === 'undefined' || cls === 'null') return;
      const parts = cls.split(' ');
      const grade = parts[0] || 'General';
      const div = parts.slice(1).join(' ') || 'Main';
      if (!groups[grade]) groups[grade] = [];
      groups[grade].push(div);
    });
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
  }, [uniqueClasses]);

  if (loading) return <div className="p-8 text-center text-slate-500">Loading dashboard...</div>;

  return (
    <div className="max-w-4xl mx-auto">
      {/* School Name Header */}
      <div className="relative flex items-center gap-3 mb-6 bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
        <div className="w-12 h-12 bg-primary/10 text-primary flex items-center justify-center rounded-xl">
          <span className="material-symbols-outlined text-[28px]">apartment</span>
        </div>
        <div>
          <h1 className="text-xl font-black text-slate-800">
            {schoolName || 'School Name Not Set'}
          </h1>
          {labName && (
            <p className="text-sm text-slate-500 font-medium mt-0.5 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]">computer</span>
              {labName}
            </p>
          )}
        </div>
        
        {deviceId && (
          <div className="absolute bottom-3 right-4 text-[10px] uppercase font-bold tracking-widest text-slate-300">
            ID: {deviceId}
          </div>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
              <span className="material-symbols-outlined text-blue-600 text-[20px]">group</span>
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-800">{students.length}</div>
              <div className="text-xs text-slate-500">Total Students</div>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-50 rounded-lg flex items-center justify-center">
              <span className="material-symbols-outlined text-amber-600 text-[20px]">school</span>
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-800">{uniqueClasses.length}</div>
              <div className="text-xs text-slate-500">Classes</div>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 ${activeClass ? 'bg-emerald-50' : 'bg-slate-50'} rounded-lg flex items-center justify-center`}>
              <span className={`material-symbols-outlined ${activeClass ? 'text-emerald-600' : 'text-slate-400'} text-[20px]`}>
                {activeClass ? 'wifi' : 'wifi_off'}
              </span>
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-800">{activeClass ? 'Active' : 'Idle'}</div>
              <div className="text-xs text-slate-500">Session Status</div>
            </div>
          </div>
        </div>
      </div>

      {/* Session Controller */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-8">
        <h2 className="text-lg font-semibold mb-4 text-slate-800">Session Controller</h2>
        
        {activeClass ? (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <h3 className="text-emerald-800 font-bold">Session Active — {activeClass}</h3>
                </div>
                <p className="text-emerald-600 text-sm">
                  {activeStudents.length} students can now log in from their browsers.
                </p>
                <p className="text-emerald-500 text-xs mt-1">
                  Students connect via: <strong className="bg-white/50 px-2 py-0.5 rounded ml-1 tracking-wide">http://{localIp}:3000</strong>
                </p>
              </div>
              <button 
                onClick={handleEndSession}
                className="px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium shadow-sm transition-colors"
              >
                End Session
              </button>
            </div>
            
            {/* Student list for active session */}
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {activeStudents.map(student => {
                  const live = liveStudents.find(s => s.student_id === student.id);
                  const isOnline = !!live;
                  return (
                    <div key={String(student.id)} className={`bg-white p-4 rounded-xl border shadow-sm flex flex-col justify-between ${isOnline ? 'border-emerald-300 ring-1 ring-emerald-50' : 'border-slate-200 opacity-60'}`}>
                      <div>
                          <div className="flex justify-between items-start mb-2">
                              <div>
                                  <div className="font-bold text-sm text-slate-800">{student.name}</div>
                                  <div className="text-xs text-slate-500">Roll #{String(student.rollNumber)}</div>
                              </div>
                              <div className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${isOnline ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                                  {isOnline ? 'ONLINE' : 'OFFLINE'}
                              </div>
                          </div>
                          
                          {isOnline && (
                              <div className="text-xs text-slate-600 bg-slate-50 p-2 rounded-lg border border-slate-100 mt-2 line-clamp-2">
                                  {live.book_id ? (() => {
                                      const title = books.find(b => b.id === live.book_id)?.title || live.book_id;
                                      return <>Reading: <span className="font-semibold text-primary">{title}</span></>
                                  })() : (
                                      <>Browsing the library...</>
                                  )}
                              </div>
                          )}
                      </div>
                      
                      {isOnline && (
                          <button 
                              onClick={() => handleKickStudent(student.id)}
                              className="mt-3 w-full py-1.5 text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition"
                          >
                              Force Logout
                          </button>
                      )}
                    </div>
                  );
              })}
            </div>
          </div>
        ) : (
          <div className="text-center py-8">
            <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-5 border border-slate-100">
              <span className="material-symbols-outlined text-[40px] text-slate-300">view_module</span>
            </div>
            <h3 className="text-xl font-bold text-slate-800 mb-2">No Active Session</h3>
            <p className="text-sm text-slate-500 mb-8 max-w-sm mx-auto">
              Start a new session to allow students from a specific class division to log in and access the library.
            </p>
            <button 
              onClick={() => setShowClassModal(true)}
              className="px-8 py-3.5 bg-primary hover:bg-primary/90 text-white rounded-xl font-bold shadow-lg shadow-primary/20 transition-all flex items-center gap-3 mx-auto"
            >
              <span className="material-symbols-outlined text-[24px]">play_arrow</span>
              Select Class Session
            </button>
          </div>
        )}
      </div>

      {/* Start Session Modal Grid */}
      {showClassModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4 lg:p-8 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-center bg-white">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                  <span className="material-symbols-outlined text-[28px]">cast</span>
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-800 tracking-tight">Broadcast Session</h2>
                  <p className="text-xs text-slate-500 font-medium tracking-wide">Select a division to activate student logins</p>
                </div>
              </div>
              <button onClick={() => setShowClassModal(false)} className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-50 hover:bg-slate-200 text-slate-500 transition-colors">
                <span className="material-symbols-outlined text-[24px]">close</span>
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto bg-slate-50/50 flex-1">
              {uniqueClasses.length === 0 ? (
                 <div className="text-center py-16 bg-white border border-slate-200 border-dashed rounded-2xl">
                   <span className="material-symbols-outlined text-[48px] text-slate-300 mb-4 block">warning</span>
                   <p className="text-slate-500 font-medium">No classes found in the system.</p>
                   <p className="text-xs text-slate-400 mt-1">Import a roster or create classes first from the Classes tab.</p>
                 </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {classGroups.map(([grade, divs]) => (
                    <div key={grade} className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
                      <div className="flex items-center gap-3 mb-4 border-b border-slate-100 pb-3">
                        <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center">
                          <span className="text-lg font-black text-slate-700">{grade}</span>
                        </div>
                        <h3 className="text-base font-bold text-slate-800">Class {grade}</h3>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-3">
                        {divs.map(div => {
                          const fullClassId = `${grade} ${div}`;
                          const stuCount = students.filter(s => s.classId === fullClassId).length;
                          return (
                            <button
                              key={div}
                              onClick={async () => {
                                setShowClassModal(false);
                                try {
                                  await invoke('start_session', { classId: fullClassId });
                                  setActiveClass(fullClassId);
                                } catch (error) {
                                  console.error("Failed to start session:", error);
                                }
                              }}
                              className="group p-3 border-2 border-slate-100 rounded-xl text-left hover:border-primary/50 hover:bg-primary/5 transition-all outline-none"
                            >
                              <div className="font-bold text-sm text-slate-700 group-hover:text-primary transition-colors">Div {div}</div>
                              <div className="text-[11px] font-semibold text-slate-400 mt-0.5">{stuCount} Students</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
