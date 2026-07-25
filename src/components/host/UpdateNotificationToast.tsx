import { useEffect, useState } from 'react';
import { type SyncSummary } from '../../services/githubPackSync';

interface UpdateNotificationToastProps {
  summary: SyncSummary | null;
  onDismiss: () => void;
}

export default function UpdateNotificationToast({ summary, onDismiss }: UpdateNotificationToastProps) {
  const [isVisible, setIsVisible] = useState(false);

  const [prevSummary, setPrevSummary] = useState(summary);
  if (prevSummary !== summary) {
    setPrevSummary(summary);
    if (!summary) setIsVisible(false);
  }

  useEffect(() => {
    if (!summary) return;
    const showTimer = setTimeout(() => setIsVisible(true), 0);
    const dismissTimer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(onDismiss, 300); // Wait for transition
    }, 8000); // 8 seconds
    return () => {
      clearTimeout(showTimer);
      clearTimeout(dismissTimer);
    };
  }, [summary, onDismiss]);

  if (!summary) return null;

  return (
    <div 
      className={`fixed bottom-6 right-6 z-50 transition-all duration-300 transform ${
        isVisible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0 pointer-events-none'
      }`}
    >
      <div className="bg-white border border-emerald-200 rounded-xl shadow-lg p-4 flex items-start gap-4 min-w-[320px]">
        <div className="bg-emerald-100 p-2 rounded-lg text-emerald-600 shrink-0 flex items-center justify-center">
          <span className="material-symbols-outlined select-none text-2xl">new_releases</span>
        </div>
        
        <div className="flex-1 pr-6">
          <h4 className="text-sm font-bold text-slate-800">Library Updated</h4>
          <p className="text-sm text-slate-600 mt-1 leading-snug">
            {summary.added > 0 && <span className="font-semibold text-emerald-600">{summary.added} new books added. </span>}
            {summary.updated > 0 && <span className="font-semibold text-blue-600">{summary.updated} books updated. </span>}
            {summary.added === 0 && summary.updated === 0 && "No new changes found."}
          </p>
        </div>

        <button 
          onClick={() => {
            setIsVisible(false);
            setTimeout(onDismiss, 300);
          }}
          className="absolute top-3 right-3 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg p-1 transition-colors flex items-center justify-center"
        >
          <span className="material-symbols-outlined select-none text-[18px]">close</span>
        </button>
      </div>
    </div>
  );
}
