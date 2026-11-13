"use server";

import { createServerDb } from "@/db/server";
import { LOGIN_PATH } from "@/features/auth/routes";

export type SignOutState = { redirectTo: string | null };

// Signing out needs no role: anyone holding a session may end it. Global scope also revokes the
// refresh token, so a copied cookie stops working too. The button then loads the sign-in page
// as a new document (see LogoutButton).
export async function signOutAction(): Promise<SignOutState> {
  const db = await createServerDb();
  await db.auth.signOut();
  return { redirectTo: LOGIN_PATH };
}
