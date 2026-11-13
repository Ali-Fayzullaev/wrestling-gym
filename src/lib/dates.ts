// Kazakhstan moved to a single UTC+5 zone in 2024; Asia/Almaty in current tzdata reflects that.
export const BUSINESS_TIME_ZONE = "Asia/Almaty";

const isoDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Calendar date (YYYY-MM-DD) of the given instant in the gym's time zone. */
export function businessDate(now: Date): string {
  return isoDateFormatter.format(now);
}
