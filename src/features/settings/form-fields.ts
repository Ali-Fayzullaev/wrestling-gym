// Shared by the gym settings form (browser) and the server checks; no Zod here.

export const GYM_NAME_MAX = 100;

export type GymSettings = { gymName: string; gymWhatsapp: string | null };

export type GymField = "gymName" | "gymWhatsapp";

export type GymSettingsResult =
  | { ok: true; changed: boolean }
  | {
      ok: false;
      error: "forbidden" | "invalid" | "unavailable";
      fields?: GymField[];
    };
