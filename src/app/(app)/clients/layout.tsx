import { DeferredToaster } from "@/components/deferred-toaster";

/** Client screens confirm saves, archiving and deletion with toasts. */
export default function ClientsLayout({ children }: LayoutProps<"/clients">) {
  return (
    <>
      {children}
      <DeferredToaster />
    </>
  );
}
