// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { TeamSync, teamSchema, type TeamSyncView } from "@/lib/conference-team";
import { parseLuft108 } from "@/lib/luft-spreadsheet";
import { applyImports } from "@/lib/manifest-import";
import { emptyConference, type ConferenceState } from "@/lib/conference-state";
import { selectOwnedRoutes } from "@/lib/conference-ownership";
import { personalDocument, setPersonalReceipt } from "@/lib/personal-receipts";

// Three independent clients send overlapping HTTP requests to the actual SQL
// RPCs. PostgreSQL transactions serialize the commits. No production data,
// credentials, browser sessions or physical devices are involved.
let db: PGlite, server: Server, origin: string;
let inflight = 0,
  peak = 0,
  loseResponseFor = 0;
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const pre = (n = 1) => ({
  id: `DI${String(n).padStart(11, "0")}`,
  driver: "Motorista teste",
  plate: "ABC1234",
  date: "2026-10-13",
  documents: [1, 2, 3].map((d) => ({
    id: `${n}-${d}`,
    ctc: String(n * 10 + d).padStart(10, "0"),
    nf: `${n * 10 + d}-1`,
    volumes: d,
    received: false,
  })),
});
const routes: Record<string, string[]> = {
  get_conference_team: ["accept_invitation"],
  get_conference_revision: [],
  save_team_conference: ["base_data", "next_data"],
  save_team_conference_v2: ["base_data", "next_data"],
  archive_conference_manifests: ["min_days"],
  find_archived_conference_manifests: ["manifest_ids", "ctc_numbers", "hashes"],
  invite_conference_member: ["member_email"],
  get_conference_audit: ["pre_id", "before_id"],
};
async function rpc(user: number, name: string, args: Record<string, unknown> = {}) {
  try {
    return await (
      await fetch(origin, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-user": String(user) },
        body: JSON.stringify({ name, args }),
      })
    ).json();
  } catch {
    // Same shape supabase-js returns when fetch itself fails.
    return { data: null, error: { message: "TypeError: fetch failed" } };
  }
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz); create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`,
  );
  for (let n = 1; n <= 4; n++)
    await db.query("insert into auth.users values($1,$2,now())", [
      uid(n),
      `device${n}@example.invalid`,
    ]);
  for (const migration of [
    "20261011040000_conference.sql",
    "20261013040000_teams.sql",
    "20261013050000_reader_team_access.sql",
    "20261013060000_team_members_and_merge.sql",
    "20261014010000_manifest_corrections.sql",
    "20261014020000_ctc_identity_conflicts.sql",
    "20261014030000_export_manifest_ids.sql",
    "20261015090000_remanifested_routes.sql",
    "20261015110000_manifest_schedule_metadata.sql",
    "20261016010000_personal_team_demands.sql",
    "20261016020000_visible_action_actors.sql",
    "20261016030000_latest_nf_occurrences.sql",
    "20261017010000_security_hardening.sql",
    "20261017020000_security_scalar_types.sql",
    "20261018010000_shared_personal_demands.sql",
    "20261018020000_personal_receipt_acceptance.sql",
    "20261030010000_remove_photo_ai.sql",
    "20261030020000_conference_archive.sql",
    "20261030030000_roles_settings_monitoring.sql",
  ])
    await db.exec(await readFile(`supabase/migrations/${migration}`, "utf8"));
  await db.exec(
    "insert into public.conference_owner_allowlist(email) values ('device1@example.invalid')",
  );
  server = createServer(async (request, response) => {
    const user = Number(request.headers["x-test-user"]);
    let saving = false;
    try {
      if (![1, 2, 3, 4].includes(user)) throw new Error("test identity required");
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk);
      const { name, args } = JSON.parse(Buffer.concat(chunks).toString());
      if (!Object.hasOwn(routes, name)) throw new Error("unknown RPC");
      const params = routes[name]!.map((k) => args[k] ?? null);
      saving = name.startsWith("save_team_conference");
      if (saving) {
        peak = Math.max(peak, ++inflight);
        await new Promise((done) => setTimeout(done, 30));
      }
      const data = await db.transaction(async (tx) => {
        await tx.exec("set local role authenticated");
        await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [uid(user)]);
        return (
          await tx.query<{ result: unknown }>(
            `select public.${name}(${params.map((_, i) => `$${i + 1}`).join(",")}) result`,
            params,
          )
        ).rows[0]!.result;
      });
      if (saving && loseResponseFor === user) {
        loseResponseFor = 0;
        response.destroy();
        return;
      }
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ data, error: null }));
    } catch (error) {
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({ data: null, error: { message: String((error as Error).message) } }),
      );
    } finally {
      if (saving) inflight--;
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  await rpc(1, "get_conference_team");
  for (const n of [2, 3, 4]) {
    expect(
      (await rpc(1, "invite_conference_member", { member_email: `device${n}@example.invalid` }))
        .error,
    ).toBeNull();
    expect((await rpc(n, "get_conference_team", { accept_invitation: true })).error).toBeNull();
  }
}, 30000);
beforeEach(async () => {
  peak = 0;
  loseResponseFor = 0;
  await db.query("update public.conference_states set revision=0,data=$1 where user_id=$2", [
    { ...emptyConference, manifests: [pre()] },
    uid(1),
  ]);
  await db.exec("delete from public.conference_audit");
  await db.exec("delete from public.conference_archive");
});
afterAll(async () => {
  await new Promise<void>((done) => server?.close(() => done()));
  await db?.close();
});
async function clients() {
  const views: TeamSyncView[] = [];
  const sessions = await Promise.all(
    [1, 2, 3].map(async (n) => {
      const team = teamSchema.parse((await rpc(n, "get_conference_team")).data);
      views[n - 1] = {
        team,
        state: team.data,
        status: "",
        error: "",
        pending: false,
        conflict: false,
      };
      return new TeamSync(
        team,
        (name, args) => rpc(n, name, args),
        (view) => {
          views[n - 1] = view;
        },
      );
    }),
  );
  return { sessions, views };
}
async function settle(sessions: TeamSync[], views: TeamSyncView[]) {
  await vi.waitFor(() => expect(views.every((v) => !v.pending || v.error)).toBe(true));
  await Promise.all(sessions.map((s) => s.refresh(true)));
}
function receive(base: ConferenceState, doc: number) {
  const next = structuredClone(base);
  next.manifests[0]!.documents[doc]!.received = true;
  next.manifests[0]!.documents[doc]!.receivedAt = "1900-01-01";
  return next;
}
const audit = async () =>
  (await rpc(1, "get_conference_audit")).data as { action: string; actor_email: string }[];

it("keeps personal confirmations independent, accepts a peer explicitly, and does not undo the other account", async () => {
  const { sessions, views } = await clients();
  const change = (index: number, received: boolean, accept = false) => {
    const state = structuredClone(views[index]!.state),
      manifest = state.manifests[0]!;
    const peer = personalDocument(manifest.documents[0]!, uid(index + 1)).peerReceipt;
    state.manifests[0] = setPersonalReceipt(
      manifest,
      manifest.documents[0]!.id,
      uid(index + 1),
      received,
      "1900-01-01",
      accept ? peer : undefined,
    );
    sessions[index]!.change(state);
  };
  change(1, true);
  await settle(sessions, views);
  const original = views[0]!.state.manifests[0]!.documents[0]!;
  expect(original.received).toBe(true);
  expect(personalDocument(original, uid(1))).toMatchObject({
    received: false,
    peerReceipt: { id: uid(2) },
  });
  expect(personalDocument(original, uid(2))).toMatchObject({ received: true });
  change(0, true, true);
  await settle(sessions, views);
  const accepted = views[0]!.state.manifests[0]!.documents[0]!.receiptChecks!.find(
    (check) => check.id === uid(1),
  )!;
  expect(accepted).toMatchObject({
    received: true,
    acceptedFrom: uid(2),
    sourceReceivedAt: original.receiptChecks![0]!.receivedAt,
    email: "device1@example.invalid",
  });
  expect(accepted.receivedAt).not.toBe("1900-01-01");
  change(1, false);
  await settle(sessions, views);
  const after = views[0]!.state.manifests[0]!.documents[0]!;
  expect(after.received).toBe(true);
  expect(personalDocument(after, uid(1)).received).toBe(true);
  expect(personalDocument(after, uid(2)).received).toBe(false);
  // A stale acceptance cannot reuse the now revoked source's timestamp.
  const stale = structuredClone(views[2]!.state);
  stale.manifests[0] = setPersonalReceipt(
    stale.manifests[0]!,
    after.id,
    uid(3),
    true,
    "1900-01-01",
    original.receiptChecks![0],
  );
  expect(
    (await rpc(3, "save_team_conference_v2", { base_data: views[2]!.state, next_data: stale }))
      .error?.message,
  ).toContain("CONFERENCE_CONFLICT");
  expect(
    (await audit()).some(
      (event) =>
        event.action === "ctc_personal_accepted" && event.actor_email === "device1@example.invalid",
    ),
  ).toBe(true);
  sessions.forEach((session) => session.stop());
});
it("can undo a personal confirmation while its first save is still in flight", async () => {
  const { sessions, views } = await clients();
  const checked = structuredClone(views[0]!.state),
    manifest = checked.manifests[0]!;
  checked.manifests[0] = setPersonalReceipt(
    manifest,
    manifest.documents[0]!.id,
    uid(1),
    true,
    "1900-01-01",
  );
  sessions[0]!.change(checked);
  const undone = structuredClone(checked);
  undone.manifests[0] = setPersonalReceipt(
    undone.manifests[0]!,
    manifest.documents[0]!.id,
    uid(1),
    false,
    "1900-01-01",
  );
  sessions[0]!.change(undone);
  await settle(sessions, views);
  expect(views.every((view) => !view.pending && !view.error)).toBe(true);
  expect(views[0]!.state.manifests[0]!.documents[0]!.received).toBe(false);
  expect(
    views[0]!.state.manifests[0]!.documents[0]!.receiptChecks!.find((check) => check.id === uid(1))!
      .received,
  ).toBe(false);
  sessions.forEach((session) => session.stop());
});

it("invalidates approval suggestions after the NF changes, without losing the historical receipt", async () => {
  const { sessions, views } = await clients();
  const next = structuredClone(views[1]!.state),
    manifest = next.manifests[0]!;
  next.manifests[0] = setPersonalReceipt(
    manifest,
    manifest.documents[0]!.id,
    uid(2),
    true,
    "1900-01-01",
  );
  sessions[1]!.change(next);
  await settle(sessions, views);
  const oldReceipt = views[0]!.state.manifests[0]!.documents[0]!.receiptChecks![0]!;
  const staleBase = structuredClone(views[2]!.state);
  const edited = structuredClone(views[0]!.state);
  edited.manifests[0]!.documents[0]!.nf = "999-1";
  sessions[0]!.change(edited);
  await settle(sessions, views);
  const doc = views[0]!.state.manifests[0]!.documents[0]!;
  expect(doc.received).toBe(false);
  expect(personalDocument(doc, uid(1)).peerReceipt).toBeUndefined();
  expect(doc.receiptChecks).toContainEqual(oldReceipt);
  const staleAcceptance = structuredClone(staleBase);
  staleAcceptance.manifests[0] = setPersonalReceipt(
    staleAcceptance.manifests[0]!,
    doc.id,
    uid(3),
    true,
    "1900-01-01",
    oldReceipt,
  );
  expect(
    (await rpc(3, "save_team_conference_v2", { base_data: staleBase, next_data: staleAcceptance }))
      .error?.message,
  ).toContain("CONFERENCE_CONFLICT");
  sessions.forEach((session) => session.stop());
});

it("two members link concurrently and a stale creator scan keeps both personal associations", async () => {
  const { sessions, views } = await clients();
  for (const index of [1, 2]) {
    const next = structuredClone(views[index]!.state);
    next.manifests[0]!.demandUserIds = [uid(index + 1)];
    sessions[index]!.change(next);
  }
  sessions[0]!.change(receive(views[0]!.state, 0));
  await settle(sessions, views);
  expect(views.every((view) => !view.pending && !view.error)).toBe(true);
  for (let index = 0; index < 3; index++) {
    const state = views[index]!.state;
    expect(state.manifests).toHaveLength(1);
    expect(state.manifests[0]!.demandUserIds).toEqual([uid(2), uid(3)]);
    expect(state.manifests[0]!.createdBy).toBe(uid(1));
    expect(state.manifests[0]!.documents[0]).toMatchObject({ received: true, receivedBy: uid(1) });
    expect(
      selectOwnedRoutes(state.manifests, {
        email: `device${index + 1}@example.invalid`,
        userId: uid(index + 1),
      }),
    ).toHaveLength(1);
    sessions[index]!.stop();
  }
});

it("three people register their own demands concurrently while all sessions retain the whole team", async () => {
  const { sessions, views } = await clients();
  sessions.forEach((session, index) => {
    const next = structuredClone(views[index]!.state);
    next.manifests.push({
      ...pre(20 + index),
      createdBy: uid(4),
      createdByEmail: "device4@example.invalid",
    });
    session.change(next);
  });
  await settle(sessions, views);
  expect(peak).toBe(3);
  expect(
    views.every((view) => !view.pending && !view.error && view.state.manifests.length === 4),
  ).toBe(true);
  for (let index = 0; index < 3; index++) {
    expect(views[0]!.state.manifests.find((item) => item.id === pre(20 + index).id)).toMatchObject({
      createdBy: uid(index + 1),
      createdByEmail: `device${index + 1}@example.invalid`,
    });
    expect(
      selectOwnedRoutes(views[index]!.state.manifests, {
        email: `device${index + 1}@example.invalid`,
        userId: uid(index + 1),
      }),
    ).toHaveLength(index === 0 ? 2 : 1);
    sessions[index]!.stop();
  }
});

it("three simultaneous sessions receive different CTCs, converge and finish once with correct actors", async () => {
  const { sessions, views } = await clients();
  expect(views[0]!.team.members).toHaveLength(4);
  sessions.forEach((s, i) => s.change(receive(views[i]!.state, i)));
  await settle(sessions, views);
  expect(peak).toBe(3);
  expect(views.every((v) => !v.pending && !v.error)).toBe(true);
  expect(views[1]!.state).toEqual(views[0]!.state);
  expect(views[2]!.state).toEqual(views[0]!.state);
  expect(
    views[0]!.state.manifests[0]!.documents.every(
      (d) => d.received && d.receivedAt !== "1900-01-01",
    ),
  ).toBe(true);
  expect(views[0]!.state.manifests[0]!.finishedAt).toBeTruthy();
  const events = await audit();
  expect(events.filter((e) => e.action === "pre_finished")).toHaveLength(1);
  expect(
    events
      .filter((e) => e.action === "ctc_received")
      .map((e) => e.actor_email)
      .sort(),
  ).toEqual([1, 2, 3].map((n) => `device${n}@example.invalid`));
});
it("a CTC scanned in all three sessions is received and audited only once", async () => {
  const { sessions, views } = await clients();
  sessions.forEach((s, i) => s.change(receive(views[i]!.state, 0)));
  await settle(sessions, views);
  expect(peak).toBe(3);
  expect(
    views.every(
      (v) => v.state.manifests[0]!.documents.filter((d) => d.received).length === 1 && !v.error,
    ),
  ).toBe(true);
  expect((await audit()).filter((e) => e.action === "ctc_received")).toHaveLength(1);
});
it("combines different imports and rejects two concurrent attempts to register the same pre", async () => {
  let { sessions, views } = await clients();
  sessions.forEach((s, i) => {
    const next = structuredClone(views[i]!.state);
    next.manifests.push(pre(i + 2));
    s.change(next);
  });
  await settle(sessions, views);
  expect(views.every((v) => v.state.manifests.length === 4 && !v.error)).toBe(true);
  ({ sessions, views } = await clients());
  sessions.forEach((s, i) => {
    const next = structuredClone(views[i]!.state);
    const duplicate = pre(5);
    duplicate.driver = `Pessoa ${i}`;
    next.manifests.push(duplicate);
    s.change(next);
  });
  await settle(sessions, views);
  expect(views.filter((v) => v.conflict)).toHaveLength(2);
  expect(views.filter((v) => v.error.includes("Nenhuma duplicata"))).toHaveLength(2);
  const stored = (await rpc(1, "get_conference_team")).data.data;
  expect(stored.manifests.filter((m: { id: string }) => m.id === pre(5).id)).toHaveLength(1);
  expect((await audit()).filter((e) => e.action === "pre_added")).toHaveLength(4);
});
it("rejects duplicate CTCs across different pres without losing other successful changes", async () => {
  const { sessions, views } = await clients();
  sessions.forEach((s, i) => {
    const next = structuredClone(views[i]!.state),
      added = pre(i + 2);
    added.documents = [{ ...added.documents[0]!, ctc: "0000000999" }];
    next.manifests.push(added);
    s.change(next);
  });
  await settle(sessions, views);
  expect(views.filter((v) => v.conflict)).toHaveLength(2);
  expect((await rpc(1, "get_conference_team")).data.data.manifests).toHaveLength(2);
});
it("keeps incompatible field edits local instead of silently overwriting the winning NF", async () => {
  const { sessions, views } = await clients();
  sessions.forEach((s, i) => {
    const next = structuredClone(views[i]!.state);
    next.manifests[0]!.documents[0]!.nf = `${i + 100}-1`;
    s.change(next);
  });
  await settle(sessions, views);
  expect(views.filter((v) => v.conflict)).toHaveLength(2);
  const stored = (await rpc(1, "get_conference_team")).data.data;
  expect(["100-1", "101-1", "102-1"]).toContain(stored.manifests[0].documents[0].nf);
  expect((await audit()).filter((e) => e.action === "ctc_edited")).toHaveLength(1);
});
it("does not resurrect a pre when a stale device tries to receive a deleted CTC", async () => {
  const { sessions, views } = await clients();
  const next = structuredClone(views[0]!.state);
  next.manifests = [];
  sessions[0]!.change(next);
  await vi.waitFor(() => expect(views[0]!.pending).toBe(false));
  sessions[1]!.change(receive(views[1]!.state, 0));
  sessions[2]!.change(receive(views[2]!.state, 1));
  await settle(sessions, views);
  expect(views.filter((v) => v.conflict)).toHaveLength(2);
  expect((await rpc(1, "get_conference_team")).data.data.manifests).toEqual([]);
});
it("retries a lost response after commit without duplicate audit or undoing another devices receipt", async () => {
  const { sessions, views } = await clients();
  loseResponseFor = 1;
  sessions[0]!.change(receive(views[0]!.state, 0));
  sessions[1]!.change(receive(views[1]!.state, 1));
  // A lost response is a transport failure: retried quietly, never shown in red.
  await vi.waitFor(() => expect(views[0]!.reconnecting).toBe(true));
  expect(views[0]!.error).toBe("");
  await vi.waitFor(() => expect(views[1]!.pending).toBe(false));
  // Retry now instead of waiting for the automatic 5 s back-off.
  sessions[0]!.retry();
  await settle(sessions, views);
  expect(
    views.every(
      (v) =>
        !v.error &&
        !v.pending &&
        v.state.manifests[0]!.documents.filter((d) => d.received).length === 2,
    ),
  ).toBe(true);
  expect((await audit()).filter((e) => e.action === "ctc_received")).toHaveLength(2);
});

it("persists a fifty-manifest five-day spreadsheet while another client receives an existing CTC", async () => {
  const { sessions, views } = await clients();
  const headers = [
    "Manifesto",
    "Motivo",
    "Filial",
    "Dataemissao",
    "Placa",
    "Motorista",
    "CTRC",
    "Remet Nome",
    "Dest Nome",
    "NF",
    "Serie",
    "Volumes",
  ];
  const rows = Array.from({ length: 50 }, (_, i) => [
    String(60000000 + i),
    "DIS",
    "06",
    `${10 + Math.floor(i / 10)}/10/2026`,
    "ABC1D23",
    "ANA",
    String(1000000000 + i),
    "LAB",
    "CLIENTE",
    String(100 + i),
    "1",
    2,
  ]);
  const parsed = parseLuft108([{ name: "108", rows: [headers, ...rows] }]);
  const added = applyImports(views[0]!.state.manifests, parsed.drafts, "2026-10-15T00:00:00Z");
  expect(added.ok).toBe(true);
  if (!added.ok) return;
  sessions[0]!.change({ ...views[0]!.state, manifests: added.manifests });
  sessions[1]!.change(receive(views[1]!.state, 0));
  await settle(sessions, views);
  expect(views.every((v) => !v.error && !v.pending && v.state.manifests.length === 51)).toBe(true);
  const stored = views[2]!.state.manifests.filter((m) => /^\d{8}$/.test(m.id));
  expect(stored).toHaveLength(50);
  for (let day = 10; day <= 14; day++)
    expect(stored.filter((m) => m.issueDate === `2026-10-${day}`)).toHaveLength(10);
  expect(views[2]!.state.manifests.find((m) => m.id === pre().id)!.documents[0]!.received).toBe(
    true,
  );
  const count = await db.query<{ total: number }>(
    "select count(*)::int total from public.conference_audit where action='pre_added'",
  );
  expect(count.rows[0]!.total).toBe(50);
});

it("three clients converge when a route is remanifested while two unrelated CTCs are scanned", async () => {
  const original = { ...pre(9), id: "06059990", issueDate: "2026-10-13" };
  const setup = (await rpc(1, "get_conference_team")).data.data as ConferenceState;
  expect(
    (
      await rpc(1, "save_team_conference_v2", {
        base_data: setup,
        next_data: { ...setup, manifests: [...setup.manifests, original] },
      })
    ).error,
  ).toBeNull();
  const { sessions, views } = await clients();
  const next = structuredClone(views[0]!.state);
  next.manifests.push({
    ...pre(9),
    id: "06059991",
    issueDate: "2026-10-15",
    driver: "OUTRO MOTORISTA",
    documents: pre(9).documents.map((doc) => ({ ...doc, id: `new-${doc.id}` })),
  });
  sessions[0]!.change(next);
  sessions[1]!.change(receive(views[1]!.state, 0));
  sessions[2]!.change(receive(views[2]!.state, 1));
  await settle(sessions, views);
  expect(peak).toBe(3);
  expect(
    views.every((view) => !view.error && !view.pending && view.state.manifests.length === 3),
  ).toBe(true);
  expect(views[0]!.state).toEqual(views[2]!.state);
  expect(
    views[0]!.state.manifests
      .filter((m) => m.id.startsWith("060599"))
      .every((m) => m.documents.every((doc) => !doc.received)),
  ).toBe(true);
  const stale = structuredClone(setup);
  stale.manifests.push(original);
  const bad = structuredClone(stale);
  bad.manifests[1]!.documents[0]!.received = true;
  expect(
    (await rpc(3, "save_team_conference_v2", { base_data: stale, next_data: bad })).error?.message,
  ).toContain("CONFERENCE_CONFLICT");
});

it("archiving a long-finished pre does not disturb a device that has not refreshed yet", async () => {
  const finishedAt = new Date(Date.now() - 40 * 86400000).toISOString();
  const old = {
    ...pre(9),
    issueDate: "2026-08-01",
    finishedAt,
    documents: pre(9).documents.map((doc) => ({ ...doc, received: true, receivedAt: finishedAt })),
  };
  await db.query("update public.conference_states set data=$1 where user_id=$2", [
    { ...emptyConference, manifests: [pre(), old] },
    uid(1),
  ]);
  const { sessions, views } = await clients();
  expect((await rpc(2, "archive_conference_manifests", { min_days: 30 })).data).toBe(1);
  // Device 1 still holds the archived pre and scans a CTC of the open one.
  expect(views[0]!.state.manifests.map((m) => m.id)).toContain(old.id);
  sessions[0]!.change(receive(views[0]!.state, 0));
  await settle(sessions, views);
  for (const view of views) {
    expect(view.error).toBe("");
    expect(view.conflict).toBe(false);
    expect(view.state.manifests.map((m) => m.id)).toEqual([pre().id]);
    expect(view.state.manifests[0]!.documents[0]!.received).toBe(true);
  }
  const found = await rpc(3, "find_archived_conference_manifests", {
    manifest_ids: [],
    ctc_numbers: [old.documents[0]!.ctc],
    hashes: [],
  });
  expect((found.data as { manifest: { id: string } }[]).map((item) => item.manifest.id)).toEqual([
    old.id,
  ]);
});
