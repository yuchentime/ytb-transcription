import { APP_ROUTES, type AppRoute } from '../app/router'
import type { TranslateFn } from '../app/i18n'
import { translateRouteLabel } from '../app/i18n'

interface SidebarMenuProps {
  activeRoute: AppRoute
  t: TranslateFn
  onRouteChange(route: AppRoute): void
}

export function SidebarMenu(props: SidebarMenuProps) {
  return (
    <aside className="sidebar">
      <nav className="sidebar-nav" aria-label={props.t('menu.ariaMainNavigation')}>
        {APP_ROUTES.map((route) => (
          <button
            key={route.key}
            className={`sidebar-tab ${props.activeRoute === route.key ? 'active' : ''}`}
            onClick={() => props.onRouteChange(route.key)}
          >
            {translateRouteLabel(route.key, props.t)}
          </button>
        ))}
      </nav>
    </aside>
  )
}
