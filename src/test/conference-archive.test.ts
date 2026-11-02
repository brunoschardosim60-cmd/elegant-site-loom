import { describe, expect, it, vi } from "vitest";
import {
  archiveFinished,
  conferenceBytes,
  findArchived,
  missingRpc,
} from "@/lib/conference-archive";
import { TeamSync, type ConferenceTeam } from "@/lib/conference-team";
import { emptyConference } from "@/lib/conference-state";

const missing = { data: null, error: { code: "PGRST202", message: "Could not find the function" } };

describe("archive client before and after the migration", () => {
  it("treats a missing archive RPC as an empty archive instead of an error", async () => {
    const rpc = vi.fn(async () => missing);
    expect(await archiveFinished(rpc)).toBe(0);
    expect(await findArchived(rpc, { ctcs: ["0000000001"] })).toEqual([]);
    expect(missingRpc({ message: "boom" })).toBe(false);
  });

  it("sends only well-formed, de-duplicated keys and skips empty lookups", async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    expect(await findArchived(rpc, { ctcs: ["", "12"], hashes: ["x"] })).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
    await findArchived(rpc, {
      ids: ["DI0000000001", "DI0000000001"],
      ctcs: ["0000000001", "0000000001", "abc"],
      hashes: ["A".repeat(64)],
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("find_archived_conference_manifests", {
      manifest_ids: ["DI0000000001"],
      ctc_numbers: ["0000000001"],
      hashes: ["a".repeat(64)],
    });
  });

  it("propagates real failures so the caller can keep the live save as the guard", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "network down" } }));
    await expect(archiveFinished(rpc)).rejects.toMatchObject({ message: "network down" });
  });

  it("measures the stored size in bytes, counting accented characters", () => {
    expect(conferenceBytes(emptyConference)).toBe(JSON.stringify(emptyConference).length);
    const accented = {
      ...emptyConference,
      activity: [{ id: 1, title: "ç", description: "", time: "" }],
    };
    expect(conferenceBytes(accented)).toBe(JSON.stringify(accented).length + 1);
  });

  it("falls back to the original save RPC once when the v2 RPC is missing", async () => {
    const team: ConferenceTeam = {
      teamId: "30000000-0000-4000-8000-000000000001",
      revision: 1,
      owner: true,
      members: [],
      data: emptyConference,
    } as unknown as ConferenceTeam;
    const calls: string[] = [];
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push(name);
      if (name === "save_team_conference_v2") return missing;
      return { data: { revision: 2, data: args["next_data"] }, error: null };
    });
    const sync = new TeamSync(team, rpc, () => {});
    sync.change({ ...emptyConference, issues: [] });
    sync.change({
      ...emptyConference,
      activity: [{ id: 1, title: "t", description: "d", time: "10:00" }],
    });
    await vi.waitFor(() => expect(sync.pending()).toBe(false));
    expect(calls[0]).toBe("save_team_conference_v2");
    expect(calls.filter((name) => name === "save_team_conference_v2")).toHaveLength(1);
    expect(calls.at(-1)).toBe("save_team_conference");
  });
});
