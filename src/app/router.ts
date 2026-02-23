export type AppRoute = 'task' | 'queue' | 'history' | 'settings' | 'about'

export interface AppRouteItem {
  key: AppRoute
}

export const APP_ROUTES: AppRouteItem[] = [
  { key: 'task' },
  { key: 'queue' },
  { key: 'history' },
  { key: 'settings' },
  { key: 'about' },
]
