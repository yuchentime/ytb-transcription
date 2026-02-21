export type AppRoute = 'task' | 'history' | 'settings' | 'about'

export interface AppRouteItem {
  key: AppRoute
}

export const APP_ROUTES: AppRouteItem[] = [
  { key: 'task' },
  { key: 'history' },
  { key: 'settings' },
  { key: 'about' },
]
