import type { NextRequest } from "next/server";

import { createServerDb } from "@/db/server";
import { requireStaff } from "@/features/auth/require-staff";
import type { ExportError } from "@/features/reports/result";
import { exportQuerySchema } from "@/features/reports/schema";
import { exportData } from "@/features/reports/service";
import { reportsText } from "@/i18n/reports";

const STATUS: Record<ExportError, number> = {
  forbidden: 403,
  rate_limited: 429,
  invalid: 400,
  unavailable: 503,
};

function failure(error: ExportError): Response {
  return new Response(reportsText.errors[error], {
    status: STATUS[error],
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/**
 * Downloads payments of a month or all clients as .xlsx or .csv. Owner only: the proxy answers 403
 * to anyone else, requireStaff checks again, and the database function checks the role a third
 * time, applies the hourly limit and writes the audit row. The file is built here, on the server.
 */
export async function GET(request: NextRequest) {
  await requireStaff(["owner"]);
  const query = exportQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!query.success) return failure("invalid");

  const result = await exportData(
    await createServerDb(),
    new Date(),
    query.data,
  );
  if (!result.ok) return failure(result.error);

  const { fileName, contentType, body } = result.data;
  return new Response(body, {
    headers: {
      "content-type": contentType,
      // The name carries the month or date only, never a name or phone.
      "content-disposition": `attachment; filename="${fileName}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
