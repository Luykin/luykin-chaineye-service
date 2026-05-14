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
    Quill?: new (element: HTMLElement, options?: Record<string, unknown>) => {
      root: HTMLElement;
      clipboard?: { dangerouslyPasteHTML: (html: string) => void };
      on: (eventName: string, handler: (...args: any[]) => void) => void;
      getSemanticHTML?: () => string;
    };
    Diff?: {
      diffJson: (
        oldValue: unknown,
        newValue: unknown
      ) => Array<{ value: string; added?: boolean; removed?: boolean }>;
      createPatch?: (
        fileName: string,
        oldStr: string,
        newStr: string,
        oldHeader?: string,
        newHeader?: string
      ) => string;
    };
  }
}

export {};
