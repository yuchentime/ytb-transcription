import { APP_ROUTES, type AppRoute } from '../app/router'

interface SidebarMenuProps {
  activeRoute: AppRoute
  onRouteChange(route: AppRoute): void
}

export function SidebarMenu(props: SidebarMenuProps) {
  return (
    <aside className="sidebar">
      <h2 className="sidebar-title">Menu</h2>
      <nav className="sidebar-nav" aria-label="Main navigation">
        {APP_ROUTES.map((route) => (
          <button
            key={route.key}
            className={`sidebar-tab ${props.activeRoute === route.key ? 'active' : ''}`}
            onClick={() => props.onRouteChange(route.key)}
          >
            {route.label}
          </button>
        ))}
      </nav>
    </aside>
  )
}
