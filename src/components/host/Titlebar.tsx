/**
 * Invro Libera - Custom Window Title Bar
 * Replaces the OS title bar with a branded, draggable bar.
 * Only used in the Tauri (host) environment.
 */

import { Window } from '@tauri-apps/api/window';

export default function Titlebar() {
  const win = Window.getCurrent();

  const handleDrag = async (e: React.MouseEvent) => {
    if (e.buttons === 1) {
      await win.startDragging();
    }
  };

  return (
    <div
      onMouseDown={handleDrag}
      className="h-10 select-none flex justify-between items-center bg-white border-b border-slate-200 shrink-0 w-full z-[100] relative cursor-default"
    >
      {/* Left: App Icon + Title */}
      <div className="pl-4 flex items-center gap-2.5 text-xs font-semibold text-slate-500 tracking-wide pointer-events-none">
        <img src="/favicon.png" alt="Icon" className="w-5 h-5 rounded-sm drop-shadow-sm" />
        <span className="text-slate-600 font-bold">Invro Libera</span>
        <span className="text-[10px] text-slate-400 font-medium tracking-wider uppercase ml-1">Host</span>
      </div>

      {/* Right: Window Controls */}
      <div className="flex h-full" onMouseDown={(e) => e.stopPropagation()}>
        <button
          onClick={async () => await win.minimize()}
          className="px-4 hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors"
          title="Minimize"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect y="5" width="12" height="2" rx="1" fill="currentColor"/></svg>
        </button>
        <button
          onClick={async () => await win.toggleMaximize()}
          className="px-4 hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors"
          title="Maximize"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1" y="1" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.5" fill="none"/></svg>
        </button>
        <button
          onClick={async () => await win.close()}
          className="px-4 hover:bg-red-500 hover:text-white flex items-center justify-center text-slate-400 transition-colors"
          title="Close"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </button>
      </div>
    </div>
  );
}
