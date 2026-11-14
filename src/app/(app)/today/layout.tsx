import { DeferredToaster } from "@/components/deferred-toaster";

/** "Paid" on this screen confirms with a toast (and offers to cancel it). */
export default function TodayLayout({ children }: LayoutProps<"/today">) {
  return (
    <>
      {children}
      <DeferredToaster />
    </>
  );
}
