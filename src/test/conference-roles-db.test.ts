// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import type { ConferenceState } from "@/lib/conference-state";

let db: PGlite;
const uid = (n: number) => `40000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const email = (n: number) => `roles-${n}@example.invalid`;
type Team = {
  data: ConferenceState;
  role: string;
  settings: { branches: string[]; reasons: string[] };
  members: { email: string; role?: string; pending: boolean }[];
};

async function login(n: number, role = "authenticated") {
  await db.exec(
    `reset role; set role ${role}; select set_config('request.jwt.claim.sub','${uid(n)}',false)`,
  );
}
async function rpc<T = Team>(name: string, args: unknown[] = []): Promise<T> {
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
const manifest = (id: string, ctc: string) => ({
  id,
  driver: "MOTORISTA",
  plate: "ABC1D23",
  date: "2026-10-28T12:00:00.000Z",
  issueDate: "2026-10-28",
  documents: [{ id: `doc-${ctc}`, ctc, nf: "1-1", volumes: 1, received: false }],
});
async function join(n: number, role?: string) {
  await login(1);
  await rpc("invite_conference_member", [email(n)]);
  await login(n);
  await rpc("get_conference_team", [true]);
  if (role) {
    await login(1);
    await rpc("set_conference_member_role", [email(n), role]);
  }
  await login(n);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz); create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`,
  );
  for (const file of (await readdir("supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  for (let n = 1; n <= 5; n++)
    await db.query("insert into auth.users values($1,$2,now())", [uid(n), email(n)]);
  await db.exec(`insert into public.conference_owner_allowlist(email) values ('${email(1)}')`);
}, 30000);
beforeEach(async () => {
  await db.exec("reset role; begin");
  await login(1);
  await rpc("get_conference_team");
});
afterEach(async () => {
  await db.exec("rollback; reset role");
});
afterAll(async () => {
  await db.close();
});

it("refuses a new account without an invitation or an approved owner e-mail", async () => {
  await login(5);
  await expect(rpc("get_conference_team")).rejects.toThrow("CONFERENCE_NOT_INVITED");
  await login(1, "postgres");
  expect(
    (await db.query("select 1 from public.conference_teams where owner_id=$1", [uid(5)])).rows,
  ).toHaveLength(0);
  await db.exec(`insert into public.conference_owner_allowlist(email) values ('${email(5)}')`);
  await login(5);
  expect((await rpc("get_conference_team")).role).toBe("owner");
});

it("lets an invited account in as a conferente and reports each member's role", async () => {
  await join(2);
  const team = await rpc("get_conference_team");
  expect(team.role).toBe("conferente");
  expect(team.members.find((m) => m.email === email(1))?.role).toBe("owner");
  expect(team.members.find((m) => m.email === email(2))?.role).toBe("conferente");
});

it("lets a read-only member read but not save or archive", async () => {
  await join(2, "leitura");
  const team = await rpc("get_conference_team");
  expect(team.role).toBe("leitura");
  const next = { ...team.data, manifests: [manifest("DI0000000001", "0000000001")] };
  await expect(rpc("save_team_conference_v2", [team.data, next])).rejects.toThrow(
    "CONFERENCE_READ_ONLY",
  );
  await expect(rpc("archive_conference_manifests")).rejects.toThrow("CONFERENCE_READ_ONLY");
  await login(1);
  await rpc("set_conference_member_role", [email(2), "conferente"]);
  await login(2);
  const saved = await rpc<{ data: ConferenceState }>("save_team_conference_v2", [team.data, next]);
  expect(saved.data.manifests).toHaveLength(1);
});

it("lets only the owner change roles and an admin invite and remove conferentes", async () => {
  await join(2, "admin");
  await expect(rpc("set_conference_member_role", [email(1), "leitura"])).rejects.toThrow(
    "Somente o responsável",
  );
  await rpc("invite_conference_member", [email(3)]);
  await login(3);
  await rpc("get_conference_team", [true]);
  await login(2);
  await rpc("remove_conference_member", [email(3)]);
  await login(3);
  await expect(rpc("get_conference_team")).rejects.toThrow("CONFERENCE_NOT_INVITED");
  await login(2);
  await expect(rpc("remove_conference_member", [email(1)])).rejects.toThrow("não encontrado");
});

it("an admin cannot remove another admin; the owner can", async () => {
  await join(2, "admin");
  await join(3, "admin");
  await expect(rpc("remove_conference_member", [email(2)])).rejects.toThrow(
    "Somente o responsável",
  );
  await login(1);
  const team = await rpc("remove_conference_member", [email(2)]);
  expect(team.members.map((m) => m.email)).not.toContain(email(2));
});

it("stores the team's branch and reason filter, defaulting to 06/DIS, for owners and admins only", async () => {
  expect((await rpc("get_conference_team")).settings).toEqual({
    branches: ["06"],
    reasons: ["DIS"],
  });
  expect(
    await rpc("set_conference_settings", [
      [" 6 ", "06", "12"],
      ["dis", "tra"],
    ]),
  ).toEqual({
    branches: ["06", "12", "6"],
    reasons: ["DIS", "TRA"],
  });
  await expect(rpc("set_conference_settings", [[], ["DIS"]])).rejects.toThrow("CONFERENCE_INVALID");
  await expect(rpc("set_conference_settings", [["0'6"], ["DIS"]])).rejects.toThrow(
    "CONFERENCE_INVALID",
  );
  await join(2);
  expect((await rpc("get_conference_team")).settings.reasons).toEqual(["DIS", "TRA"]);
  await expect(rpc("set_conference_settings", [["01"], ["DIS"]])).rejects.toThrow(
    "Somente o responsável",
  );
});

it("records browser errors with size and rate limits, and keeps them unreadable to clients", async () => {
  expect(await rpc<boolean>("report_client_error", ["x".repeat(5000), "stack", "/", "agent"])).toBe(
    true,
  );
  for (let n = 1; n < 30; n++) await rpc("report_client_error", [`erro ${n}`]);
  expect(await rpc<boolean>("report_client_error", ["over the limit"])).toBe(false);
  await login(1, "postgres");
  const rows = await db.query<{ len: number }>(
    "select max(length(message)) len from public.conference_client_errors",
  );
  expect(rows.rows[0]!.len).toBe(1000);
  await login(1);
  await db.exec("savepoint read_errors");
  await expect(db.query("select * from public.conference_client_errors")).rejects.toThrow(
    "permission denied",
  );
  await db.exec("rollback to savepoint read_errors");
  await login(1, "anon");
  await expect(rpc("report_client_error", ["anon"])).rejects.toThrow("permission denied");
});

it("saves and returns the 108 cargo details through the save RPC", async () => {
  const base = (await rpc("get_conference_team")).data;
  const cargo = {
    ...manifest("26180001", "0000000001"),
    checker: "SADI",
    documents: [
      {
        ...manifest("26180001", "0000000001").documents[0]!,
        cargoValueCents: 3944160,
        weightGrams: 83160,
        nature: "MAT.LAB",
        city: "PORTO ALEGRE",
      },
    ],
  };
  const saved = await rpc<{ data: ConferenceState }>("save_team_conference_v2", [
    base,
    { ...base, manifests: [cargo] },
  ]);
  expect(saved.data.manifests[0]).toMatchObject({ checker: "SADI" });
  expect(saved.data.manifests[0]!.documents[0]).toMatchObject({
    cargoValueCents: 3944160,
    weightGrams: 83160,
    nature: "MAT.LAB",
    city: "PORTO ALEGRE",
  });
  await expect(
    rpc("save_team_conference_v2", [
      saved.data,
      {
        ...saved.data,
        manifests: [{ ...cargo, documents: [{ ...cargo.documents[0]!, cargoValueCents: -5 }] }],
      },
    ]),
  ).rejects.toThrow("CONFERENCE_INVALID");
});
