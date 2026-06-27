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

function appendTransferCode(returnUrl: string, transferCode: string) {
  const url = new URL(returnUrl);
  if (url.hash) {
    const queryIndex = url.hash.indexOf("?");
    const hashPath = queryIndex >= 0 ? url.hash.slice(0, queryIndex) : url.hash;
    const hashQuery = queryIndex >= 0 ? url.hash.slice(queryIndex + 1) : "";
    const hashParams = new URLSearchParams(hashQuery);
    hashParams.set("authTransferCode", transferCode);
    url.hash = `${hashPath}?${hashParams.toString()}`;
  } else {
    url.searchParams.set("authTransferCode", transferCode);
  }
  return url.toString();
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
        const result = provider ? await auth.handleOAuthCallback(actualProvider) : await auth.client.handleOAuthCallbackAuto();
        setStatus("Signed in.");
        onSuccess?.(result);
        if (result.transferCode && result.returnUrl && typeof window !== "undefined") {
          setStatus("Returning to app…");
          window.location.replace(appendTransferCode(result.returnUrl, result.transferCode));
        }
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
