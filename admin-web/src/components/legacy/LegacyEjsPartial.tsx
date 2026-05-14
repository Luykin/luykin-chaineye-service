import { useEffect, useRef } from "react";

interface LegacyEjsPartialProps {
  html: string;
  tabId: string;
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

export function LegacyEjsPartial({ html, tabId }: LegacyEjsPartialProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const executedRef = useRef(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || executedRef.current) return;
    executedRef.current = true;

    host.innerHTML = html;

    const linkNodes = Array.from(host.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'));
    linkNodes.forEach((link) => {
      const href = link.getAttribute("href");
      if (href) ensureStylesheet(href);
    });

    const scriptNodes = Array.from(host.querySelectorAll<HTMLScriptElement>("script"));

    void (async () => {
      for (const script of scriptNodes) {
        const src = script.getAttribute("src");
        if (src) await ensureExternalScript(src);
      }

      for (const script of scriptNodes) {
        if (script.getAttribute("src")) continue;
        const code = script.textContent || "";
        if (!code.trim()) continue;
        // Run legacy partial scripts in the page global scope so their DOM-based logic is preserved.
        new Function(code)();
      }

      window.setTimeout(() => {
        document.dispatchEvent(new CustomEvent("stats-tab-activated", { detail: { tabId } }));
      }, 0);
    })();

    return () => {
      host.innerHTML = "";
    };
  }, [html, tabId]);

  return <div ref={hostRef} />;
}
