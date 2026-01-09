import React, { createContext, useContext, useState, ReactNode } from 'react';

type Route = string;

interface RouterContextValue {
  currentRoute: Route;
  navigate: (route: Route) => void;
}

const RouterContext = createContext<RouterContextValue | undefined>(undefined);

export function Router({ children }: { children: ReactNode }) {
  const [currentRoute, setCurrentRoute] = useState<Route>('/');

  const navigate = (route: Route) => {
    setCurrentRoute(route);
  };

  return (
    <RouterContext.Provider value={{ currentRoute, navigate }}>
      {children}
    </RouterContext.Provider>
  );
}

export function useRouter() {
  const context = useContext(RouterContext);
  if (!context) {
    throw new Error('useRouter must be used within a Router');
  }
  return context;
}

interface RouteProps {
  path: string;
  children: ReactNode;
}

export function Route({ path, children }: RouteProps) {
  const { currentRoute } = useRouter();
  return currentRoute === path ? <>{children}</> : null;
}
