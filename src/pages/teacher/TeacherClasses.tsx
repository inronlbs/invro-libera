import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { StudentProfile } from '../../services/localAuth';

interface Division {
  name: string;
  studentCount: number;
}

interface DivisionCreation {
  name: string;
  startRoll: number;
  endRoll: number;
}

interface ClassInfo {
  id: string;
  grade: string;
  divisions: Division[];
}

const GRADE_OPTIONS = ['LKG', 'UKG', ...Array.from({ length: 12 }, (_, i) => String(i + 1))];

export default function TeacherClasses() {
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditClassModal, setShowEditClassModal] = useState<ClassInfo | null>(null);
  const [showAddDivModal, setShowAddDivModal] = useState<ClassInfo | null>(null);
  const [showAddStudentModal, setShowAddStudentModal] = useState<{classInfo: ClassInfo, divName: string} | null>(null);
  const [showGenBlockModal, setShowGenBlockModal] = useState<{classInfo: ClassInfo, divName: string} | null>(null);

  // Form states
  const [newGrade, setNewGrade] = useState('');
  const [newDivisions, setNewDivisions] = useState<DivisionCreation[]>([{ name: 'A', startRoll: 1, endRoll: 30 }]);
  const [editGrade, setEditGrade] = useState('');
  
  const [newDivName, setNewDivName] = useState('');
  const [newDivStart, setNewDivStart] = useState(1);
  const [newDivEnd, setNewDivEnd] = useState(30);
  
  const [newStudentName, setNewStudentName] = useState('');
  const [newStudentRoll, setNewStudentRoll] = useState('');

  const [genBlockStart, setGenBlockStart] = useState(31);
  const [genBlockEnd, setGenBlockEnd] = useState(60);

  // Selected views
  const [selectedClass, setSelectedClass] = useState<ClassInfo | null>(null);
  const [selectedDivision, setSelectedDivision] = useState<string | null>(null);
  const [selectedStudent, setSelectedStudent] = useState<StudentProfile | null>(null);

  // Edit student modal
  const [editingStudent, setEditingStudent] = useState<StudentProfile | null>(null);
  const [editForm, setEditForm] = useState({ name: '' });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [loadedClasses, loadedStudents] = await Promise.all([
        invoke<ClassInfo[]>('get_classes'),
        invoke<StudentProfile[]>('get_students'),
      ]);
      setClasses(loadedClasses);
      setStudents(loadedStudents);
      
      // Update selected references safely without creating an effect loop
      setSelectedClass(prev => {
        if (!prev) return null;
        const updated = loadedClasses.find(c => c.id === prev.id);
        if (!updated) {
          setSelectedDivision(null);
          return null;
        }
        return updated;
      });
    } catch (e) {
      console.error("Failed to load data", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // --- CRUD Handlers ---

  const handleCreateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGrade) return;

    try {
      await invoke('create_class', { 
        grade: newGrade,
        divisions: newDivisions.filter(d => d.name.trim() !== '')
      });
      await loadData();
      setShowCreateModal(false);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      alert(`Failed to create class: ${msg}`);
    }
  };

  const handleRenameClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showEditClassModal || !editGrade) return;
    try {
      await invoke('rename_class', { classId: showEditClassModal.id, newGrade: editGrade });
      await loadData();
      setShowEditClassModal(null);
    } catch (err) {
      console.error(err);
      alert("Failed to rename class.");
    }
  };

  const handleDeleteClass = async (classId: string) => {
    if (!window.confirm("Delete this class and all its students? This will also disconnect them immediately if active.")) return;
    try {
      await invoke('delete_class', { classId });
      await loadData();
      setSelectedClass(null);
      setSelectedDivision(null);
    } catch (err) {
      console.error(err);
      alert("Failed to delete class.");
    }
  };

  const handleAddDivision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showAddDivModal || !newDivName) return;
    try {
      await invoke('add_class_division', { 
        classId: showAddDivModal.id, 
        divisionName: newDivName,
        startRoll: newDivStart,
        endRoll: newDivEnd
      });
      await loadData();
      setShowAddDivModal(null);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      alert(`Failed to add division: ${msg}`);
    }
  };

  const handleDeleteDivision = async (classId: string, divName: string) => {
    if (!window.confirm(`Delete division ${divName} and all its students?`)) return;
    try {
      await invoke('delete_class_division', { classId, divisionName: divName });
      await loadData();
      if (selectedDivision === divName) {
        setSelectedDivision(null);
        setSelectedStudent(null);
      }
    } catch (err) {
      console.error(err);
      alert("Failed to delete division.");
    }
  };

  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showAddStudentModal || !newStudentName || !newStudentRoll) return;
    try {
      await invoke('add_student', { 
        classId: showAddStudentModal.classInfo.id,
        divisionName: showAddStudentModal.divName,
        name: newStudentName,
        rollNumber: newStudentRoll
      });
      await loadData();
      setShowAddStudentModal(null);
    } catch (err) {
      console.error(err);
      alert("Failed to add student.");
    }
  };

  const handleGenerateBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showGenBlockModal) return;
    try {
      await invoke('generate_students_block', {
          classId: showGenBlockModal.classInfo.id,
          divisionName: showGenBlockModal.divName,
          startRoll: genBlockStart,
          endRoll: genBlockEnd
      });
      await loadData();
      setShowGenBlockModal(null);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      alert(`Failed to generate block: ${msg}`);
    }
  };

  const handleSaveStudentName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStudent) return;
    const updated: StudentProfile = { ...editingStudent, name: editForm.name };
    try {
      await invoke('update_student', { student: updated });
      await loadData();
      setEditingStudent(null);
      if (selectedStudent?.id === editingStudent.id) setSelectedStudent(updated);
    } catch (err) {
      console.error(err);
      alert("Failed to update student.");
    }
  };

  const handleDeleteStudent = async (studentId: string) => {
    if (!window.confirm("Are you sure you want to permanently delete this student?")) return;
    try {
      await invoke('delete_student', { studentId });
      await loadData();
      setEditingStudent(null);
      if (selectedStudent?.id === studentId) setSelectedStudent(null);
    } catch (err) {
      console.error(err);
      alert("Failed to delete student.");
    }
  };

  // --- Utility ---

  const addDivisionRow = () => {
    const nextLetter = String.fromCharCode(65 + newDivisions.length);
    setNewDivisions(prev => [...prev, { name: nextLetter, startRoll: 1, endRoll: 30 }]);
  };

  const removeDivisionRow = (idx: number) => {
    setNewDivisions(prev => prev.filter((_, i) => i !== idx));
  };

  const getStudentsForDivision = (classInfo: ClassInfo, divName: string) => {
    const classId = `${classInfo.grade} ${divName}`;
    return students.filter(s => s.classId === classId);
  };

  const getTotalStudentsForClass = (classInfo: ClassInfo) => {
    return classInfo.divisions.reduce((sum, d) => sum + getStudentsForDivision(classInfo, d.name).length, 0);
  };

  if (loading) return <div className="p-8 text-center text-slate-500">Loading classes...</div>;

  const renderClassDetail = () => {
    const divStudents = selectedDivision 
      ? getStudentsForDivision(selectedClass!, selectedDivision) 
      : [];

    return (
      <div className="max-w-7xl mx-auto mb-16">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm mb-6">
          <button onClick={() => { setSelectedClass(null); setSelectedDivision(null); setSelectedStudent(null); }} className="text-primary hover:underline font-medium">
            All Classes
          </button>
          <span className="text-slate-400">›</span>
          <span className="font-semibold text-slate-800">Class {selectedClass!.grade}</span>
          {selectedDivision && (
            <>
              <span className="text-slate-400">›</span>
              <span className="font-semibold text-slate-800">Division {selectedDivision}</span>
            </>
          )}
        </div>

        {/* Student detail panel */}
        {selectedStudent && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center">
                  <span className="material-symbols-outlined text-primary text-[24px]">person</span>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-800">{selectedStudent.name}</h3>
                  <p className="text-sm text-slate-500">Roll #{String(selectedStudent.rollNumber)} • {selectedStudent.classId}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setEditingStudent(selectedStudent); setEditForm({ name: selectedStudent.name }); }}
                  className="px-3 py-1.5 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-lg text-sm font-medium transition-colors"
                >
                  Edit Student
                </button>
                <button onClick={() => setSelectedStudent(null)} className="p-1.5 text-slate-400 hover:text-slate-600">
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-4">
              <div className="bg-slate-50 rounded-lg p-3 text-center">
                <div className="text-lg font-bold text-slate-800">0</div>
                <div className="text-xs text-slate-500">Books Read</div>
              </div>
              <div className="bg-slate-50 rounded-lg p-3 text-center">
                <div className="text-lg font-bold text-slate-800">0h</div>
                <div className="text-xs text-slate-500">Reading Time</div>
              </div>
              <div className="bg-slate-50 rounded-lg p-3 text-center">
                <div className="text-lg font-bold text-slate-800">—</div>
                <div className="text-xs text-slate-500">Last Active</div>
              </div>
            </div>
          </div>
        )}

        {/* Division selector if no division selected */}
        {!selectedDivision ? (
          <div>
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-3">
                <button onClick={() => { setSelectedClass(null); setSelectedDivision(null); setSelectedStudent(null); }} className="p-1 text-slate-400 hover:text-slate-600 transition-colors">
                  <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                </button>
                <h2 className="text-lg font-bold text-slate-800">Select Division</h2>
              </div>
              <button 
                onClick={() => { setShowAddDivModal(selectedClass); setNewDivName(''); setNewDivStart(1); setNewDivEnd(30); }}
                className="px-3 py-1.5 bg-primary/10 text-primary hover:bg-primary/20 rounded-lg font-medium shadow-sm transition-colors flex items-center gap-1 text-sm"
              >
                <span className="material-symbols-outlined text-[16px]">add</span>
                Add Division
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {selectedClass!.divisions.map(div => {
                const count = getStudentsForDivision(selectedClass!, div.name).length;
                return (
                  <div
                    key={div.name}
                    className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden hover:border-primary/40 hover:shadow-md transition-all group flex flex-col"
                  >
                    <button
                      onClick={() => setSelectedDivision(div.name)}
                      className="p-6 text-left flex-1"
                    >
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 bg-amber-50 rounded-lg flex items-center justify-center group-hover:bg-primary/10 transition-colors">
                          <span className="material-symbols-outlined text-amber-600 group-hover:text-primary text-[20px] transition-colors">groups</span>
                        </div>
                        <h3 className="text-lg font-bold text-slate-800">Div {div.name}</h3>
                      </div>
                      <p className="text-sm text-slate-500">{count} students</p>
                    </button>
                    <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 flex justify-end">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteDivision(selectedClass!.id, div.name); }}
                        className="text-slate-400 hover:text-red-500 transition-colors p-1"
                        title="Delete Division"
                      >
                        <span className="material-symbols-outlined text-[16px]">delete</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* Student list for selected division */
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row justify-between items-center gap-4">
              <div className="flex items-center gap-3">
                <button onClick={() => { setSelectedDivision(null); setSelectedStudent(null); }} className="p-1 text-slate-400 hover:text-slate-600">
                  <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                </button>
                <h2 className="text-lg font-bold text-slate-800">
                  Class {selectedClass!.grade} — Division {selectedDivision}
                </h2>
              </div>
              <div className="flex items-center gap-3 flex-wrap justify-end">
                <span className="text-sm font-medium text-slate-500 bg-slate-200 px-3 py-1.5 rounded-full">
                  {divStudents.length} Students
                </span>
                <button 
                  onClick={() => { setShowGenBlockModal({classInfo: selectedClass!, divName: selectedDivision}); setGenBlockStart(divStudents.length + 1); setGenBlockEnd(divStudents.length + 30); }}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-medium shadow-sm transition-colors flex items-center gap-1 text-sm"
                >
                  <span className="material-symbols-outlined text-[16px]">group_add</span>
                  Generate Block
                </button>
                <button 
                  onClick={() => { setShowAddStudentModal({classInfo: selectedClass!, divName: selectedDivision}); setNewStudentName(''); setNewStudentRoll(''); }}
                  className="px-3 py-1.5 bg-primary hover:bg-primary/90 text-white rounded-lg font-medium shadow-sm transition-colors flex items-center gap-1 text-sm"
                >
                  <span className="material-symbols-outlined text-[16px]">person_add</span>
                  Add Student
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3 p-6">
              {divStudents.map(stu => (
                <button
                  key={String(stu.id)}
                  onClick={() => setSelectedStudent(stu)}
                  className={`p-4 rounded-xl border text-left transition-all hover:shadow-md ${
                    selectedStudent?.id === stu.id 
                      ? 'border-primary bg-primary/5 shadow-sm' 
                      : 'border-slate-200 bg-white hover:border-primary/30'
                  }`}
                >
                  <div className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center mb-2">
                    <span className="material-symbols-outlined text-slate-500 text-[16px]">person</span>
                  </div>
                  <div className="font-semibold text-sm text-slate-800 truncate">{stu.name}</div>
                  <div className="text-xs text-slate-500 mt-0.5">Roll #{String(stu.rollNumber)}</div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderGrid = () => (
    <div className="max-w-7xl mx-auto mb-16">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Classes & Students</h1>
        <div className="flex gap-3">
          <button
            onClick={() => { setShowCreateModal(true); setNewGrade(''); setNewDivisions([{ name: 'A', startRoll: 1, endRoll: 30 }]); }}
            className="px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg font-medium shadow-sm transition-colors flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            Create Class
          </button>
        </div>
      </div>

      {classes.length === 0 ? (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-12 text-center">
          <span className="material-symbols-outlined text-[48px] text-slate-300 mb-4 block">school</span>
          <p className="text-slate-500">No classes created yet. Click "Create Class" to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {classes.map(cls => {
            const totalStudents = getTotalStudentsForClass(cls);
            return (
              <div
                key={cls.id}
                className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden hover:shadow-md hover:border-primary/30 transition-all cursor-pointer group flex flex-col"
                onClick={() => setSelectedClass(cls)}
              >
                <div className="p-5 flex-1">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                      <span className="material-symbols-outlined text-primary text-[24px]">school</span>
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-800">Class {cls.grade}</h3>
                      <p className="text-xs text-slate-500">{cls.divisions.length} division{cls.divisions.length !== 1 ? 's' : ''}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
                    <span className="text-sm text-slate-500">{totalStudents} students</span>
                    <div className="flex gap-1 flex-wrap justify-end max-w-[50%]">
                      {cls.divisions.map(d => (
                        <span key={d.name} className="text-[10px] font-bold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{d.name}</span>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="px-5 py-2.5 bg-slate-50 border-t border-slate-100 flex justify-end gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowEditClassModal(cls); setEditGrade(cls.grade); }}
                    className="text-slate-400 hover:text-primary transition-colors p-1"
                    title="Edit Grade"
                  >
                    <span className="material-symbols-outlined text-[16px]">edit</span>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteClass(cls.id); }}
                    className="text-slate-400 hover:text-red-500 transition-colors p-1"
                    title="Delete Class"
                  >
                    <span className="material-symbols-outlined text-[16px]">delete</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <>
      {selectedClass ? renderClassDetail() : renderGrid()}

      {/* Modals Follow... */}

      {/* Create Class Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 animate-in fade-in zoom-in-95 duration-200">
            <h2 className="text-xl font-bold text-slate-800 mb-6">Create New Class</h2>
            <form onSubmit={handleCreateClass} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Select Grade</label>
                <div className="grid grid-cols-7 gap-2">
                  {GRADE_OPTIONS.map(grade => (
                    <button
                      key={grade}
                      type="button"
                      onClick={() => setNewGrade(grade)}
                      className={`py-2 px-1 rounded-lg text-sm font-semibold border transition-all ${
                        newGrade === grade
                          ? 'bg-primary text-white border-primary shadow-sm'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-primary/40'
                      }`}
                    >
                      {grade}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-slate-700">Divisions</label>
                  <button type="button" onClick={addDivisionRow} className="text-xs text-primary hover:text-primary/80 font-semibold flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">add</span> Add Division
                  </button>
                </div>
                <div className="space-y-3 max-h-[30vh] overflow-y-auto pr-2">
                  {newDivisions.map((div, idx) => (
                    <div key={idx} className="flex flex-col sm:flex-row items-center gap-3 bg-slate-50 p-3 rounded-lg border border-slate-100">
                      <input
                        type="text"
                        value={div.name}
                        onChange={(e) => setNewDivisions(prev => prev.map((d, i) => i === idx ? { ...d, name: e.target.value.toUpperCase() } : d))}
                        placeholder="Div"
                        className="w-full sm:w-20 border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary font-bold text-center uppercase"
                        maxLength={5}
                      />
                      <div className="flex items-center gap-2 w-full">
                        <span className="text-xs text-slate-500 font-semibold whitespace-nowrap">Rolls:</span>
                        <input
                          type="number" min={1} max={999}
                          value={div.startRoll}
                          onChange={(e) => setNewDivisions(prev => prev.map((d, i) => i === idx ? { ...d, startRoll: parseInt(e.target.value) || 1 } : d))}
                          className="w-full sm:w-16 border border-slate-300 rounded-lg px-2 py-2 text-sm outline-none focus:border-primary text-center"
                          title="Start Roll Number"
                          placeholder="From"
                        />
                        <span className="text-xs text-slate-400 font-semibold px-1">to</span>
                        <input
                          type="number" min={1} max={999}
                          value={div.endRoll}
                          onChange={(e) => setNewDivisions(prev => prev.map((d, i) => i === idx ? { ...d, endRoll: parseInt(e.target.value) || 1 } : d))}
                          className="w-full sm:w-16 border border-slate-300 rounded-lg px-2 py-2 text-sm outline-none focus:border-primary text-center"
                          title="End Roll Number"
                          placeholder="To"
                        />
                      </div>
                      {newDivisions.length > 1 && (
                        <button type="button" onClick={() => removeDivisionRow(idx)} className="p-2 text-slate-400 hover:text-red-500 rounded-full hover:bg-slate-200">
                          <span className="material-symbols-outlined text-[18px]">close</span>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button type="button" onClick={() => setShowCreateModal(false)} className="px-5 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition-colors">Cancel</button>
                <button type="submit" disabled={!newGrade} className="px-5 py-2 bg-primary text-white hover:bg-primary/90 rounded-lg font-medium transition-colors disabled:opacity-50">Save Class</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Class Modal */}
      {showEditClassModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 animate-in fade-in zoom-in-95 duration-200">
            <h2 className="text-lg font-bold text-slate-800 mb-4">Rename Class Grade</h2>
            <form onSubmit={handleRenameClass} className="space-y-4">
              <label className="block text-sm font-medium text-slate-700 mb-2">New Grade</label>
              <div className="grid grid-cols-4 gap-2 max-h-[40vh] overflow-y-auto p-1">
                {GRADE_OPTIONS.map(grade => (
                  <button
                    key={grade}
                    type="button"
                    onClick={() => setEditGrade(grade)}
                    className={`py-2 px-1 rounded-lg text-sm font-semibold border transition-all ${
                      editGrade === grade
                        ? 'bg-primary text-white border-primary shadow-sm'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-primary/40'
                    }`}
                  >
                    {grade}
                  </button>
                ))}
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button type="button" onClick={() => setShowEditClassModal(null)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition-colors">Cancel</button>
                <button type="submit" disabled={!editGrade || editGrade === showEditClassModal.grade} className="px-4 py-2 bg-primary text-white hover:bg-primary/90 rounded-lg font-medium transition-colors disabled:opacity-50">Rename</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Division Modal */}
      {showAddDivModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 animate-in fade-in zoom-in-95 duration-200">
            <h2 className="text-lg font-bold text-slate-800 mb-4">Add Division to {showAddDivModal.grade}</h2>
            <form onSubmit={handleAddDivision} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Division Name</label>
                <input
                  required
                  type="text"
                  maxLength={5}
                  value={newDivName}
                  onChange={(e) => setNewDivName(e.target.value.toUpperCase())}
                  className="w-full border border-slate-300 rounded-lg px-4 py-2 outline-none focus:border-primary uppercase font-bold"
                  placeholder="e.g. C"
                />
              </div>
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Start Roll</label>
                  <input
                    required
                    type="number"
                    min={1}
                    value={newDivStart}
                    onChange={(e) => setNewDivStart(parseInt(e.target.value) || 1)}
                    className="w-full border border-slate-300 rounded-lg px-4 py-2 outline-none focus:border-primary text-center"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium text-slate-700 mb-1">End Roll</label>
                  <input
                    required
                    type="number"
                    min={1}
                    value={newDivEnd}
                    onChange={(e) => setNewDivEnd(parseInt(e.target.value) || 1)}
                    className="w-full border border-slate-300 rounded-lg px-4 py-2 outline-none focus:border-primary text-center"
                  />
                </div>
              </div>
              <p className="text-xs text-slate-500">
                 This will generate <span className="font-bold text-slate-700">{Math.max(0, newDivEnd - newDivStart + 1)}</span> students automatically.
              </p>
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button type="button" onClick={() => setShowAddDivModal(null)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition-colors">Cancel</button>
                <button type="submit" disabled={newDivEnd < newDivStart} className="px-4 py-2 bg-primary text-white hover:bg-primary/90 rounded-lg font-medium transition-colors disabled:opacity-50">Add Division</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Generate Block Modal */}
      {showGenBlockModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-slate-100 text-slate-700 flex items-center justify-center rounded-full">
                <span className="material-symbols-outlined text-[20px]">group_add</span>
              </div>
              <h2 className="text-lg font-bold text-slate-800">Generate Student Block</h2>
            </div>
            <p className="text-sm text-slate-600 mb-6">
              Append a new sequence of roll numbers to <span className="font-bold">{showGenBlockModal.classInfo.grade} {showGenBlockModal.divName}</span>.
            </p>
            <form onSubmit={handleGenerateBlock} className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Start Roll</label>
                  <input
                    required
                    type="number"
                    min={1}
                    value={genBlockStart}
                    onChange={(e) => setGenBlockStart(parseInt(e.target.value) || 1)}
                    className="w-full border border-slate-300 rounded-lg px-4 py-2 outline-none focus:border-primary text-center"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium text-slate-700 mb-1">End Roll</label>
                  <input
                    required
                    type="number"
                    min={1}
                    value={genBlockEnd}
                    onChange={(e) => setGenBlockEnd(parseInt(e.target.value) || 1)}
                    className="w-full border border-slate-300 rounded-lg px-4 py-2 outline-none focus:border-primary text-center"
                  />
                </div>
              </div>
              <p className="text-xs text-slate-500">
                 Adding <span className="font-bold text-slate-700">{Math.max(0, genBlockEnd - genBlockStart + 1)}</span> students to the roster. If any roll numbers already exist in this division, the operation will be denied to prevent duplicates.
              </p>
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button type="button" onClick={() => setShowGenBlockModal(null)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition-colors">Cancel</button>
                <button type="submit" disabled={genBlockEnd < genBlockStart} className="px-4 py-2 bg-slate-800 text-white hover:bg-slate-700 rounded-lg font-bold transition-colors disabled:opacity-50 shadow-sm">Generate</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Student Modal */}
      {showAddStudentModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 animate-in fade-in zoom-in-95 duration-200">
            <h2 className="text-lg font-bold text-slate-800 mb-4">Add Single Student ({showAddStudentModal.classInfo.grade} {showAddStudentModal.divName})</h2>
            <form onSubmit={handleAddStudent} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
                <input
                  required
                  type="text"
                  value={newStudentName}
                  onChange={(e) => setNewStudentName(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-4 py-2 outline-none focus:border-primary"
                  placeholder="Student Name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Roll Number / Registration</label>
                <input
                  required
                  type="number"
                  min={1}
                  value={newStudentRoll}
                  onChange={(e) => setNewStudentRoll(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-4 py-2 outline-none focus:border-primary"
                  placeholder="Numeric Roll Number (e.g. 15)"
                />
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button type="button" onClick={() => setShowAddStudentModal(null)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition-colors">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-primary text-white hover:bg-primary/90 rounded-lg font-medium transition-colors">Add</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Student Settings Modal */}
      {editingStudent && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex flex-col items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 animate-in fade-in zoom-in-95 duration-200 mb-4">
            <h2 className="text-lg font-bold text-slate-800 mb-4">Edit Student Profile</h2>
            <form onSubmit={handleSaveStudentName} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
                <input
                  required
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ name: e.target.value })}
                  className="w-full border border-slate-300 rounded-lg px-4 py-2 outline-none focus:border-primary"
                  placeholder="Full name"
                />
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button type="button" onClick={() => setEditingStudent(null)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition-colors">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-primary text-white hover:bg-primary/90 rounded-lg font-medium transition-colors">Save Name</button>
              </div>
            </form>
          </div>
          
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-5 border-2 border-red-100 animate-in fade-in slide-in-from-bottom-4 duration-300">
            <h3 className="text-red-600 font-bold mb-2 flex items-center gap-2">
              <span className="material-symbols-outlined text-[20px]">warning</span> Danger Zone
            </h3>
            <p className="text-sm text-slate-600 mb-4">Permanently delete this student. Their local data cache on their browser cannot be accessed remotely if removed from the host.</p>
            <button 
                onClick={() => handleDeleteStudent(editingStudent.id)}
                className="w-full px-4 py-2.5 bg-red-50 hover:bg-red-600 text-red-600 hover:text-white rounded-lg font-bold transition-colors shadow-sm"
              >
                Delete Student
            </button>
          </div>
        </div>
      )}
    </>
  );
}
