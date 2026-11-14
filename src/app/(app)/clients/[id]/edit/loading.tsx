import { PageHeaderSkeleton } from "@/components/list-skeleton";

import { FormSkeleton } from "../../form-skeleton";

export default function EditClientLoading() {
  return (
    <>
      <PageHeaderSkeleton />
      <FormSkeleton />
    </>
  );
}
