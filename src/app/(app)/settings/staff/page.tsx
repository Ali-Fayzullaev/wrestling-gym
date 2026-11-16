import type { Metadata } from "next";

import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/page-header";
import { createServerDb } from "@/db/server";
import { requireStaff } from "@/features/auth/require-staff";
import { AddStaffForm } from "@/features/staff/components/add-staff-form";
import { StaffAccessActions } from "@/features/staff/components/staff-access-actions";
import { listStaff, type StaffMember } from "@/features/staff/service";
import { ru } from "@/i18n/ru";
import { staffText as t } from "@/i18n/settings";

import {
  addStaffAction,
  resetStaffPasswordAction,
  updateStaffAccessAction,
} from "./actions";

export const metadata: Metadata = {
  title: `${ru.pages.staff} | ${ru.app.name}`,
};

/** "Settings -> Staff". Owner only. Two database requests: the role check and staff_screen(). */
export default async function StaffPage() {
  const actor = await requireStaff(["owner"]);
  const staff = await listStaff(await createServerDb());

  return (
    <>
      <BackLink href="/settings" label={t.back} />
      <PageHeader title={ru.pages.staff} description={t.description} />
      <AddStaffForm add={addStaffAction} />
      <section aria-labelledby="staff-list" className="flex flex-col gap-2">
        <h2 id="staff-list" className="text-lg font-semibold">
          {t.list.title}
        </h2>
        <ul className="flex flex-col divide-y rounded-xl border bg-card">
          {staff.map((member) => (
            <StaffRow
              key={member.id}
              member={member}
              isSelf={member.id === actor.id}
            />
          ))}
        </ul>
      </section>
    </>
  );
}

function StaffRow({
  member,
  isSelf,
}: {
  member: StaffMember;
  isSelf: boolean;
}) {
  return (
    <li
      data-testid="staff-row"
      className="flex flex-col gap-3 px-4 py-4 lg:flex-row lg:items-start lg:justify-between"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <p className="font-semibold break-words">{member.fullName}</p>
        <p className="text-sm break-all text-muted-foreground">
          {member.email}
        </p>
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
          <span data-testid="staff-role">{ru.roles[member.role]}</span>
          {member.active ? null : (
            <span
              className="text-status-expired-foreground"
              data-testid="staff-inactive"
            >
              {t.list.inactive}
            </span>
          )}
          {member.active && member.mustChangePassword ? (
            <span
              className="text-muted-foreground"
              data-testid="staff-temporary-password"
            >
              {t.list.mustChangePassword}
            </span>
          ) : null}
          {isSelf ? (
            <span className="text-muted-foreground">{t.list.you}</span>
          ) : null}
        </p>
      </div>
      {isSelf ? (
        <p className="text-sm text-muted-foreground lg:max-w-60">
          {t.list.selfNote}
        </p>
      ) : (
        <StaffAccessActions
          staffId={member.id}
          fullName={member.fullName}
          role={member.role}
          active={member.active}
          update={updateStaffAccessAction}
          resetPassword={resetStaffPasswordAction}
        />
      )}
    </li>
  );
}
