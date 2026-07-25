import { useState, useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauriEnvironment } from '../../services/localAuth';

export default function Titlebar() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!isTauriEnvironment()) return;
    const appWindow = getCurrentWindow();

    const checkMaximized = async () => {
      try {
        const max = await appWindow.isMaximized();
        setIsMaximized(max);
      } catch {
        // ignore
      }
    };
    checkMaximized();

    const unlisten = appWindow.onResized(() => {
      checkMaximized();
    });

    return () => {
      unlisten.then(f => f()).catch(() => {});
    };
  }, []);

  if (!isTauriEnvironment()) return null;

  const appWindow = getCurrentWindow();

  const handleMinimize = (e: React.MouseEvent) => {
    e.stopPropagation();
    appWindow.minimize().catch(console.error);
  };

  const handleToggleMaximize = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const max = await appWindow.isMaximized();
      if (max) {
        await appWindow.unmaximize();
        setIsMaximized(false);
      } else {
        await appWindow.maximize();
        setIsMaximized(true);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    appWindow.close().catch(console.error);
  };

  return (
    <div 
      data-tauri-drag-region 
      className="w-full h-9 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-3 select-none fixed top-0 left-0 right-0 z-[10000] text-slate-300"
    >
      {/* Left: App Brand & Title */}
      <div data-tauri-drag-region className="flex items-center gap-2.5 pointer-events-none">
        <div className="w-5 h-5 rounded-md bg-ocean-500 flex items-center justify-center text-white text-[10px] font-black tracking-tighter">
          IL
        </div>
        <span className="text-xs font-bold text-slate-200 tracking-wide">Invro Libera</span>
        <span className="text-[10px] font-extrabold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-md uppercase tracking-wider">
          Standalone
        </span>
      </div>

      {/* Center: Main Drag Area */}
      <div data-tauri-drag-region className="flex-1 h-full cursor-default" />

      {/* Right: Window Controls */}
      <div className="flex items-center gap-1 shrink-0 -mr-1">
        <button
          type="button"
          onClick={handleMinimize}
          className="w-9 h-7 flex items-center justify-center rounded-md hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
          title="Minimize"
        >
          <span className="material-symbols-outlined text-[16px]">remove</span>
        </button>
        <button
          type="button"
          onClick={handleToggleMaximize}
          className="w-9 h-7 flex items-center justify-center rounded-md hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
          title={isMaximized ? "Restore" : "Maximize"}
        >
          <span className="material-symbols-outlined text-[14px]">
            {isMaximized ? 'filter_none' : 'crop_square'}
          </span>
        </button>
        <button
          type="button"
          onClick={handleClose}
          className="w-9 h-7 flex items-center justify-center rounded-md hover:bg-red-600 hover:text-white text-slate-400 transition-colors cursor-pointer ml-0.5"
          title="Close"
        >
          <span className="material-symbols-outlined text-[16px]">close</span>
        </button>
      </div>
    </div>
  );
}
