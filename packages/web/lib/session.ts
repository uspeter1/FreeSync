'use client';

import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

// State machine:
//   loading: haven't checked yet — render nothing
//   session: signed in — session object present
//   null:    signed out — session absent (guard should redirect)
export type SessionState = { loading: true } | { loading: false; session: Session | null };

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ loading: true });

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setState({ loading: false, session: data.session });
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_evt, session) => {
      if (!cancelled) setState({ loading: false, session });
    });
    return () => { cancelled = true; subscription.unsubscribe(); };
  }, []);

  return state;
}

// Client-side guard. Wrap the body of any authed page like:
//   const session = useRequireSession();
//   if (!session) return null;
// Returns null while loading OR while redirecting; the page should render
// nothing in that case. When it returns a Session, safe to proceed.
export function useRequireSession(): Session | null {
  const state = useSession();
  useEffect(() => {
    if (!state.loading && !state.session) {
      const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/auth/signin?returnTo=${returnTo}`;
    }
  }, [state]);
  if (state.loading) return null;
  return state.session;
}
