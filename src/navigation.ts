export type NavPage = 'home' | 'library' | 'favorites' | 'settings';

export const pathToNavPage: Record<string, NavPage> = {
  '/': 'home',
  '/home': 'home',
  '/library': 'library',
  '/favorites': 'favorites',
  '/settings': 'settings',
};

export const navPageToPath: Record<NavPage, string> = {
  home: '/',
  library: '/library',
  favorites: '/favorites',
  settings: '/settings',
};