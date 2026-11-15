import { DeferredToaster } from "@/components/deferred-toaster";

/** The group dialogs on "Settings" confirm saves and archiving with toasts. */
export default function SettingsLayout({ children }: LayoutProps<"/settings">) {
  return (
    <>
      {children}
      <DeferredToaster />
    </>
  );
}
