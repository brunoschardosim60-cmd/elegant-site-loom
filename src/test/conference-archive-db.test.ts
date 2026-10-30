// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import type { Manifest } from "@/lib/conference";
import type { ConferenceState } from "@/lib/conference-state";

let db: PGlite;
const uid = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const empty = { manifests: [], activity: [], issues: [] };
type Team = { data: ConferenceState; revision: number };
type Archived = { manifest: Manifest; archivedAt: string }[];

async function login(n: number, role = "authenticated") {
  await db.exec(
    `reset role; set role ${role}; select set_config('request.jwt.claim.sub','${uid(n)}',false)`,
  );
}
async function rpc<T>(name: string, args: unknown[] = []): Promise<T> {
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
const team = () => rpc<Team>("get_conference_team");
async function save(base: ConferenceState, next: ConferenceState) {
  return rpc<Team>("save_team_conference_v2", [base, next]);
}
async function direct(sql: string) {
  await db.exec("savepoint direct_call");
  try {
    await db.exec(sql);
    await db.exec("release savepoint direct_call");
  } catch (error) {
    await db.exec("rollback to savepoint direct_call; release savepoint direct_call");
    throw error;
  }
}
const doc = (id: string, ctc: string, received = false) => ({
  id,
  ctc,
  nf: "123-1",
  volumes: 1,
  received,
});
const manifest = (id: string, issueDate: string, documents: ReturnType<typeof doc>[]) => ({
  id,
  driver: "MOTORISTA",
  plate: "ABC1D23",
  date: `${issueDate}T12:00:00.000Z`,
  issueDate,
  documents,
});
/** Back-date server-assigned finishedAt, as if the manifest finished long ago. */
async function age(id: string, days: number) {
  await login(1, "postgres");
  await db.query(
    `update public.conference_states set data=jsonb_set(data,'{manifests}',(
       select jsonb_agg(case when m->>'id'=$2 then m||jsonb_build_object('finishedAt',to_jsonb(now()-make_interval(days=>$3))) else m end order by ord)
       from jsonb_array_elements(data->'manifests') with ordinality x(m,ord))) where user_id=$1`,
    [uid(1), id, days],
  );
  await login(1);
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
      `archive-${n}@example.invalid`,
    ]);
}, 30000);
beforeEach(async () => {
  await db.exec("reset role; begin");
  await login(1);
  await rpc("save_conference", [0, empty]);
  await team();
  await rpc("invite_conference_member", ["archive-2@example.invalid"]);
  await login(2);
  await rpc("get_conference_team", [true]);
  await login(1);
});
afterEach(async () => {
  await db.exec("rollback; reset role");
});
afterAll(async () => {
  await db.close();
});

/** Old finished manifest DI…01, recent finished DI…02 and open DI…03. */
async function seed() {
  const start = (await team()).data;
  await save(start, {
    ...start,
    manifests: [
      manifest("DI0000000001", "2026-08-01", [doc("a1", "0000000001", true)]),
      manifest("DI0000000002", "2026-10-20", [doc("b1", "0000000002", true)]),
      manifest("DI0000000003", "2026-10-25", [doc("c1", "0000000003")]),
    ],
  });
  await age("DI0000000001", 40);
  await age("DI0000000002", 10);
  return (await team()).data;
}

it("moves only manifests finished at least 30 days ago and is idempotent", async () => {
  await seed();
  const before = await team();
  expect(await rpc<number>("archive_conference_manifests")).toBe(1);
  const after = await team();
  expect(after.revision).toBe(before.revision + 1);
  expect(after.data.manifests.map((m) => m.id)).toEqual(["DI0000000002", "DI0000000003"]);
  expect(await rpc<number>("archive_conference_manifests")).toBe(0);
  expect((await team()).revision).toBe(after.revision);
  const found = await rpc<Archived>("find_archived_conference_manifests", [[], ["0000000001"], []]);
  expect(found).toHaveLength(1);
  expect(found[0]!.manifest.id).toBe("DI0000000001");
  expect(found[0]!.manifest.documents[0]!.received).toBe(true);
});

it("lets a teammate archive and hides the archive from other teams", async () => {
  await seed();
  await login(2);
  expect(await rpc<number>("archive_conference_manifests")).toBe(1);
  expect(
    await rpc<Archived>("find_archived_conference_manifests", [["DI0000000001"], [], []]),
  ).toHaveLength(1);
  await login(3);
  await rpc("save_conference", [0, empty]);
  await team();
  expect(
    await rpc<Archived>("find_archived_conference_manifests", [["DI0000000001"], [], []]),
  ).toEqual([]);
});

it("does not resurrect an archived manifest from a stale device that saves other work", async () => {
  const stale = await seed();
  await rpc("archive_conference_manifests");
  const next = structuredClone(stale);
  next.manifests.find((m) => m.id === "DI0000000003")!.documents[0]!.received = true;
  const saved = await save(stale, next);
  expect(saved.data.manifests.map((m) => m.id)).toEqual(["DI0000000002", "DI0000000003"]);
  expect(saved.data.manifests[1]!.documents[0]!.received).toBe(true);
});

it("shows why the v2 save exists: the original RPC reports the same stale save as a conflict", async () => {
  const stale = await seed();
  await rpc("archive_conference_manifests");
  const next = structuredClone(stale);
  next.manifests.find((m) => m.id === "DI0000000003")!.documents[0]!.received = true;
  await expect(rpc("save_team_conference", [stale, next])).rejects.toThrow("CONFERENCE_CONFLICT");
});

it("rejects a stale device that edits an archived manifest", async () => {
  const stale = await seed();
  await rpc("archive_conference_manifests");
  const next = structuredClone(stale);
  next.manifests.find((m) => m.id === "DI0000000001")!.driver = "OUTRO MOTORISTA";
  await expect(save(stale, next)).rejects.toThrow();
  expect((await team()).data.manifests.map((m) => m.id)).toEqual(["DI0000000002", "DI0000000003"]);
});

it("extends duplicate rules to the archive while allowing a remanifested route", async () => {
  await seed();
  await login(1, "postgres");
  await db.query(
    `update public.conference_states set data=jsonb_set(data,'{manifests,0,sourcePhotoHashes}',to_jsonb(array[repeat('a',64)])) where user_id=$1`,
    [uid(1)],
  );
  await login(1);
  await rpc("archive_conference_manifests");
  const live = (await team()).data;
  const add = (item: ReturnType<typeof manifest> & { sourcePhotoHashes?: string[] }) =>
    save(live, { ...live, manifests: [...live.manifests, item] });
  await expect(
    add(manifest("DI0000000001", "2026-10-28", [doc("x1", "0000000099")])),
  ).rejects.toThrow("CONFERENCE_DUPLICATE");
  await expect(
    add(manifest("DI0000000009", "2026-08-01", [doc("x2", "0000000001")])),
  ).rejects.toThrow("CONFERENCE_DUPLICATE");
  await expect(
    add({
      ...manifest("DI0000000010", "2026-10-28", [doc("x3", "0000000098")]),
      sourcePhotoHashes: ["A".repeat(64)],
    }),
  ).rejects.toThrow("CONFERENCE_DUPLICATE");
  const rerouted = await add(manifest("DI0000000011", "2026-10-28", [doc("x4", "0000000001")]));
  expect(rerouted.data.manifests.map((m) => m.id)).toContain("DI0000000011");
});

it("adding a CTC already archived for the same date to an existing manifest is rejected", async () => {
  await seed();
  await rpc("archive_conference_manifests");
  const live = (await team()).data;
  const next = structuredClone(live);
  const open = next.manifests.find((m) => m.id === "DI0000000003")!;
  open.issueDate = "2026-08-01";
  open.documents.push({ id: "c2", ctc: "0000000001", nf: "9-1", volumes: 1, received: false });
  await expect(save(live, next)).rejects.toThrow("CONFERENCE_DUPLICATE");
});

it("keeps the archive and its helpers closed to direct access and anonymous callers", async () => {
  await seed();
  await rpc("archive_conference_manifests");
  await expect(direct("select * from public.conference_archive")).rejects.toThrow(
    "permission denied",
  );
  await expect(rpc("archive_conference_manifests", [1])).rejects.toThrow("CONFERENCE_INVALID");
  await login(1, "anon");
  await expect(rpc("archive_conference_manifests")).rejects.toThrow("permission denied");
  await expect(rpc("find_archived_conference_manifests", [[], [], []])).rejects.toThrow(
    "permission denied",
  );
});
