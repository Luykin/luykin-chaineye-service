interface Window {
  SimpleWebAuthnBrowser?: {
    browserSupportsWebAuthn: () => boolean | Promise<boolean>;
    startRegistration: (options: unknown) => Promise<unknown>;
    startAuthentication: (options: unknown) => Promise<unknown>;
  };
}
