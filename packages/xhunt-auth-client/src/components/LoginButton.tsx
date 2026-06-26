import React from "react";
import { useXHuntAuth } from "../react/hooks";
import "../styles/xhunt-auth.css";

export interface XHuntLoginButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  loggedInLabel?: string;
  loggedOutLabel?: string;
}

export function XHuntLoginButton({ loggedInLabel, loggedOutLabel = "Sign in", ...props }: XHuntLoginButtonProps) {
  const auth = useXHuntAuth();
  const label = auth.isAuthenticated ? loggedInLabel || auth.user?.username || "Account" : loggedOutLabel;

  return (
    <button
      {...props}
      className={["xhunt-auth-login-button", props.className].filter(Boolean).join(" ")}
      onClick={(event) => {
        props.onClick?.(event);
        if (!event.defaultPrevented) auth.openLoginModal();
      }}
    >
      {auth.user?.avatar && <img src={auth.user.avatar} alt="" />}
      <span>{label}</span>
    </button>
  );
}
