import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { TRPCClientError } from "@trpc/client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath } = options ?? {};
  const utils = trpc.useUtils();
  const [sessionReady, setSessionReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setHasSession(Boolean(data.session));
      setSessionReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setHasSession(Boolean(session));
      setSessionReady(true);
      void utils.auth.me.invalidate();
    });
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, [utils]);

  const meQuery = trpc.auth.me.useQuery(undefined, {
    enabled: sessionReady && hasSession,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => utils.auth.me.setData(undefined, null),
  });

  const logout = useCallback(async () => {
    try {
      await supabase.auth.signOut();
      if (hasSession) await logoutMutation.mutateAsync();
    } catch (error: unknown) {
      if (!(error instanceof TRPCClientError) || error.data?.code !== "UNAUTHORIZED") throw error;
    } finally {
      setHasSession(false);
      utils.auth.me.setData(undefined, null);
      await utils.auth.me.invalidate();
    }
  }, [hasSession, logoutMutation, utils]);

  const state = useMemo(() => {
    const user = meQuery.data ?? null;
    return {
      user,
      loading: !sessionReady || (hasSession && meQuery.isLoading) || logoutMutation.isPending,
      error: meQuery.error ?? logoutMutation.error ?? null,
      isAuthenticated: Boolean(user),
    };
  }, [hasSession, logoutMutation.error, logoutMutation.isPending, meQuery.data, meQuery.error, meQuery.isLoading, sessionReady]);

  useEffect(() => {
    if (!redirectOnUnauthenticated || !sessionReady || hasSession || state.user) return;
    if (typeof window === "undefined") return;
    if (redirectPath && window.location.pathname === redirectPath) return;
    if (redirectPath) window.location.href = redirectPath;
    else void startLogin();
  }, [hasSession, redirectOnUnauthenticated, redirectPath, sessionReady, state.user]);

  return { ...state, refresh: () => meQuery.refetch(), logout };
}
