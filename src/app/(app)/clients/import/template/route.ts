import { requireStaff } from "@/features/auth/require-staff";
import { getI18n } from "@/i18n/server";
import { toCsv } from "@/lib/csv-write";

/**
 * The import template in the owner's language: the header row and one fictional example row.
 * Owner only. The column detection knows the headers of all three languages.
 */
export async function GET() {
  await requireStaff(["owner"]);
  const { t } = await getI18n();
  const { headers, example, fileName } = t.import.template;
  return new Response(toCsv([headers, example]), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
