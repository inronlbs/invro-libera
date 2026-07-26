/**
 * Invro Libera - Custom Window Title Bar
 * Replaces the OS title bar with a branded, draggable bar matching the CS design system.
 * Only used in the Tauri environment.
 */

import { useState, useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauriEnvironment } from '../../services/localAuth';

export default function Titlebar() {
  if (!isTauriEnvironment()) return null;

  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!isTauriEnvironment()) return;
    const win = getCurrentWindow();
    const checkFs = async () => {
      try {
        setIsFullscreen(await win.isFullscreen());
      } catch {}
    };
    checkFs();
    const unlisten = win.onResized(() => { checkFs(); });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  if (isFullscreen) return null;

  const handleDrag = async (e: React.MouseEvent) => {
    if (e.buttons === 1 && isTauriEnvironment()) {
      try {
        await getCurrentWindow().startDragging();
      } catch (err) {
        console.error('Failed to start dragging window:', err);
      }
    }
  };

  const handleMinimize = async () => {
    if (isTauriEnvironment()) {
      try {
        await getCurrentWindow().minimize();
      } catch (err) {
        console.error('Failed to minimize window:', err);
      }
    }
  };

  const handleToggleMaximize = async () => {
    if (isTauriEnvironment()) {
      try {
        await getCurrentWindow().toggleMaximize();
      } catch (err) {
        console.error('Failed to toggle maximize:', err);
      }
    }
  };

  const handleClose = async () => {
    if (isTauriEnvironment()) {
      try {
        await getCurrentWindow().close();
      } catch (err) {
        console.error('Failed to close window:', err);
      }
    }
  };

  return (
    <div
      onMouseDown={handleDrag}
      className="h-10 select-none flex justify-between items-center bg-white border-b border-slate-200 shrink-0 w-full z-[100] relative cursor-default"
    >
      {/* Left: App Icon + Title */}
      <div className="pl-4 flex items-center gap-2.5 text-xs font-semibold text-slate-500 tracking-wide pointer-events-none">
        <img src="/favicon.png" alt="Icon" className="w-5 h-5 rounded-sm drop-shadow-sm" onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }} />
        <span className="text-slate-600 font-bold">Invro Libera</span>
        <span className="text-[10px] text-emerald-600 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ml-1">Standalone</span>
      </div>

      {/* Right: Window Controls */}
      <div className="flex h-full" onMouseDown={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={handleMinimize}
          className="px-4 hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors"
          title="Minimize"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect y="5" width="12" height="2" rx="1" fill="currentColor"/></svg>
        </button>
        <button
          type="button"
          onClick={handleToggleMaximize}
          className="px-4 hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors"
          title="Maximize"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1" y="1" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.5" fill="none"/></svg>
        </button>
        <button
          type="button"
          onClick={handleClose}
          className="px-4 hover:bg-red-500 hover:text-white flex items-center justify-center text-slate-400 transition-colors"
          title="Close"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </button>
      </div>
    </div>
  );
}
