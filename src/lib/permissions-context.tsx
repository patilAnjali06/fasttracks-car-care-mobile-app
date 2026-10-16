import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { fetchMyPermissions, getErrorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { ResolvedPermissions } from '@/types/api';

// See MOBILE_PERMISSIONS_PATTERN.md for the full design rationale. Summary:
// this is the ONE place that resolves per-tab access for every screen driven
// by the backend's getTabAccess/mergePermissions system (backend/src/lib/
// defaultPermissions.ts) — it fetches the already-resolved shape from
// GET /auth/me and never re-derives role defaults or reads a stored override
// itself. A screen must never hardcode a role array to approximate this.
//
// FAILS CLOSED: 'error' status (or 'idle'/'loading') makes every hasTab/
// tabMode call return false/null. There is no fallback to a permissive
// default and no fallback to a hardcoded role list — an employee whose
// permissions fail to load sees no gated features, not all of them.
type PermissionsStatus = 'idle' | 'loading' | 'ready' | 'error';

interface PermissionsContextValue {
  status: PermissionsStatus;
  error: string | null;
  /** True only when status === 'ready' and the resolved tab is enabled. */
  hasTab: (tabKey: string) => boolean;
  /** The resolved mode for a mode-tab, or null when not ready/not a mode-tab. */
  tabMode: (tabKey: string) => string | null;
  /** The real, per-userId legal-access check (backend/src/middleware/auth.ts
   *  hasLegalAccess) — NOT the decorative 'legal' tabRegistry entry. */
  hasLegalAccess: boolean;
  refresh: () => Promise<void>;
}

const PermissionsContext = createContext<PermissionsContextValue | null>(null);

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [status, setStatus] = useState<PermissionsStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<ResolvedPermissions | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const permissions = await fetchMyPermissions();
      setResolved(permissions);
      setStatus('ready');
    } catch (err: any) {
      // Fail closed: drop any previously-resolved permissions rather than
      // leaving a stale (possibly now-wrong) grant in place, and never
      // substitute a permissive default.
      setResolved(null);
      setStatus('error');
      setError(getErrorMessage(err, 'Could not load your permissions.'));
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on sign-out, not a render loop
      setResolved(null);
      setError(null);
      setStatus('idle');
      return;
    }
    load();
  }, [isAuthenticated, load]);

  const value = useMemo<PermissionsContextValue>(
    () => ({
      status,
      error,
      hasLegalAccess: status === 'ready' && resolved?.hasLegalAccess === true,
      hasTab: (tabKey: string) => status === 'ready' && resolved?.tabs?.[tabKey] === true,
      tabMode: (tabKey: string) => (status === 'ready' ? (resolved?.tabModes?.[tabKey] ?? null) : null),
      refresh: load,
    }),
    [status, error, resolved, load],
  );

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}

export function usePermissions() {
  const ctx = useContext(PermissionsContext);
  if (!ctx) throw new Error('usePermissions must be used within a PermissionsProvider');
  return ctx;
}
