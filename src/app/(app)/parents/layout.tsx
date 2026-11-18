import { DeferredToaster } from "@/components/deferred-toaster";

/** The parent screens confirm saves and payments with toasts. */
export default function ParentsLayout({ children }: LayoutProps<"/parents">) {
  return (
    <>
      {children}
      <DeferredToaster />
    </>
  );
}
