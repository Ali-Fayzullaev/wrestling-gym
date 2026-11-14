// Limits shared by the settings form (in the browser) and its Zod schema (on the server). Kept out
// of schema.ts so the form does not pull Zod into its route's first load.
export const DAYS_MIN = 1;
export const DAYS_MAX = 60;
export const BODY_MAX = 1000;
