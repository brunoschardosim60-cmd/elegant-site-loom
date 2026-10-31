import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  isTransientFailure,
  TeamSync,
  type ConferenceTeam,
  type TeamSyncView,
} from "@/lib/conference-team";
import { emptyConference, type ConferenceState } from "@/lib/conference-state";

const team = {
  teamId: "30000000-0000-4000-8000-000000000001",
  revision: 1,
  owner: true,
  members: [],
  data: emptyConference,
} as unknown as ConferenceTeam;
const offline = { data: null, error: { message: "TypeError: Failed to fetch" } };
const changed: ConferenceState = {
  ...emptyConference,
  activity: [{ id: 1, title: "t", description: "d", time: "10:00" }],
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(rpc: (name: string, args: Record<string, unknown>) => Promise<unknown>) {
  const views: TeamSyncView[] = [];
  const sync = new TeamSync(team, rpc as never, (view) => views.push(view));
  return { sync, last: () => views.at(-1)! };
}

it("classifies only network-level failures as transient", () => {
  expect(isTransientFailure("TypeError: Failed to fetch")).toBe(true);
  expect(isTransientFailure("AbortError: signal timed out")).toBe(true);
  expect(isTransientFailure("JWT expired")).toBe(true);
  expect(isTransientFailure("CONFERENCE_CONFLICT")).toBe(false);
  expect(isTransientFailure("CONFERENCE_DUPLICATE")).toBe(false);
  expect(isTransientFailure("Equipe não autorizada")).toBe(false);
});

it("a single failed poll shows a neutral reconnecting state, never the red error", async () => {
  let fail = true;
  const { sync, last } = setup(async (name) =>
    fail
      ? offline
      : name === "get_conference_revision"
        ? { data: { teamId: team.teamId, revision: 1 }, error: null }
        : { data: team, error: null },
  );
  await sync.refresh();
  expect(last().error).toBe("");
  expect(last().reconnecting).toBe(true);
  expect(last().status).toBe("Sem conexão · tentando novamente…");
  await sync.refresh(); // within the back-off window: no new request, still neutral
  fail = false;
  vi.advanceTimersByTime(5000);
  await sync.refresh();
  expect(last().reconnecting).toBe(false);
  expect(last().status).toBe("Todos os dados salvos");
});

it("shows the error only after the automatic attempts are exhausted", async () => {
  const { sync, last } = setup(async () => offline);
  for (let attempt = 0; attempt < 3; attempt++) {
    await sync.refresh(true);
    expect(last().error).toBe("");
  }
  await sync.refresh(true);
  expect(last().error).toMatch(/Sem conexão com o banco há mais de 30 segundos/);
  expect(last().reconnecting).toBe(false);
});

it("re-sends a save that failed on the network without user action", async () => {
  let calls = 0;
  const { sync, last } = setup(async (_name, args) => {
    calls++;
    return calls === 1 ? offline : { data: { revision: 2, data: args["next_data"] }, error: null };
  });
  sync.change(changed);
  await vi.waitFor(() => expect(calls).toBe(1));
  expect(last().error).toBe("");
  expect(last().status).toBe("Sem conexão · as alterações serão salvas ao reconectar");
  await vi.advanceTimersByTimeAsync(5000);
  await vi.waitFor(() => expect(sync.pending()).toBe(false));
  expect(calls).toBe(2);
  expect(last().status).toBe("Todos os dados salvos");
});

it("still reports a real conflict immediately and waits for the user", async () => {
  let calls = 0;
  const { sync, last } = setup(async () => {
    calls++;
    return { data: null, error: { message: "CONFERENCE_CONFLICT" } };
  });
  sync.change(changed);
  await vi.waitFor(() => expect(last().conflict).toBe(true));
  expect(last().error).not.toBe("");
  await vi.advanceTimersByTimeAsync(60000);
  expect(calls).toBe(1);
});
