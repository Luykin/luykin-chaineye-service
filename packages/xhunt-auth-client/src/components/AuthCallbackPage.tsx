import React, { useEffect, useState } from "react";
import { useXHuntAuth } from "../react/hooks";
import type { XHuntLoginResult } from "../types";
import "../styles/xhunt-auth.css";

export interface XHuntAuthCallbackPageProps {
  provider?: "google" | "twitter";
  bindMode?: boolean;
  onSuccess?: (result: XHuntLoginResult | { user: unknown }) => void;
  onError?: (error: unknown) => void;
}

function inferProvider() {
  if (typeof window === "undefined") return "google";
  const provider = new URL(window.location.href).searchParams.get("provider");
  return provider === "twitter" ? "twitter" : "google";
}

export function XHuntAuthCallbackPage({ provider, bindMode = false, onSuccess, onError }: XHuntAuthCallbackPageProps) {
  const auth = useXHuntAuth();
  const [status, setStatus] = useState("Completing secure handoff…");

  useEffect(() => {
    const actualProvider = provider || inferProvider();
    const run = async () => {
      try {
        if (bindMode) {
          const user = await auth.client.handleIdentityBindCallback(actualProvider);
          setStatus("Identity linked.");
          onSuccess?.({ user });
          return;
        }
        const result = await auth.handleOAuthCallback(actualProvider);
        setStatus("Signed in.");
        onSuccess?.(result);
      } catch (error) {
        setStatus("Authentication failed.");
        onError?.(error);
      }
    };
    run();
  }, []);

  return (
    <main className="xhunt-auth-callback">
      <div className="xhunt-auth-callback-card">
        <div className="xhunt-auth-spinner" />
        <p>{status}</p>
      </div>
    </main>
  );
}
