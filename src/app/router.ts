export type AppRoute = 'task' | 'history' | 'settings'

export interface AppRouteItem {
  key: AppRoute
  label: string
}

export const APP_ROUTES: AppRouteItem[] = [
  { key: 'task', label: 'Task' },
  { key: 'history', label: 'History' },
  { key: 'settings', label: 'Settings' },
]
