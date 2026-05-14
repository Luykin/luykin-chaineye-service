import { useEffect, useRef } from "react";

interface LegacyEjsPartialProps {
  html: string;
  tabId: string;
  initialize?: () => void;
}

function ensureExternalScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = Array.from(document.scripts).find((script) => script.src.endsWith(src) || script.getAttribute("src") === src);
    if (existing) {
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`加载脚本失败：${src}`));
    document.body.appendChild(script);
  });
}

function ensureStylesheet(href: string) {
  const existing = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).find(
    (link) => link.href.endsWith(href) || link.getAttribute("href") === href
  );
  if (existing) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

function attachInlineStyles(styleNodes: HTMLStyleElement[], tabId: string) {
  return styleNodes.map((style, index) => {
    const promotedStyle = document.createElement("style");
    promotedStyle.textContent = style.textContent || "";
    promotedStyle.setAttribute("data-legacy-partial-style", `${tabId}:${index}`);
    document.head.appendChild(promotedStyle);
    return () => promotedStyle.remove();
  });
}

export function LegacyEjsPartial({ html, tabId, initialize }: LegacyEjsPartialProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;

    host.innerHTML = html;

    const linkNodes = Array.from(host.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'));
    linkNodes.forEach((link) => {
      const href = link.getAttribute("href");
      if (href) ensureStylesheet(href);
    });

    const styleCleanups = attachInlineStyles(
      Array.from(host.querySelectorAll<HTMLStyleElement>("style")),
      tabId
    );
    const scriptNodes = Array.from(host.querySelectorAll<HTMLScriptElement>("script"));

    void (async () => {
      try {
        for (const script of scriptNodes) {
          const src = script.getAttribute("src");
          if (src) await ensureExternalScript(src);
        }

        if (disposed) return;

        // CSP forbids unsafe-eval/inline script execution. Legacy inline scripts are
        // migrated into bundled initializer modules and invoked here after the DOM
        // has been inserted and external dependencies are available.
        initialize?.();

        window.setTimeout(() => {
          if (!disposed) {
            document.dispatchEvent(new CustomEvent("stats-tab-activated", { detail: { tabId } }));
          }
        }, 0);
      } catch (error) {
        console.error("Legacy partial initialization failed", error);
      }
    })();

    return () => {
      disposed = true;
      styleCleanups.forEach((cleanup) => cleanup());
      host.innerHTML = "";
    };
  }, [html, initialize, tabId]);

  return <div ref={hostRef} />;
}
