export type AppRoute = 'task' | 'history' | 'settings'

export interface AppRouteItem {
  key: AppRoute
}

export const APP_ROUTES: AppRouteItem[] = [
  { key: 'task' },
  { key: 'history' },
  { key: 'settings' },
]
