import React, { createContext } from "react";

export type ThemeMode = "light" | "dark";

export const ThemeContext = createContext<{
  theme: ThemeMode;
  setTheme: React.Dispatch<React.SetStateAction<ThemeMode>>;
}>({
  theme: "light",
  setTheme: () => {},
});
