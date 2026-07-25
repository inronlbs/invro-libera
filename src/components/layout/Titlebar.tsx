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

  const handleMinimize = () => {
    appWindow.minimize().catch(console.error);
  };

  const handleToggleMaximize = async () => {
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

  const handleClose = () => {
    appWindow.close().catch(console.error);
  };

  return (
    <div 
      data-tauri-drag-region 
      className="h-9 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-3 select-none z-[9999] shrink-0 text-slate-300"
    >
      {/* Left: App Brand / Title */}
      <div data-tauri-drag-region className="flex items-center gap-2.5 pointer-events-none">
        <div className="w-5 h-5 rounded-md bg-ocean-500 flex items-center justify-center text-white text-[10px] font-black tracking-tighter">
          IL
        </div>
        <span className="text-xs font-bold text-slate-300 tracking-wide">Invro Libera</span>
        <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.2 rounded-md">
          Standalone
        </span>
      </div>

      {/* Center: Drag Area */}
      <div data-tauri-drag-region className="flex-1 h-full" />

      {/* Right: Window Controls */}
      <div className="flex items-center gap-1 -mr-1">
        <button
          onClick={handleMinimize}
          className="w-8 h-7 flex items-center justify-center rounded-md hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
          title="Minimize"
        >
          <span className="material-symbols-outlined text-[16px]">remove</span>
        </button>
        <button
          onClick={handleToggleMaximize}
          className="w-8 h-7 flex items-center justify-center rounded-md hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
          title={isMaximized ? "Restore" : "Maximize"}
        >
          <span className="material-symbols-outlined text-[14px]">
            {isMaximized ? 'filter_none' : 'crop_square'}
          </span>
        </button>
        <button
          onClick={handleClose}
          className="w-8 h-7 flex items-center justify-center rounded-md hover:bg-red-600 hover:text-white text-slate-400 transition-colors ml-0.5"
          title="Close"
        >
          <span className="material-symbols-outlined text-[16px]">close</span>
        </button>
      </div>
    </div>
  );
}
