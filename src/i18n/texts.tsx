import "server-only";

import type { ReactNode } from "react";

import { I18nProvider } from "./client";
import { type Namespace, pickMessages } from "./messages";
import { getI18n } from "./server";

/**
 * Hands the client islands below the sections of texts they read, in the request's language. Only
 * these sections travel to the browser, as data in the page; the dictionaries stay on the server.
 */
export async function Texts({
  ns,
  children,
}: {
  ns: readonly Namespace[];
  children: ReactNode;
}) {
  const { locale, t } = await getI18n();
  return (
    <I18nProvider locale={locale} messages={pickMessages(t, ns)}>
      {children}
    </I18nProvider>
  );
}
