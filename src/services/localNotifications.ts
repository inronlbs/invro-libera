interface ReaderNotificationOptions {
  body: string;
  tag?: string;
  requireInteraction?: boolean;
}

const NOTIFICATION_ICON = '/assets/logos/logo.png';

export function supportsLocalNotifications(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export async function requestLocalNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!supportsLocalNotifications()) {
    return 'unsupported';
  }

  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission;
  }

  return Notification.requestPermission();
}

export function sendLocalNotification(title: string, options: ReaderNotificationOptions): void {
  if (!supportsLocalNotifications() || Notification.permission !== 'granted') {
    return;
  }

  const notification = new Notification(title, {
    body: options.body,
    tag: options.tag,
    requireInteraction: options.requireInteraction,
    icon: NOTIFICATION_ICON,
  });

  window.setTimeout(() => {
    notification.close();
  }, options.requireInteraction ? 12000 : 5000);
}