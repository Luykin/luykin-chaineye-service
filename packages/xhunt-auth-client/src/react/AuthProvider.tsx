import React, { createContext, useCallback, useEffect, useMemo, useState } from "react";
import { XHuntAuthClient } from "../client";
import {
  OAuthCallbackInput,
  XHuntAuthConfig,
  XHuntAuthContextValue,
  XHuntAuthError,
  XHuntAuthState,
  XHuntAuthUser,
  XHuntLoginResult,
  XHuntTokenSet,
} from "../types";
import { DEFAULT_STORAGE_KEY } from "../storage";

export const XHuntAuthContext = createContext<XHuntAuthContextValue | null>(null);

export interface XHuntAuthProviderProps {
  config: XHuntAuthConfig;
  children: React.ReactNode;
}

function toAuthError(error: unknown): XHuntAuthError {
  if (error instanceof XHuntAuthError) return error;
  if (error instanceof Error) return new XHuntAuthError("UNKNOWN_ERROR", error.message);
  return new XHuntAuthError("UNKNOWN_ERROR");
}

export function XHuntAuthProvider({ config, children }: XHuntAuthProviderProps) {
  const client = useMemo(() => new XHuntAuthClient(config), [config]);
  const [isLoginModalOpen, setLoginModalOpen] = useState(false);
  const [state, setState] = useState<XHuntAuthState>(() => {
    const token = client.getStoredToken();
    const user = client.getStoredUser();
    return {
      token,
      user,
      isAuthenticated: !!token?.accessToken,
      isLoading: !!token?.accessToken && config.autoLoadUser !== false,
      error: null,
    };
  });

  const updateState = useCallback(
    (patch: Partial<XHuntAuthState>) => {
      setState((prev) => {
        const next = {
          ...prev,
          ...patch,
          isAuthenticated: !!(patch.token ?? prev.token)?.accessToken,
        };
        config.onAuthStateChange?.(next);
        return next;
      });
    },
    [config]
  );

  const handleError = useCallback(
    (error: unknown) => {
      const authError = toAuthError(error);
      updateState({ error: authError, isLoading: false });
      config.onError?.(authError);
      throw authError;
    },
    [config, updateState]
  );

  const applyLoginResult = useCallback(
    (result: XHuntLoginResult) => {
      updateState({ token: result.token, user: result.user, isLoading: false, error: null });
      setLoginModalOpen(false);
      return result;
    },
    [updateState]
  );

  const reloadUser = useCallback(async (): Promise<XHuntAuthUser | null> => {
    try {
      updateState({ isLoading: true });
      const user = await client.getCurrentUser();
      const token = client.getStoredToken();
      updateState({ user, token, isLoading: false, error: null });
      return user;
    } catch (error) {
      client.clearToken();
      updateState({ user: null, token: null, isLoading: false });
      return handleError(error);
    }
  }, [client, handleError, updateState]);

  useEffect(() => {
    if (config.autoLoadUser === false) return;
    if (!client.getStoredToken()?.accessToken) return;
    reloadUser().catch(() => undefined);
  }, [client, config.autoLoadUser, reloadUser]);

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key !== DEFAULT_STORAGE_KEY) return;
      const token = client.getStoredToken();
      const user = client.getStoredUser();
      updateState({ token, user, isLoading: false, error: null });
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [client, updateState]);

  const value = useMemo<XHuntAuthContextValue>(() => {
    return {
      ...state,
      client,
      isLoginModalOpen,
      openLoginModal: () => setLoginModalOpen(true),
      closeLoginModal: () => setLoginModalOpen(false),
      loginWithPassword: async (input) => {
        try {
          updateState({ isLoading: true, error: null });
          return applyLoginResult(await client.loginWithPassword(input));
        } catch (error) {
          return handleError(error);
        }
      },
      registerWithPassword: async (input) => {
        try {
          updateState({ isLoading: true, error: null });
          return applyLoginResult(await client.registerWithPassword(input));
        } catch (error) {
          return handleError(error);
        }
      },
      loginWithGoogle: async () => client.loginWithGoogle(),
      loginWithTwitter: async () => client.loginWithTwitter(),
      loginWithWallet: async () => {
        try {
          updateState({ isLoading: true, error: null });
          return applyLoginResult(await client.loginWithWallet());
        } catch (error) {
          return handleError(error);
        }
      },
      handleOAuthCallback: async (provider = "google", input?: OAuthCallbackInput) => {
        try {
          updateState({ isLoading: true, error: null });
          return applyLoginResult(await client.handleOAuthCallback(provider, input));
        } catch (error) {
          return handleError(error);
        }
      },
      refresh: async (): Promise<XHuntTokenSet | null> => {
        try {
          const token = await client.refreshToken();
          updateState({ token, user: client.getStoredUser(), isLoading: false, error: null });
          return token;
        } catch (error) {
          return handleError(error);
        }
      },
      reloadUser,
      logout: async (options) => {
        try {
          await client.logout(options);
        } finally {
          updateState({ token: null, user: null, isLoading: false, error: null });
        }
      },
    };
  }, [applyLoginResult, client, handleError, isLoginModalOpen, reloadUser, state, updateState]);

  return <XHuntAuthContext.Provider value={value}>{children}</XHuntAuthContext.Provider>;
}
