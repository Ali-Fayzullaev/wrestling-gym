import { DeferredToaster } from "@/components/deferred-toaster";

/** Group screens confirm saves, archiving and transfers with toasts. */
export default function GroupsLayout({ children }: LayoutProps<"/groups">) {
  return (
    <>
      {children}
      <DeferredToaster />
    </>
  );
}
