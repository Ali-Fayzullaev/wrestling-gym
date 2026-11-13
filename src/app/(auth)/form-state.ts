/** What auth form actions return to the page: a ready-to-show message, never internal details. */
export type FormState = {
  error: string | null;
  notice: string | null;
  email: string;
  /** Set after sign-in: the form loads this address as a fresh document. */
  redirectTo: string | null;
};

export const initialFormState: FormState = {
  error: null,
  notice: null,
  email: "",
  redirectTo: null,
};
