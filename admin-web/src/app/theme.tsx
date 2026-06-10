import { createContext, useContext } from "react";

export type AdminThemeMode = "light" | "dark" | "system";
export type AdminEffectiveTheme = "light" | "dark";

export const ADMIN_THEME_STORAGE_KEY = "admin:theme-mode";

export type AdminThemeContextValue = {
  mode: AdminThemeMode;
  effectiveMode: AdminEffectiveTheme;
  setMode: (mode: AdminThemeMode) => void;
  toggleMode: () => void;
};

export const AdminThemeContext = createContext<AdminThemeContextValue | null>(null);

export function useAdminTheme() {
  const value = useContext(AdminThemeContext);
  if (!value) {
    throw new Error("useAdminTheme must be used inside AdminThemeContext.Provider");
  }
  return value;
}
