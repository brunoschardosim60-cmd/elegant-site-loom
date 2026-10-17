// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import type { ConferenceState } from "@/lib/conference-state";
let db: PGlite;
const uid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const empty = { manifests: [], activity: [], issues: [] };
async function login(n: number, role = "authenticated") {
  await db.exec(
    `reset role; set role ${role}; select set_config('request.jwt.claim.sub','${uid(n)}',false)`,
  );
}
async function rpc<T = { data: ConferenceState; members: { email: string; pending: boolean }[] }>(
  name: string,
  args: unknown[] = [],
) {
  await db.exec("savepoint request_call");
  try {
    const value = (
      await db.query<{ value: T }>(
        `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) value`,
        args,
      )
    ).rows[0]!.value;
    await db.exec("release savepoint request_call");
    return value;
  } catch (error) {
    await db.exec("rollback to savepoint request_call; release savepoint request_call");
    throw error;
  }
}
async function attack(sql: string) {
  await db.exec("savepoint direct_attack");
  try {
    await db.exec(sql);
    await db.exec("release savepoint direct_attack");
  } catch (error) {
    await db.exec("rollback to savepoint direct_attack; release savepoint direct_attack");
    throw error;
  }
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz); create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`,
  );
  for (const file of (await readdir("supabase/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  for (let n = 1; n <= 3; n++)
    await db.query("insert into auth.users values($1,$2,now())", [
      uid(n),
      `security-${n}@example.invalid`,
    ]);
}, 30000);
beforeEach(async () => {
  await db.exec("reset role; begin");
  await login(1);
  await rpc("save_conference", [0, empty]);
  await rpc("get_conference_team");
  await rpc("invite_conference_member", ["security-2@example.invalid"]);
});
afterEach(async () => {
  await db.exec("rollback; reset role");
});
afterAll(async () => {
  await db.close();
});
it("cannot seed a teammate confirmation through the pre-team legacy endpoint", async () => {
  await login(3);
  await rpc("save_conference", [
    0,
    {
      ...empty,
      manifests: [
        {
          id: "06058889",
          driver: "LEGACY",
          plate: "ABC1D23",
          date: "2026-10-17",
          documents: [
            {
              id: "legacy-doc",
              ctc: "0000000009",
              nf: "9-1",
              volumes: 1,
              received: false,
              receiptChecks: [
                {
                  id: uid(1),
                  received: true,
                  email: "security-1@example.invalid",
                  receivedAt: "2000-01-01T00:00:00Z",
                },
              ],
            },
          ],
        },
      ],
    },
  ]);
  const team = await rpc("get_conference_team");
  expect(team.data.manifests[0]!.documents[0]!.receiptChecks).toEqual([]);
});
it("backfills an unattributed historical receipt without inventing an authenticated author", async () => {
  await login(3);
  await rpc("save_conference", [
    0,
    {
      ...empty,
      manifests: [
        {
          id: "06058890",
          driver: "LEGACY",
          plate: "ABC1D23",
          date: "2026-10-17",
          documents: [
            {
              id: "legacy",
              ctc: "0000000010",
              nf: "10-1",
              volumes: 1,
              received: true,
              receivedAt: "2026-10-17T12:00:00Z",
            },
          ],
        },
      ],
    },
  ]);
  const team = await rpc("get_conference_team"),
    doc = team.data.manifests[0]!.documents[0]!;
  expect(doc.received).toBe(true);
  expect(doc.receivedAt).toBe("2026-10-17T12:00:00Z");
  expect(doc.receivedBy).toBeUndefined();
  expect(doc.receiptChecks).toEqual([
    expect.objectContaining({ id: uid(3), received: true, legacy: true }),
  ]);
});
it("ignores forged peer reversals and assigns personal receipt authors and times from authentication", async () => {
  const base = (await rpc("get_conference_team")).data;
  const created = await rpc<{ data: ConferenceState }>("save_team_conference", [
    base,
    {
      ...base,
      manifests: [
        {
          id: "06058889",
          driver: "TEST",
          plate: "ABC1D23",
          date: "2026-10-17",
          documents: [{ id: "doc", ctc: "0000000009", nf: "9-1", volumes: 1, received: true }],
        },
      ],
    },
  ]);
  await login(2);
  await rpc("get_conference_team", [true]);
  const forged = structuredClone(created.data),
    doc = forged.manifests[0]!.documents[0]!;
  doc.receiptChecks![0]!.received = false;
  doc.receiptChecks!.push({
    id: uid(2),
    received: true,
    email: "security-1@example.invalid",
    receivedAt: "1900-01-01",
  });
  const saved = await rpc<{ data: ConferenceState }>("save_team_conference", [
    created.data,
    forged,
  ]);
  const checks = saved.data.manifests[0]!.documents[0]!.receiptChecks!;
  expect(checks.find((c) => c.id === uid(1))!.received).toBe(true);
  expect(checks.find((c) => c.id === uid(2))).toMatchObject({
    received: true,
    email: "security-2@example.invalid",
  });
  expect(checks.find((c) => c.id === uid(2))!.receivedAt).not.toBe("1900-01-01");
});
it("only adds the authenticated member, rejects forged links, and preserves links from old browsers", async () => {
  const base = (await rpc("get_conference_team")).data;
  const created = await rpc<{ data: ConferenceState }>("save_team_conference", [
    base,
    {
      ...base,
      manifests: [
        {
          id: "06058888",
          driver: "TEST",
          plate: "ABC1D23",
          date: "2026-10-14",
          documents: [{ id: "d", ctc: "0000000001", nf: "1-1", volumes: 1, received: false }],
        },
      ],
    },
  ]);
  await login(2);
  await rpc("get_conference_team", [true]);
  const forged = structuredClone(created.data);
  forged.manifests[0]!.demandUserIds = [uid(3)];
  await expect(rpc("save_team_conference", [created.data, forged])).rejects.toThrow(
    "CONFERENCE_INVALID",
  );
  forged.manifests[0]!.demandUserIds = [uid(2)];
  const linked = await rpc<{ data: ConferenceState }>("save_team_conference", [
    created.data,
    forged,
  ]);
  expect(linked.data.manifests[0]!.demandUserIds).toEqual([uid(2)]);
  expect(linked.data.manifests[0]!.createdBy).toBe(uid(1));
  await login(1);
  const oldBrowser = structuredClone(linked.data);
  delete oldBrowser.manifests[0]!.demandUserIds;
  oldBrowser.manifests[0]!.driver = "UPDATED";
  const saved = await rpc<{ data: ConferenceState }>("save_team_conference", [
    oldBrowser,
    oldBrowser,
  ]);
  expect(saved.data.manifests[0]!.demandUserIds).toEqual([uid(2)]);
});
it("rejects scalar type poisoning that would make the entire team's saved state undecodable", async () => {
  await login(1);
  const base = (await rpc("get_conference_team")).data;
  const pre = {
    id: "06058888",
    driver: "TESTE",
    plate: "ABC1D23",
    date: "2026-10-17",
    documents: [{ id: "typed-doc", ctc: "0000000088", nf: "123-1", volumes: 1, received: false }],
  };
  const attacks: unknown[] = [
    { ...pre, driver: 42 },
    { ...pre, plate: false },
    { ...pre, id: 60588888 },
    { ...pre, documents: [{ ...pre.documents[0], id: 42 }] },
    { ...pre, documents: [{ ...pre.documents[0], ctc: 1234567890 }] },
    { ...pre, documents: [{ ...pre.documents[0], volumes: 1e100 }] },
  ];
  for (const candidate of attacks)
    await expect(
      rpc("save_team_conference", [base, { ...base, manifests: [candidate] }]),
    ).rejects.toThrow("CONFERENCE_INVALID");
  expect((await rpc("get_conference_team")).data).toEqual(base);
  expect(await rpc("get_conference_audit")).toEqual([]);
});
it("keeps SQL metacharacters in imported names as data without executing them", async () => {
  await login(1);
  const base = (await rpc("get_conference_team")).data;
  const driver = "ROBERT'); DROP TABLE public.conference_states; --";
  const next = {
    ...base,
    manifests: [
      {
        id: "06059999",
        driver,
        plate: "ABC1D23",
        date: "2026-10-17",
        documents: [
          { id: "sql-probe", ctc: "0000000099", nf: "123-1", volumes: 1, received: false },
        ],
      },
    ],
  };
  const saved = await rpc("save_team_conference", [base, next]);
  expect(saved.data.manifests[0]!.driver).toBe(driver);
  expect((await rpc("get_conference_team")).data.manifests).toHaveLength(1);
});
it("shares an atomic photo budget across requests, denies counter tampering and renews only after the window expires", async () => {
  await login(1);
  for (let n = 0; n < 80; n++) expect(await rpc("consume_conference_reader_quota")).toBe(true);
  expect(await rpc("consume_conference_reader_quota")).toBe(false);
  await expect(attack("update public.conference_reader_limits set requests=1")).rejects.toThrow(
    "permission denied",
  );
  await login(2);
  await rpc("get_conference_team", [true]);
  expect(await rpc("consume_conference_reader_quota")).toBe(true);
  await login(1, "postgres");
  await db.query(
    "update public.conference_reader_limits set window_started=now()-interval '11 minutes' where user_id=$1",
    [uid(1)],
  );
  await login(1);
  expect(await rpc("consume_conference_reader_quota")).toBe(true);
});
it("reproduces canceled-invitation acceptance in the former code and blocks the same lock-wait interleaving after the fix", async () => {
  await login(1, "postgres");
  const original = (
    await db.query<{ def: string }>(
      "select pg_get_functiondef('public.get_conference_team(boolean)'::regprocedure) def",
    )
  ).rows[0]!.def;
  const marker = "perform 1 from public.conference_teams where id=tid for update;";
  // Model cancellation committing while acceptance waits for the team's lock.
  const race = (definition: string) =>
    definition.replace(
      marker,
      "delete from public.conference_invites where team_id=tid and email=em; " + marker,
    );
  await db.exec("savepoint vulnerable_replay");
  const vulnerable = original.replace(
    /if not exists\(select 1 from public\.conference_invites where team_id=tid and email=em\) then raise exception 'Convite cancelado\. Atualize a página\.'; end if;/,
    "",
  );
  expect(vulnerable).not.toBe(original);
  await db.exec(race(vulnerable));
  await login(2);
  expect(
    (await rpc("get_conference_team", [true])).members.some(
      (m: { email: string; pending: boolean }) =>
        m.email === "security-2@example.invalid" && !m.pending,
    ),
  ).toBe(true);
  await db.exec("reset role; rollback to vulnerable_replay");
  await db.exec(race(original));
  await login(2);
  await expect(rpc("get_conference_team", [true])).rejects.toThrow("Convite cancelado");
  await login(1, "postgres");
  expect(
    (await db.query("select * from public.conference_members where user_id=$1", [uid(2)])).rows,
  ).toHaveLength(0);
});
it("refuses oversized and nested malicious snapshots before merge without modifying state or audit", async () => {
  await login(1);
  const base = (await rpc("get_conference_team")).data;
  const pre = {
    id: "06050001",
    driver: "TESTE",
    plate: "ABC1D23",
    date: "2026-10-17",
    documents: [{ id: "doc", ctc: "0000000001", nf: "123-1", volumes: 1, received: false }],
  };
  for (const payload of [
    { ...base, manifests: [{ ...pre, driver: { nested: { attack: true } } }] },
    { ...base, __proto_attack: { nested: { attack: true } } },
    { ...base, manifests: [{ ...pre, driver: "x".repeat(5000000) }] },
    {
      ...base,
      manifests: [
        {
          ...pre,
          documents: [
            {
              ...pre.documents[0],
              nfOccurrences: [{ nf: "123-1", code: { nested: 1 }, description: "x" }],
            },
          ],
        },
      ],
    },
  ])
    await expect(rpc("save_team_conference", [base, payload])).rejects.toThrow(
      "CONFERENCE_INVALID",
    );
  expect((await rpc("get_conference_team")).data).toEqual(base);
  expect(await rpc("get_conference_audit")).toEqual([]);
});
it("requires current email confirmation for revision and audit access, even after membership was created", async () => {
  await login(2);
  await rpc("get_conference_team", [true]);
  await login(1, "postgres");
  await db.query("update auth.users set email_confirmed_at=null where id=$1", [uid(2)]);
  await login(2);
  await expect(rpc("get_conference_revision")).rejects.toThrow("Authentication required");
  await expect(rpc("get_conference_audit")).rejects.toThrow("Authentication required");
});
it("denies anonymous/private helper access and cross-team audit reads without trusting a supplied team identity", async () => {
  await login(3);
  await expect(rpc("get_conference_audit")).rejects.toThrow("Equipe não autorizada");
  await expect(rpc("conference_validate_input", [empty])).rejects.toThrow("permission denied");
  await expect(
    attack(
      "insert into public.conference_members(user_id,team_id,email) select user_id,team_id,'forged' from public.conference_members",
    ),
  ).rejects.toThrow("permission denied");
  await login(1, "anon");
  await expect(rpc("get_conference_revision")).rejects.toThrow("permission denied");
  await expect(attack("select * from public.conference_states")).rejects.toThrow(
    "permission denied",
  );
});
