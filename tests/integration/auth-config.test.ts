import { describe, expect, inject, it } from "vitest";

const apiUrl = inject("supabaseApiUrl");
const apiKey = inject("supabasePublishableKey");

// Staff accounts are created by the owner; nobody may register on their own.
describe("local Supabase Auth configuration", () => {
  it("reports signup as disabled", async () => {
    const response = await fetch(`${apiUrl}/auth/v1/settings`, {
      headers: { apikey: apiKey },
    });

    expect(response.status).toBe(200);
    const settings = (await response.json()) as { disable_signup?: boolean };
    expect(settings.disable_signup).toBe(true);
  });

  it("rejects a signup attempt", async () => {
    const response = await fetch(`${apiUrl}/auth/v1/signup`, {
      method: "POST",
      headers: {
        apikey: apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email: "probe@example.test",
        password: "probe-password-123",
      }),
    });

    expect(response.ok).toBe(false);
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});
