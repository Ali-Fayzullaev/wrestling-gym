import { PageHeaderSkeleton } from "@/components/list-skeleton";

import { FormSkeleton } from "../../../clients/form-skeleton";

export default function EditParentLoading() {
  return (
    <>
      <PageHeaderSkeleton />
      <FormSkeleton />
    </>
  );
}
