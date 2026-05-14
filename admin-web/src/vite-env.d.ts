/// <reference types="vite/client" />

declare global {
  interface Window {
    echarts?: {
      init: (element: HTMLElement) => {
        setOption: (option: unknown, notMerge?: boolean) => void;
        showLoading: (type?: string, opts?: Record<string, unknown>) => void;
        hideLoading: () => void;
        resize: () => void;
        dispose: () => void;
        on: (eventName: string, handler: (params: any) => void) => void;
      };
    };
  }
}

export {};
