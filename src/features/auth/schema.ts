import { z } from "zod";

// bcrypt (Supabase Auth) ignores bytes after 72, so longer passwords are refused outright.
// Bytes, not characters: a Cyrillic letter takes two.
export const PASSWORD_MAX_BYTES = 72;
export const PASSWORD_MIN = 8;

const utf8 = new TextEncoder();

export function passwordBytes(password: string): number {
  return utf8.encode(password).length;
}

/** A password Auth will store whole: 8 characters or more, at most 72 bytes. */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN)
  .refine((value) => passwordBytes(value) <= PASSWORD_MAX_BYTES);

const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const signInSchema = z.object({
  email: emailSchema,
  password: z
    .string()
    .min(1)
    .refine((value) => passwordBytes(value) <= PASSWORD_MAX_BYTES),
});

export const newPasswordSchema = z
  .object({
    password: passwordSchema,
    confirm: z.string().max(PASSWORD_MAX_BYTES * 4),
  })
  .refine((value) => value.password === value.confirm, { path: ["confirm"] });

export type SignInInput = z.infer<typeof signInSchema>;
