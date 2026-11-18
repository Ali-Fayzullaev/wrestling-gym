import { createHash, randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { connectLocalDb } from "./db";
import {
  insertClient,
  insertPayment,
  templateId,
  testPhone,
} from "./support/fixtures";
import {
  admin,
  asActor,
  become,
  owner,
  rolledBack,
  SEED_GROUP,
  SEED_STAFF,
  type Tx,
} from "./support/roles";

// Step 19 (D-13): a reminder in the client's language, falling back to Russian.

const sql = connectLocalDb();

afterAll(async () => {
  await sql.end();
});

const TODAY = "2026-03-15";
const PERMISSION_DENIED = { code: "42501" };
const CHECK_VIOLATION = { code: "23514" };
const UNIQUE_VIOLATION = { code: "23505" };

/** A client of that language whose subscription ends a week after TODAY. */
async function clientOf(tx: Tx, messageLocale: string) {
  const clientId = await insertClient(tx, { messageLocale });
  const paymentId = await insertPayment(tx, {
    clientId,
    periodStart: "2026-02-21",
    periodEnd: "2026-03-22",
    createdAt: new Date("2026-02-21T06:00:00Z"),
  });
  return { clientId, paymentId };
}

async function openedTemplate(tx: Tx, paymentId: string, kind: string) {
  await tx`select public.record_reminder_opened(${paymentId}, ${kind})`;
  const [row] = await tx<{ template_id: string }[]>`
    select template_id from public.reminder_events
    where payment_id = ${paymentId} and kind = ${kind}
  `;
  return row?.template_id;
}

describe("criterion 1: the template follows the client's language", () => {
  it("an opened chat records the template in the client's language", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const ru = await clientOf(tx, "ru");
      const kk = await clientOf(tx, "kk");
      const uz = await clientOf(tx, "uz");
      await become(tx, admin);
      return {
        ru: await openedTemplate(tx, ru.paymentId, "before_7"),
        kk: await openedTemplate(tx, kk.paymentId, "before_7"),
        uz: await openedTemplate(tx, uz.paymentId, "before_7"),
        expected: {
          ru: await templateId(tx, "before_7", "ru"),
          kk: await templateId(tx, "before_7", "kk"),
          uz: await templateId(tx, "before_7", "uz"),
        },
      };
    });
    expect({ ru: result.ru, kk: result.kk, uz: result.uz }).toEqual(
      result.expected,
    );
  });

  it("without a template in the client's language the Russian one is used", async () => {
    const result = await rolledBack(sql, async (tx) => {
      // Only a migration could remove a template; as postgres, inside a rolled-back transaction.
      await tx`delete from public.message_templates where kind = 'overdue' and locale = 'kk'`;
      const kk = await clientOf(tx, "kk");
      await become(tx, owner);
      return {
        opened: await openedTemplate(tx, kk.paymentId, "overdue"),
        russian: await templateId(tx, "overdue", "ru"),
      };
    });
    expect(result.opened).toBe(result.russian);
  });

  it("the screens carry the client's language next to the wa.me data", async () => {
    const result = await rolledBack(sql, async (tx) => {
      await tx`update public.clients set archived_at = now() where archived_at is null`;
      const kk = await clientOf(tx, "kk");
      await become(tx, admin);
      const [today] = await tx<
        {
          s: { remind: { id: string; reminder: { message_locale: string } }[] };
        }[]
      >`select public.today_screen(${TODAY}::date) as s`;
      const [card] = await tx<
        {
          s: {
            client: { message_locale: string };
            reminder: { payment_id: string; kind: string } | null;
            reminder_context: { templates: unknown[] };
          };
        }[]
      >`select public.client_screen(${kk.clientId}, ${TODAY}::date) as s`;
      return { kk, today: today?.s, card: card?.s };
    });
    expect(
      result.today?.remind.find((row) => row.id === result.kk.clientId)
        ?.reminder.message_locale,
    ).toBe("kk");
    expect(result.card?.client.message_locale).toBe("kk");
    expect(result.card?.reminder).toEqual({
      payment_id: result.kk.paymentId,
      kind: "before_7",
    });
    // Three reminder kinds and the several-children text, in three languages each.
    expect(result.card?.reminder_context.templates).toHaveLength(12);
  });

  it("the card offers the overdue text once the subscription has ended, nothing without one", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const ended = await insertClient(tx, { messageLocale: "uz" });
      await insertPayment(tx, {
        clientId: ended,
        periodStart: "2026-02-01",
        periodEnd: "2026-03-01",
        createdAt: new Date("2026-02-01T06:00:00Z"),
      });
      const none = await insertClient(tx);
      await become(tx, admin);
      const reminderOf = async (id: string) => {
        const [row] = await tx<{ r: { kind: string } | null }[]>`
          select public.client_screen(${id}, ${TODAY}::date) -> 'reminder' as r
        `;
        return row?.r ?? null;
      };
      return { ended: await reminderOf(ended), none: await reminderOf(none) };
    });
    expect(result.ended?.kind).toBe("overdue");
    expect(result.none).toBeNull();
  });
});

describe("criterion 5: admin changes a client's language, not the templates", () => {
  it("admin sets the language on create and changes it on update, with an audit row", async () => {
    const result = await asActor(sql, admin, async (tx) => {
      const [created] = await tx<{ id: string }[]>`
        select public.create_client(
          p_last_name => 'Сериков', p_first_name => 'Әлихан', p_phone => ${testPhone()},
          p_started_on => ${TODAY}::date, p_message_locale => 'kk'
        ) as id
      `;
      const id = created?.id ?? "";
      const localeOf = async () => {
        const [row] = await tx<{ message_locale: string }[]>`
          select message_locale from public.clients where id = ${id}
        `;
        return row?.message_locale;
      };
      const update = (locale: string | null) => tx`
        select public.update_client(
          p_client_id => ${id}, p_last_name => 'Сериков', p_first_name => 'Әлихан',
          p_phone => (select phone from public.clients where id = ${id}),
          p_started_on => ${TODAY}::date,
          p_message_locale => ${locale}
        )
      `;
      const onCreate = await localeOf();
      await update("uz");
      const onUpdate = await localeOf();
      // An older caller that does not send the language keeps the one on file.
      await update(null);
      const kept = await localeOf();
      // The journal is the owner's; read it as postgres.
      await become(tx, "postgres");
      const audit = await tx<{ details: { fields: string[] } }[]>`
        select details from public.audit_log
        where entity_id = ${id} and action = 'client.update'
      `;
      return {
        onCreate,
        onUpdate,
        kept,
        audit: audit.map((a) => a.details.fields),
      };
    });
    expect(result).toEqual({
      onCreate: "kk",
      onUpdate: "uz",
      kept: "uz",
      audit: [["message_locale"]],
    });
  });

  it("a client created without a language gets Russian", async () => {
    const locale = await asActor(sql, admin, async (tx) => {
      const [created] = await tx<{ id: string }[]>`
        select public.create_client(
          p_last_name => 'Иванов', p_first_name => 'Пётр', p_phone => ${testPhone()},
          p_started_on => ${TODAY}::date
        ) as id
      `;
      const [row] = await tx<{ message_locale: string }[]>`
        select message_locale from public.clients where id = ${created?.id ?? ""}
      `;
      return row?.message_locale;
    });
    expect(locale).toBe("ru");
  });

  it("admin: saving a Kazakh text is refused by the database and nothing changes", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const kk = await templateId(tx, "before_7", "kk");
      await become(tx, admin);
      await tx`savepoint attempt`;
      const error = await tx`
        select public.update_reminder_settings(
          ${[7, 1]}::integer[], ${tx.json([{ id: kk, body: "Чужой мәтін" }])}
        )
      `.then(
        () => null,
        (caught: { code?: string }) => caught.code,
      );
      await tx`rollback to savepoint attempt`;
      const direct = await tx`
        update public.message_templates set body = 'Чужой', updated_by = ${SEED_STAFF.admin}
        where id = ${kk} returning id
      `;
      const [row] = await tx<{ body: string }[]>`
        select body from public.message_templates where id = ${kk}
      `;
      return { error, direct: direct.length, body: row?.body };
    });
    expect(result.error).toBe(PERMISSION_DENIED.code);
    expect(result.direct).toBe(0);
    expect(result.body).not.toMatch(/Чужой/);
  });

  it("owner: saving a Kazakh text changes only it and names its language in the audit", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const kk = await templateId(tx, "before_7", "kk");
      const ru = await templateId(tx, "before_7", "ru");
      const [ruBefore] = await tx<{ body: string }[]>`
        select body from public.message_templates where id = ${ru}
      `;
      await become(tx, owner);
      await tx`
        select public.update_reminder_settings(
          ${[7, 1]}::integer[], ${tx.json([{ id: kk, body: "Сәлем, {имя}!" }])}
        )
      `;
      const rows = await tx<
        { id: string; body: string; updated_by: string | null }[]
      >`
        select id, body, updated_by from public.message_templates where id in (${kk}, ${ru})
      `;
      const [audit] = await tx<{ details: Record<string, unknown> }[]>`
        select details from public.audit_log
        where action = 'template.update' and entity_id = ${kk} and created_at = now()
      `;
      return { kk, ru, ruBefore: ruBefore?.body, rows, audit: audit?.details };
    });
    const byId = new Map(result.rows.map((row) => [row.id, row]));
    expect(byId.get(result.kk)).toEqual({
      id: result.kk,
      body: "Сәлем, {имя}!",
      updated_by: SEED_STAFF.owner,
    });
    expect(byId.get(result.ru)?.body).toBe(result.ruBefore);
    expect(result.audit).toEqual({
      fields: ["body"],
      kind: "before_7",
      locale: "kk",
    });
  });
});

describe("criterion 6: one template per kind and language, known languages only", () => {
  it("a second template of the same kind and language is refused", async () => {
    await expect(
      rolledBack(
        sql,
        (tx) => tx`
          insert into public.message_templates (name, kind, locale, body)
          values ('Ещё один', 'before_7', 'kk', 'Мәтін')
        `,
      ),
    ).rejects.toMatchObject(UNIQUE_VIOLATION);
  });

  it("every kind has a template in every language", async () => {
    const pairs = await asActor(sql, owner, async (tx) => {
      const rows = await tx<{ pair: string }[]>`
        select kind || ':' || locale as pair from public.message_templates order by 1
      `;
      return rows.map((row) => row.pair);
    });
    expect(pairs).toEqual(
      // Step 21 (D-18): the several-children text is a fourth kind.
      ["before_1", "before_7", "family", "overdue"].flatMap((kind) =>
        ["kk", "ru", "uz"].map((locale) => `${kind}:${locale}`),
      ),
    );
  });

  it.each(["en", "uz-Latn", "", "RU"])(
    "a client language %j is refused",
    async (locale) => {
      await expect(
        asActor(
          sql,
          admin,
          (tx) => tx`
            select public.create_client(
              p_last_name => 'Неверный', p_first_name => 'Язык', p_phone => ${testPhone()},
              p_started_on => ${TODAY}::date,
              p_message_locale => ${locale}
            )
          `,
        ),
      ).rejects.toMatchObject(CHECK_VIOLATION);
    },
  );

  it("a template language outside ru, kk, uz is refused", async () => {
    await expect(
      rolledBack(
        sql,
        (tx) => tx`
          insert into public.message_templates (name, kind, locale, body)
          values ('English', 'before_7', 'en', 'Text')
        `,
      ),
    ).rejects.toMatchObject(CHECK_VIOLATION);
  });

  it("nobody moves a template to another language", async () => {
    await expect(
      asActor(
        sql,
        owner,
        (tx) => tx`
          update public.message_templates set locale = 'uz', updated_by = ${SEED_STAFF.owner}
          where kind = 'overdue' and locale = 'kk'
        `,
      ),
    ).rejects.toMatchObject(PERMISSION_DENIED);
  });
});

describe("criterion 7: import sets the language", () => {
  const hash = () => createHash("sha256").update(randomUUID()).digest("hex");
  const row = (line: number, messageLocale?: string | null) => ({
    line,
    last_name: `Импортов${line}`,
    first_name: "Язык",
    phone: testPhone(),
    group_id: SEED_GROUP,
    new_group: null,
    ends_on: null,
    ...(messageLocale === undefined ? {} : { message_locale: messageLocale }),
  });

  it("each row gets its language; missing or null means Russian", async () => {
    const locales = await asActor(sql, owner, async (tx) => {
      const rows = [row(2, "kk"), row(3, "uz"), row(4, null), row(5)];
      await tx`
        select public.import_clients(${hash()}, ${tx.json(rows)}, '[]'::jsonb, ${TODAY}::date)
      `;
      const found = await tx<{ last_name: string; message_locale: string }[]>`
        select last_name, message_locale from public.clients
        where last_name in ${tx(rows.map((r) => r.last_name))}
        order by last_name
      `;
      return found.map((c) => c.message_locale);
    });
    expect(locales).toEqual(["kk", "uz", "ru", "ru"]);
  });

  it("a wrong language is refused by the database, so nothing is imported", async () => {
    await expect(
      asActor(
        sql,
        owner,
        (tx) => tx`
          select public.import_clients(
            ${hash()}, ${tx.json([row(2, "kk"), row(3, "en")])}, '[]'::jsonb, ${TODAY}::date
          )
        `,
      ),
    ).rejects.toMatchObject(CHECK_VIOLATION);
  });
});
