import { z } from "zod";

// bcrypt (Supabase Auth) ignores bytes after 72, so longer passwords are refused outright.
const PASSWORD_MAX = 72;
export const PASSWORD_MIN = 8;

const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(PASSWORD_MAX),
});

export const passwordResetRequestSchema = z.object({
  email: emailSchema,
});

export const newPasswordSchema = z
  .object({
    password: z.string().min(PASSWORD_MIN).max(PASSWORD_MAX),
    confirm: z.string().max(PASSWORD_MAX),
  })
  .refine((value) => value.password === value.confirm, { path: ["confirm"] });

export type SignInInput = z.infer<typeof signInSchema>;
