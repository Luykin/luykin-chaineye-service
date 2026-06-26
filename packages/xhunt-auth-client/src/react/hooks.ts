import { useContext, useEffect } from "react";
import { XHuntAuthContext } from "./AuthProvider";

export function useXHuntAuth() {
  const ctx = useContext(XHuntAuthContext);
  if (!ctx) {
    throw new Error("useXHuntAuth must be used inside XHuntAuthProvider");
  }
  return ctx;
}

export function useXHuntUser() {
  return useXHuntAuth().user;
}

export function useXHuntToken() {
  return useXHuntAuth().token;
}

export function useRequireXHuntAuth() {
  const auth = useXHuntAuth();
  useEffect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      auth.openLoginModal();
    }
  }, [auth.isAuthenticated, auth.isLoading]);
  return auth;
}
