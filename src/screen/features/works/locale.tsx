import { LocaleTextProvider } from "@cadence/screen-ui";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { messages, uiZhTW, type MessageKey } from "./localeCatalog";

export type Locale = "en" | "zh-TW";
export type Vars = Record<string, string | number>;

type LocaleValue = {
  locale: Locale;
  canvas: boolean;
  t: (key: MessageKey, vars?: Vars) => string;
};

export function translate(locale: Locale, key: MessageKey, vars: Vars = {}): string {
  const text = messages[key][locale];
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.hasOwn(vars, name) ? String(vars[name]) : whole,
  );
}

const LocaleContext = createContext<LocaleValue>({
  locale: "en",
  canvas: false,
  t: (key, vars) => translate("en", key, vars),
});

export function WorksLocaleProvider({
  locale,
  canvas = false,
  children,
}: {
  locale: Locale;
  canvas?: boolean;
  children: ReactNode;
}) {
  const value = useMemo<LocaleValue>(
    () => ({ locale, canvas, t: (key, vars) => translate(locale, key, vars) }),
    [locale, canvas],
  );
  // Shared controls translate their own English copy through this function.
  const ui = useMemo(
    () => (english: string) => (locale === "zh-TW" ? (uiZhTW[english] ?? english) : english),
    [locale],
  );
  return (
    <LocaleContext.Provider value={value}>
      <LocaleTextProvider value={ui}>{children}</LocaleTextProvider>
    </LocaleContext.Provider>
  );
}

export const useLocale = () => useContext(LocaleContext);
