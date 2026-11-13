import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, inject, it } from "vitest";

import { beginAuthAttempt, throttleKey } from "@/features/auth/service";

import { serviceClient } from "../support/staff-accounts";
import { connectLocalDb } from "./db";
import { asActor, become, rolledBack, type Tx } from "./support/roles";

const sql = connectLocalDb();
const connection = {
  apiUrl: inject("supabaseApiUrl"),
  publishableKey: inject("supabasePublishableKey"),
  secretKey: inject("supabaseSecretKey"),
};

afterAll(async () => {
  await sql.end();
});

const T0 = new Date("2026-11-13T09:00:00Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

type Begin = {
  allowed: boolean;
  limited_by: string | null;
  retry_after_seconds: number;
};

function fresh() {
  return {
    email: throttleKey("email", `${randomUUID()}@example.test`),
    ip: throttleKey("ip", randomUUID()),
  };
}

async function begin(
  tx: Tx,
  action: string,
  key: { email: string; ip: string },
  at: Date,
): Promise<Begin> {
  const [row] = await tx<Begin[]>`
    select * from public.auth_throttle_begin(${action}, ${key.email}, ${key.ip}, ${at.toISOString()})
  `;
  if (!row) throw new Error("no row");
  return row;
}

async function succeed(
  tx: Tx,
  action: string,
  key: { email: string; ip: string },
  at: Date,
) {
  await tx`select public.auth_throttle_success(${action}, ${key.email}, ${key.ip}, ${at.toISOString()})`;
}

describe("auth_throttle_begin as service_role", () => {
  it("allows 5 sign-in attempts per email, then blocks until the window slides", async () => {
    await rolledBack(sql, async (tx) => {
      await become(tx, "service_role");
      const key = fresh();
      for (let i = 0; i < 5; i += 1) {
        expect((await begin(tx, "login", key, T0)).allowed).toBe(true);
      }

      const blocked = await begin(tx, "login", key, minutes(1));
      expect(blocked).toEqual({
        allowed: false,
        limited_by: "email",
        retry_after_seconds: 14 * 60,
      });

      // Blocked attempts are not counted, so the block ends 15 minutes after the 5th-newest attempt.
      expect((await begin(tx, "login", key, minutes(14))).allowed).toBe(false);
      expect(
        (await begin(tx, "login", key, new Date(minutes(15).getTime() + 1000)))
          .allowed,
      ).toBe(true);
    });
  });

  it("resets the per-email counter after a successful sign-in", async () => {
    await rolledBack(sql, async (tx) => {
      await become(tx, "service_role");
      const key = fresh();
      for (let i = 0; i < 4; i += 1) await begin(tx, "login", key, T0);
      await succeed(tx, "login", key, minutes(1));
      for (let i = 0; i < 5; i += 1) {
        expect((await begin(tx, "login", key, minutes(2))).allowed).toBe(true);
      }
      expect((await begin(tx, "login", key, minutes(3))).limited_by).toBe(
        "email",
      );
    });
  });

  it("blocks an IP after 20 attempts on different emails, and a success does not reset it", async () => {
    await rolledBack(sql, async (tx) => {
      await become(tx, "service_role");
      const ip = throttleKey("ip", randomUUID());
      for (let i = 0; i < 20; i += 1) {
        const key = { email: throttleKey("email", randomUUID()), ip };
        expect((await begin(tx, "login", key, T0)).allowed).toBe(true);
      }
      const next = { email: throttleKey("email", randomUUID()), ip };
      await succeed(tx, "login", next, T0);
      const blocked = await begin(tx, "login", next, minutes(5));
      expect(blocked).toEqual({
        allowed: false,
        limited_by: "ip",
        retry_after_seconds: 10 * 60,
      });
    });
  });

  it("limits password-reset requests to 3 per email", async () => {
    await rolledBack(sql, async (tx) => {
      await become(tx, "service_role");
      const key = fresh();
      for (let i = 0; i < 3; i += 1) {
        expect((await begin(tx, "password_reset", key, T0)).allowed).toBe(true);
      }
      expect((await begin(tx, "password_reset", key, T0)).limited_by).toBe(
        "email",
      );
      // A different action keeps its own counter.
      expect((await begin(tx, "login", key, T0)).allowed).toBe(true);
    });
  });

  it("rejects an unknown action", async () => {
    await expect(
      rolledBack(sql, async (tx) => {
        await become(tx, "service_role");
        await begin(tx, "export", fresh(), T0);
      }),
    ).rejects.toMatchObject({ code: "22023" });
  });

  it("counts a parallel burst exactly: 10 concurrent attempts, 5 allowed", async () => {
    const admin = serviceClient(connection);
    const email = `${randomUUID()}@example.test`;
    const now = new Date();
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        beginAuthAttempt(admin, now, {
          action: "login",
          email,
          ip: randomUUID(),
        }),
      ),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(5);
    expect(results.filter((result) => !result.allowed)).toHaveLength(5);
  });
});

describe("auth throttle is closed to the public API", () => {
  const roles = [
    "anon",
    { userId: "00000000-0000-4000-8000-000000000001" },
  ] as const;

  it.each(roles)("%j cannot call auth_throttle_begin", async (actor) => {
    await expect(
      asActor(sql, actor, (tx) => begin(tx, "login", fresh(), T0)),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it.each(roles)("%j cannot call auth_throttle_success", async (actor) => {
    await expect(
      asActor(sql, actor, (tx) => succeed(tx, "login", fresh(), T0)),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it.each(roles)("%j cannot read or write auth_attempts", async (actor) => {
    await expect(
      asActor(
        sql,
        actor,
        (tx) => tx`select count(*) from public.auth_attempts`,
      ),
    ).rejects.toMatchObject({ code: "42501" });
    const key = fresh();
    await expect(
      asActor(
        sql,
        actor,
        (tx) => tx`
          insert into public.auth_attempts (action, outcome, email_hash, ip_hash, created_at)
          values ('login', 'success', ${key.email}, ${key.ip}, now())
        `,
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("is not reachable with the publishable key over HTTP", async () => {
    const response = await fetch(
      `${connection.apiUrl}/rest/v1/rpc/auth_throttle_begin`,
      {
        method: "POST",
        headers: {
          apikey: connection.publishableKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          p_action: "login",
          p_email_hash: fresh().email,
          p_ip_hash: fresh().ip,
          p_now: T0.toISOString(),
        }),
      },
    );
    expect(response.ok).toBe(false);
  });

  it("enables RLS on auth_attempts", async () => {
    const [row] = await sql<{ relrowsecurity: boolean }[]>`
      select relrowsecurity from pg_class where oid = 'public.auth_attempts'::regclass
    `;
    expect(row?.relrowsecurity).toBe(true);
  });
});
