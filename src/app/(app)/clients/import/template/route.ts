import { requireStaff } from "@/features/auth/require-staff";
import { importText } from "@/i18n/import";
import { toCsv } from "@/lib/csv-write";

/** The import template: the header row and one fictional example row. Owner only. */
export async function GET() {
  await requireStaff(["owner"]);
  const { headers, example, fileName } = importText.template;
  return new Response(toCsv([headers, example]), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
