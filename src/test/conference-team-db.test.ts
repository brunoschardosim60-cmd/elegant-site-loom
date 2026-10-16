// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { emptyConference, type ConferenceState } from "@/lib/conference-state";
import type { ConferenceTeam } from "@/lib/conference-team";
type AuditEntry = { id: number; actor_email: string; manifest_id: string; action: string };
type RpcResults = {
  get_conference_team: ConferenceTeam;
  invite_conference_member: ConferenceTeam;
  cancel_conference_invite: ConferenceTeam;
  get_conference_audit: AuditEntry[];
  conference_reader_owner: string | null;
  save_conference: number;
  save_team_conference: { revision: number; data: ConferenceState };
};
let db: PGlite;
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function as(n: number, role = "authenticated") {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${uid(n)}',false)`);
}
async function call<Name extends keyof RpcResults>(
  name: Name,
  args: unknown[] = [],
): Promise<RpcResults[Name]> {
  return (
    await db.query<{ result: RpcResults[Name] }>(
      `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) result`,
      args,
    )
  ).rows[0]!.result;
}
const make = (id = "DI00123456789", ctc = "0000000001") => ({
  id,
  driver: "Motorista Teste",
  plate: "ABC1234",
  date: "2026-10-13T03:00:00Z",
  documents: [{ id: `${id}-${ctc}`, ctc, nf: "123-1", volumes: 2, received: false }],
});
const save = (base: ConferenceState, next: ConferenceState) =>
  call("save_team_conference", [base, next]);
let teamId: string;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz); create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`,
  );
  for (let i = 1; i <= 8; i++)
    await db.query("insert into auth.users values($1,$2,$3)", [
      uid(i),
      `person${i}@example.com`,
      i === 5 ? null : "2026-10-13",
    ]);
  await db.exec(await readFile("supabase/migrations/20261011040000_conference.sql", "utf8"));
  await db.exec(await readFile("supabase/migrations/20261013040000_teams.sql", "utf8"));
  await db.exec(
    await readFile("supabase/migrations/20261013050000_reader_team_access.sql", "utf8"),
  );
  await db.exec(
    await readFile("supabase/migrations/20261013060000_team_members_and_merge.sql", "utf8"),
  );
  await db.exec(
    await readFile("supabase/migrations/20261014010000_manifest_corrections.sql", "utf8"),
  );
  await db.exec(
    await readFile("supabase/migrations/20261014020000_ctc_identity_conflicts.sql", "utf8"),
  );
  await db.exec(
    await readFile("supabase/migrations/20261014030000_export_manifest_ids.sql", "utf8"),
  );
  await db.exec(
    await readFile("supabase/migrations/20261015090000_remanifested_routes.sql", "utf8"),
  );
  // Reapplying the deployment must not duplicate the concurrency guard.
  await db.exec(
    await readFile("supabase/migrations/20261015090000_remanifested_routes.sql", "utf8"),
  );
  await db.exec(
    await readFile("supabase/migrations/20261015110000_manifest_schedule_metadata.sql", "utf8"),
  );
  await db.exec(
    await readFile("supabase/migrations/20261016010000_personal_team_demands.sql", "utf8"),
  );
  await db.exec(
    await readFile("supabase/migrations/20261016020000_visible_action_actors.sql", "utf8"),
  );
}, 30000);
afterAll(async () => {
  await db?.close();
});
it("preserves the owner records and shares only with invited confirmed accounts, without a fixed member cap", async () => {
  await as(1);
  await call("save_conference", [0, { ...emptyConference, manifests: [make()] }]);
  const owner = await call("get_conference_team");
  teamId = owner.teamId;
  expect(owner.data.manifests).toHaveLength(1);
  expect(owner.owner).toBe(true);
  await call("invite_conference_member", ["person2@example.com"]);
  await call("invite_conference_member", ["person3@example.com"]);
  await call("invite_conference_member", ["person6@example.com"]);
  await as(2);
  const personal = {
    ...emptyConference,
    manifests: [
      {
        ...make("DI00123456999", "0000000999"),
        createdBy: uid(2),
        createdByEmail: "person2@example.com",
      },
    ],
  };
  await call("save_conference", [0, personal]);
  const invited = await call("get_conference_team");
  expect(invited.teamId).not.toBe(teamId);
  expect(invited.invitation?.ownerEmail).toBe("person1@example.com");
  expect(invited.data).toEqual(personal);
  const member = await call("get_conference_team", [true]);
  expect(member.teamId).toBe(teamId);
  expect(member.owner).toBe(false);
  expect(member.data).toEqual(owner.data);
  expect(
    (
      await db.query<{ data: unknown }>(
        "select data from public.conference_states where user_id=$1",
        [uid(2)],
      )
    ).rows[0]!.data,
  ).toEqual(personal);
  await expect(call("invite_conference_member", ["person4@example.com"])).rejects.toThrow(
    "Somente",
  );
  await as(3);
  expect((await call("get_conference_team", [true])).teamId).toBe(teamId);
  expect(await call("conference_reader_owner")).toBe("person1@example.com");
  await as(6);
  const fourth = await call("get_conference_team", [true]);
  expect(fourth.teamId).toBe(teamId);
  expect(fourth.members).toHaveLength(4);
  await as(4);
  expect((await call("get_conference_team")).teamId).not.toBe(teamId);
  expect((await call("get_conference_team")).data.manifests).toEqual([]);
  expect(await call("conference_reader_owner")).toBe("person4@example.com");
  await as(5);
  await expect(call("get_conference_team")).rejects.toThrow("Confirme");
});
it("merges simultaneous receipt of different CTCs and finalizes exactly once with authenticated audit", async () => {
  await as(1);
  const initial = (await call("get_conference_team")).data as ConferenceState;
  const two = structuredClone(initial);
  two.manifests[0]!.documents.push({ ...make(undefined, "0000000002").documents[0]! });
  const base = (await save(initial, two)).data;
  const a = structuredClone(base),
    b = structuredClone(base);
  a.manifests[0]!.documents[0]!.received = true;
  a.manifests[0]!.documents[0]!.receivedAt = "1900-01-01";
  b.manifests[0]!.documents[1]!.received = true;
  await as(2);
  await save(base, a);
  await as(3);
  const final = await save(base, b);
  expect(final.data.manifests[0]!.documents.every((d) => d.received)).toBe(true);
  expect(final.data.manifests[0]!.finishedAt).toBeTruthy();
  expect(final.data.manifests[0]!.documents[0]!.receivedAt).not.toBe("1900-01-01");
  const history = await call("get_conference_audit");
  expect(history.filter((e) => e.action === "pre_finished")).toHaveLength(1);
  expect(
    history
      .filter((e) => e.action === "ctc_received")
      .map((e) => e.actor_email)
      .sort(),
  ).toEqual(["person2@example.com", "person3@example.com"]);
  await as(2);
  const repeat = await save(base, a);
  expect(repeat.data.manifests[0]!.documents.every((d) => d.received)).toBe(true);
  expect(
    (await call("get_conference_audit")).filter((e) => e.action === "ctc_received"),
  ).toHaveLength(2);
});
it("combines two new different pres, rejects duplicate CTCs and rejects competing edits/deletions atomically", async () => {
  await as(1);
  let base = (await call("get_conference_team")).data as ConferenceState;
  const a = structuredClone(base),
    b = structuredClone(base);
  a.manifests.push(make("DI00123456790", "0000000003"));
  b.manifests.push(make("DI00123456791", "0000000004"));
  await as(2);
  await save(base, a);
  await as(3);
  const combined = await save(base, b);
  expect(combined.data.manifests).toHaveLength(3);
  const duplicate = structuredClone(combined.data);
  duplicate.manifests.push(make("DI00123456792", "0000000003"));
  await expect(save(combined.data, duplicate)).rejects.toThrow("CONFERENCE_DUPLICATE");
  expect((await call("get_conference_team")).data).toEqual(combined.data);
  base = combined.data;
  const left = structuredClone(base),
    right = structuredClone(base),
    removed = structuredClone(base);
  left.manifests[0]!.documents[0]!.nf = "100-1";
  right.manifests[0]!.documents[0]!.nf = "200-1";
  removed.manifests.shift();
  await as(1);
  await save(base, left);
  await as(2);
  await expect(save(base, right)).rejects.toThrow("CONFERENCE_CONFLICT");
  await expect(save(base, removed)).rejects.toThrow("CONFERENCE_CONFLICT");
  expect((await call("get_conference_team")).data.manifests[0]!.documents[0]!.nf).toBe("100-1");
});
it("cannot use another team identity, forge audit or use the legacy write endpoint for a shared team", async () => {
  await as(4);
  expect(await call("get_conference_audit")).toEqual([]);
  const outsider = await call("get_conference_team");
  expect(outsider.teamId).not.toBe(teamId);
  await expect(db.exec("select * from public.conference_audit")).rejects.toThrow(
    "permission denied",
  );
  await expect(
    db.exec(
      `insert into public.conference_audit(team_id,actor_email,manifest_id,action) values('${teamId}','forged','fake','pre_added')`,
    ),
  ).rejects.toThrow("permission denied");
  await expect(
    db.exec(`update public.conference_states set data='{}' where user_id='${uid(1)}'`),
  ).rejects.toThrow("permission denied");
  await as(1);
  await expect(call("save_conference", [1, emptyConference])).rejects.toThrow(
    "CONFERENCE_TEAM_RELOAD",
  );
  await as(1, "anon");
  await expect(call("get_conference_team")).rejects.toThrow("permission denied");
});
it("rejects malformed data without changing records or audit and supports pending invite cancellation", async () => {
  await as(1);
  const base = (await call("get_conference_team")).data as ConferenceState,
    history = await call("get_conference_audit");
  for (const field of ["nf", "ctc", "received"]) {
    const invalid = structuredClone(base);
    Reflect.deleteProperty(invalid.manifests[0]!.documents[0]!, field);
    await expect(save(base, invalid)).rejects.toThrow("CONFERENCE_INVALID");
  }
  expect((await call("get_conference_team")).data).toEqual(base);
  expect(await call("get_conference_audit")).toEqual(history);
  await as(4);
  await expect(call("invite_conference_member", ["person1@example.com"])).rejects.toThrow(
    "outra equipe",
  );
  await call("invite_conference_member", ["person5@example.com"]);
  await call("invite_conference_member", ["new@example.com"]);
  await call("invite_conference_member", ["fourth@example.com"]);
  await expect(call("invite_conference_member", ["fourth@example.com"])).rejects.toThrow(
    "Email já incluído",
  );
  await call("cancel_conference_invite", ["fourth@example.com"]);
  await call("cancel_conference_invite", ["new@example.com"]);
  expect((await call("get_conference_team")).members).toHaveLength(2);
  await as(5);
  await expect(call("get_conference_team", [true])).rejects.toThrow("Confirme");
});
it("does not orphan pending invites when a personal owner tries to join a different team", async () => {
  await as(7);
  const own = await call("get_conference_team");
  await as(4);
  await call("invite_conference_member", ["person7@example.com"]);
  await as(7);
  await call("invite_conference_member", ["pending-owner@example.com"]);
  await expect(call("get_conference_team", [true])).rejects.toThrow("outra equipe");
  expect((await call("get_conference_team")).teamId).toBe(own.teamId);
  await call("cancel_conference_invite", ["pending-owner@example.com"]);
  await call("get_conference_team", [true]);
  await as(4);
  expect(
    (await call("get_conference_team")).members.some(
      (m) => m.email === "person7@example.com" && !m.pending,
    ),
  ).toBe(true);
});
it("executes the standalone rollback security script without changing existing fixtures", async () => {
  await as(1, "postgres");
  await db.exec(await readFile("supabase/tests/conference-security.sql", "utf8"));
  expect(
    (
      await db.query<{ count: number }>(
        "select count(*)::int count from auth.users where email like '%@example.invalid'",
      )
    ).rows[0]!.count,
  ).toBe(0);
});
it("renumbers a pré with stable receipt times, linked authenticated history and conflict protection", async () => {
  await as(1);
  const base = (await call("get_conference_team")).data as ConferenceState;
  const old = base.manifests[0]!;
  const beforeHistory = await call("get_conference_audit", [old.id]);
  const next = structuredClone(base);
  const renamed = next.manifests[0]!;
  renamed.id = "DI00601869631";
  renamed.previousIds = [old.id];
  renamed.driver = "DAVID VARGAS FERNANDES";
  renamed.documents[0]!.volumes = 60;
  await as(2);
  const saved = (await save(base, next)).data;
  expect(saved.manifests[0]!.documents[0]!.receivedAt).toBe(old.documents[0]!.receivedAt);
  expect(saved.manifests[0]!.finishedAt).toBe(old.finishedAt);
  const history = await call("get_conference_audit", [renamed.id]);
  expect(beforeHistory.length).toBeGreaterThan(0);
  expect(beforeHistory.every((previous) => history.some((entry) => entry.id === previous.id))).toBe(
    true,
  );
  expect(
    history.some(
      (e) =>
        e.action === "pre_edited" &&
        e.manifest_id === renamed.id &&
        e.actor_email === "person2@example.com",
    ),
  ).toBe(true);
  expect(history.some((e) => e.action === "ctc_edited" && e.manifest_id === renamed.id)).toBe(true);
  expect(history.some((e) => e.action === "pre_removed" && e.manifest_id === old.id)).toBe(false);
  const stale = structuredClone(base);
  stale.manifests[0]!.documents[0]!.nf = "888-1";
  await expect(save(base, stale)).rejects.toThrow("CONFERENCE_CONFLICT");
  const fabricated = structuredClone(saved);
  fabricated.manifests[0]!.previousIds = ["DI00000000999"];
  await expect(save(saved, fabricated)).rejects.toThrow("CONFERENCE_CONFLICT");
});
it("rejects a totals mismatch on the server unless explicitly reviewed", async () => {
  await as(1);
  const base = (await call("get_conference_team")).data as ConferenceState;
  const next = structuredClone(base);
  next.manifests[0]!.totalVolumes = 999;
  await expect(save(base, next)).rejects.toThrow("CONFERENCE_TOTALS_REVIEW");
  next.manifests[0]!.totalsReviewed = true;
  expect((await save(base, next)).data.manifests[0]!.totalVolumes).toBe(999);
});

it("rejects a simultaneous CTC identity correction and a scan of the old identity in either order", async () => {
  await as(1);
  const initial = (await call("get_conference_team")).data as ConferenceState;
  const setup = structuredClone(initial);
  setup.manifests.push(make("DI00999999001", "0099999901"));
  const base = (await save(initial, setup)).data;
  const correction = structuredClone(base),
    scan = structuredClone(base);
  correction.manifests.at(-1)!.documents[0]!.ctc = "0099999902";
  scan.manifests.at(-1)!.documents[0]!.received = true;
  await as(2);
  const corrected = (await save(base, correction)).data;
  await as(3);
  await expect(save(base, scan)).rejects.toThrow("CONFERENCE_CONFLICT");
  // Restore pending identity and retry with receipt winning first.
  await as(1);
  const restore = structuredClone(corrected);
  restore.manifests.at(-1)!.documents[0]!.ctc = "0099999901";
  const restored = (await save(corrected, restore)).data;
  const a = structuredClone(restored),
    b = structuredClone(restored);
  a.manifests.at(-1)!.documents[0]!.received = true;
  b.manifests.at(-1)!.documents[0]!.ctc = "0099999902";
  await as(2);
  await save(restored, a);
  await as(3);
  await expect(save(restored, b)).rejects.toThrow("CONFERENCE_CONFLICT");
});

it("saves literal exported manifest IDs and rejects simultaneous duplicates without altering legacy prés", async () => {
  await as(1);
  const base = (await call("get_conference_team")).data as ConferenceState;
  const a = structuredClone(base),
    b = structuredClone(base);
  a.manifests.push(make("06052233", "0088888801"));
  b.manifests.push(make("06052233", "0088888802"));
  await as(2);
  const saved = await save(base, a);
  expect(saved.data.manifests.find((m) => m.id === "06052233")).toBeTruthy();
  expect(saved.data.manifests.filter((m) => m.id.startsWith("DI"))).toEqual(
    base.manifests.filter((m) => m.id.startsWith("DI")),
  );
  await as(3);
  await expect(save(base, b)).rejects.toThrow();
  expect((await call("get_conference_team")).data).toEqual(saved.data);
  const bad = structuredClone(saved.data);
  bad.manifests.push(make("MANIFESTO-ERRADO", "0088888803"));
  await expect(save(saved.data, bad)).rejects.toThrow("CONFERENCE_INVALID");
});

it("preserves remanifestations across drivers and rejects a stale receipt on the previous route", async () => {
  await as(1);
  const base = (await call("get_conference_team")).data;
  const first = { ...make("DI006059991", "0077777701"), issueDate: "2026-10-13" };
  const old = await save(base, { ...base, manifests: [...base.manifests, first] });
  const later = {
    ...make("06059992", "0077777701"),
    issueDate: "2026-10-15",
    driver: "Outro motorista",
    plate: "XYZ1A23",
  };
  await as(2);
  const next = await save(old.data, { ...old.data, manifests: [...old.data.manifests, later] });
  expect(
    next.data.manifests.filter((m) => m.documents.some((d) => d.ctc === "0077777701")),
  ).toHaveLength(2);
  const stale = structuredClone(old.data);
  stale.manifests.find((m) => m.id === first.id)!.documents[0]!.received = true;
  await as(3);
  await expect(save(old.data, stale)).rejects.toThrow("CONFERENCE_CONFLICT");
  const receipt = structuredClone(next.data);
  receipt.manifests.find((m) => m.id === later.id)!.documents[0]!.received = true;
  const confirmed = await save(next.data, receipt);
  expect(confirmed.data.manifests.find((m) => m.id === first.id)!.documents[0]!.received).toBe(
    false,
  );
  expect(
    confirmed.data.manifests.find((m) => m.id === later.id)!.documents[0]!.receivedAt,
  ).toBeTruthy();
  const duplicate = structuredClone(confirmed.data);
  duplicate.manifests.push({ ...make("06059993", "0077777701"), issueDate: "2026-10-15" });
  await expect(save(confirmed.data, duplicate)).rejects.toThrow("CONFERENCE_DUPLICATE");
});
it("preserves issuance clock time and separate delivery dates with authenticated validation", async () => {
  await as(1);
  const base = (await call("get_conference_team")).data;
  const next = structuredClone(base);
  next.manifests[0]!.issueTime = "17:03";
  next.manifests[0]!.documents[0]!.deliveryDates = ["2026-10-16"];
  const saved = await save(base, next);
  expect(saved.data.manifests[0]).toMatchObject({
    issueTime: "17:03",
    documents: expect.arrayContaining([expect.objectContaining({ deliveryDates: ["2026-10-16"] })]),
  });
  expect(saved.data.manifests[0]!.documents[0]!.receivedAt).toBe(
    base.manifests[0]!.documents[0]!.receivedAt,
  );
  const invalid = structuredClone(saved.data);
  invalid.manifests[0]!.issueTime = "25:00";
  await expect(save(saved.data, invalid)).rejects.toThrow("CONFERENCE_INVALID");
});
it("assigns creators from authentication, preserves them on teammate edits and backfills from immutable audit", async () => {
  await as(1);
  await call("get_conference_team");
  await as(2);
  await call("get_conference_team");
  const base = (await call("get_conference_team")).data;
  const next = structuredClone(base);
  next.manifests.push({
    ...make("06058880", "0066666601"),
    createdBy: uid(1),
    createdByEmail: "person1@example.com",
  });
  const first = await save(base, next);
  expect(first.data.manifests.find((m) => m.id === "06058880")).toMatchObject({
    createdBy: uid(2),
    createdByEmail: "person2@example.com",
  });
  await as(1);
  const edit = structuredClone(first.data);
  const own = edit.manifests.find((m) => m.id === "06058880")!;
  own.createdBy = uid(1);
  own.createdByEmail = "person1@example.com";
  own.documents[0]!.received = true;
  const second = await save(first.data, edit);
  expect(second.data.manifests.find((m) => m.id === "06058880")).toMatchObject({
    createdBy: uid(2),
    createdByEmail: "person2@example.com",
    documents: [{ received: true }],
  });
  const team = await call("get_conference_team");
  expect(team.members.find((member) => member.email === "person2@example.com")?.userId).toBe(
    uid(2),
  );
  const auditBefore = await call("get_conference_audit");
  await expect(
    db.query("select public.conference_manifest_creator($1,$2,$2,$3,$4)", [
      team.teamId,
      own,
      uid(1),
      "person1@example.com",
    ]),
  ).rejects.toThrow("permission denied");
  await db.exec("reset role");
  const missing = structuredClone(second.data);
  for (const item of missing.manifests) {
    delete item.createdBy;
    delete item.createdByEmail;
  }
  await db.query("update public.conference_states set data=$1 where user_id=$2", [missing, uid(1)]);
  const migration = await readFile(
    "supabase/migrations/20261016010000_personal_team_demands.sql",
    "utf8",
  );
  await db.exec(migration);
  await as(1);
  expect((await call("get_conference_team")).data).toEqual(second.data);
  expect(await call("get_conference_audit")).toEqual(auditBefore);
  await db.exec("reset role");
  await db.exec(migration);
  await as(1);
  expect((await call("get_conference_team")).data).toEqual(second.data);
});

it("initializes a new team's personal records with the actual owner and ignores legacy creator forgery", async () => {
  await as(8);
  const before = {
    ...emptyConference,
    manifests: [
      {
        ...make("06058881", "0066666602"),
        createdBy: uid(1),
        createdByEmail: "person1@example.com",
        updatedByEmail: "person1@example.com",
        updatedAt: "1900-01-01T00:00:00Z",
      },
    ],
  };
  await call("save_conference", [0, before]);
  const team = await call("get_conference_team");
  expect(team.data.manifests[0]).toEqual({
    ...make("06058881", "0066666602"),
    createdBy: uid(8),
    createdByEmail: "person8@example.com",
  });
  expect((await call("get_conference_team")).revision).toBe(team.revision);
  expect(await call("get_conference_audit")).toEqual([]);
});

it("attributes peer edits and receipts to actual users, preserves them on repeats and recovers visible actors from audit", async () => {
  await as(2);
  const base = (await call("get_conference_team")).data;
  const added = structuredClone(base);
  added.manifests.push({
    ...make("06058882", "0066666603"),
    updatedByEmail: "person1@example.com",
    updatedAt: "1900-01-01T00:00:00Z",
  });
  const first = await save(base, added);
  expect(first.data.manifests.at(-1)).toMatchObject({
    createdByEmail: "person2@example.com",
    updatedByEmail: "person2@example.com",
  });
  await as(3);
  const receipt = structuredClone(first.data);
  receipt.manifests.at(-1)!.documents[0]!.received = true;
  receipt.manifests.at(-1)!.documents[0]!.receivedByEmail = "person1@example.com";
  const second = await save(first.data, receipt);
  const received = second.data.manifests.at(-1)!;
  expect(received).toMatchObject({
    createdByEmail: "person2@example.com",
    updatedByEmail: "person3@example.com",
    documents: [{ receivedBy: uid(3), receivedByEmail: "person3@example.com" }],
  });
  await as(1);
  const forged = structuredClone(second.data);
  forged.manifests.at(-1)!.updatedByEmail = "person1@example.com";
  forged.manifests.at(-1)!.documents[0]!.receivedByEmail = "person1@example.com";
  const repeat = await save(second.data, forged);
  expect(repeat.data).toEqual(second.data);
  expect(repeat.revision).toBe(second.revision);
  const edited = structuredClone(repeat.data);
  edited.manifests.at(-1)!.documents[0]!.nf = "456-1";
  const third = await save(repeat.data, edited);
  expect(third.data.manifests.at(-1)).toMatchObject({
    createdByEmail: "person2@example.com",
    updatedByEmail: "person1@example.com",
    documents: [
      { receivedByEmail: "person3@example.com", receivedAt: received.documents[0]!.receivedAt },
    ],
  });
  const auditBefore = await call("get_conference_audit");
  await db.exec("reset role");
  const stripped = (
    await db.query<{ result: ConferenceState }>(
      "select public.conference_strip_action_actors($1) result",
      [third.data],
    )
  ).rows[0]!.result;
  await db.query("update public.conference_states set data=$1 where user_id=$2", [
    stripped,
    uid(1),
  ]);
  const migration = await readFile(
    "supabase/migrations/20261016020000_visible_action_actors.sql",
    "utf8",
  );
  await db.exec(migration);
  await as(1);
  const restored = (await call("get_conference_team")).data;
  expect(restored.manifests.at(-1)).toMatchObject({
    updatedByEmail: "person1@example.com",
    documents: [
      { receivedByEmail: "person3@example.com", receivedAt: received.documents[0]!.receivedAt },
    ],
  });
  expect(await call("get_conference_audit")).toEqual(auditBefore);
  await db.exec("reset role");
  expect(
    (
      await db.query<{ result: ConferenceState }>(
        "select public.conference_strip_action_actors($1) result",
        [restored],
      )
    ).rows[0]!.result,
  ).toEqual(stripped);
  await db.exec(migration);
  await as(1);
  expect((await call("get_conference_team")).data).toEqual(restored);
});
