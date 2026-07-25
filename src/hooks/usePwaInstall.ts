import { useState, useEffect, useCallback } from 'react';

// Extend the Window interface to include the BeforeInstallPromptEvent
interface BeforeInstallPromptEvent extends Event {
    readonly platforms: string[];
    readonly userChoice: Promise<{
        outcome: 'accepted' | 'dismissed';
        platform: string;
    }>;
    prompt(): Promise<void>;
}

declare global {
    interface WindowEventMap {
        beforeinstallprompt: BeforeInstallPromptEvent;
    }
}

// Global state to catch the event before React even mounts
let globalDeferredPrompt: BeforeInstallPromptEvent | null = null;
let globalIsInstallable = false;

if (typeof window !== 'undefined') {
    window.addEventListener('beforeinstallprompt', (e: Event) => {
        e.preventDefault();
        globalDeferredPrompt = e as BeforeInstallPromptEvent;
        globalIsInstallable = true;

        // Let any active hooks know
        window.dispatchEvent(new Event('pwa-ready'));
    });
}

export function usePwaInstall() {
    const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(globalDeferredPrompt);
    const [isInstallable, setIsInstallable] = useState(globalIsInstallable);
    const [isInstalled, setIsInstalled] = useState(() => {
        if (typeof window === 'undefined') return false;
        const nav = navigator as Navigator & { standalone?: boolean };
        return window.matchMedia('(display-mode: standalone)').matches || Boolean(nav.standalone);
    });

    useEffect(() => {
        const handleReady = () => {
            setDeferredPrompt(globalDeferredPrompt);
            setIsInstallable(globalIsInstallable);
        };

        const handleAppInstalled = () => {
            setIsInstallable(false);
            setIsInstalled(true);
            setDeferredPrompt(null);
            globalDeferredPrompt = null;
            globalIsInstallable = false;
            console.log('[PWA] App was installed correctly.');
        };

        window.addEventListener('pwa-ready', handleReady);
        window.addEventListener('appinstalled', handleAppInstalled);

        // If the event fired before this effect ran, sync up
        if (globalIsInstallable) {
            handleReady();
            window.dispatchEvent(new Event('pwa-ready'));
        }

        return () => {
            window.removeEventListener('pwa-ready', handleReady);
            window.removeEventListener('appinstalled', handleAppInstalled);
        };
    }, []);

    const promptInstall = useCallback(async () => {
        if (!deferredPrompt) {
            console.warn('[PWA] No deferred prompt available. The browser may not support programmatic installation or the app is already installed.');
            return;
        }

        // Show the install prompt
        await deferredPrompt.prompt();

        // Wait for the user to respond to the prompt
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`[PWA] User ${outcome} the installation prompt.`);

        // We've used the prompt, and can't use it again, discard it
        setDeferredPrompt(null);
        setIsInstallable(false);
    }, [deferredPrompt]);

    return {
        isInstallable,
        isInstalled,
        promptInstall
    };
}
