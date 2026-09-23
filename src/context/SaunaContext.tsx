import React, { createContext, useContext } from 'react';
import { useSaunaSession, type SaunaSession } from '../hooks/useSaunaSession';

export type { Stage } from '../hooks/useSaunaSession';

const SaunaContext = createContext<SaunaSession | undefined>(undefined);

export const useSaunaContext = () => {
  const context = useContext(SaunaContext);
  if (context === undefined) {
    throw new Error('useSaunaContext must be used within a SaunaProvider');
  }
  return context;
};

export function SaunaProvider({ children }: { children: React.ReactNode }) {
  const session = useSaunaSession();
  return <SaunaContext.Provider value={session}>{children}</SaunaContext.Provider>;
}
