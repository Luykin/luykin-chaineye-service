interface Window {
  SimpleWebAuthnBrowser?: {
    browserSupportsWebAuthn: () => Promise<boolean>;
    startRegistration: (options: unknown) => Promise<unknown>;
    startAuthentication: (options: unknown) => Promise<unknown>;
  };
}
