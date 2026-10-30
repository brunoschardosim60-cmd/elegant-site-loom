import { z } from "zod";
import { conferenceStateSchema, type ConferenceState } from "./conference-state";

export const teamSchema = z.object({
  sharedDemands: z.boolean().optional(),
  personalReceipts: z.boolean().optional(),
  teamId: z.guid(),
  name: z.string(),
  owner: z.boolean(),
  revision: z.number().int().nonnegative(),
  data: conferenceStateSchema,
  members: z.array(
    z.object({
      email: z.string(),
      userId: z.guid().optional(),
      owner: z.boolean(),
      pending: z.boolean(),
    }),
  ),
  invitation: z.object({ ownerEmail: z.string() }).nullable().optional(),
});
export type ConferenceTeam = z.infer<typeof teamSchema>;
const savedTeamSchema = z.object({
  revision: z.number().int().nonnegative(),
  data: conferenceStateSchema,
});
type Json = null | string | number | boolean | Json[] | { [key: string]: Json };
const encode = (value: unknown) => JSON.stringify(value);
const equal = (a: unknown, b: unknown) => encode(a) === encode(b);
const object = (v: Json | undefined): v is { [key: string]: Json } =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** Rebase only edits made while a save/read was in flight; never overwrite a
 * changed remote field or resurrect a deleted document. Mirrors the DB merge. */
function merge(b: Json | undefined, l: Json | undefined, r: Json | undefined): Json | undefined {
  if (equal(l, b)) return r;
  if (equal(r, b) || equal(l, r)) return l;
  if (b === undefined && object(l) && object(r) && "id" in l && l["id"] === r["id"])
    throw new Error("CONFERENCE_DUPLICATE");
  if (b === undefined || l === undefined || r === undefined) throw new Error("CONFERENCE_CONFLICT");
  if (object(b) && object(l) && object(r)) {
    const result: Record<string, Json> = {};
    for (const k of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])) {
      if (k === "finishedAt" && "documents" in l && "documents" in r) continue;
      if (
        ["receivedAt", "email"].includes(k) &&
        "received" in l &&
        "received" in r &&
        !("ctc" in l) &&
        ("documentVersion" in l || "documentVersion" in r)
      ) {
        if (l["received"] === true && r[k] !== undefined) result[k] = r[k];
        continue;
      }
      if (
        ["received", "receivedAt", "receivedBy", "receivedByEmail"].includes(k) &&
        "ctc" in l &&
        "ctc" in r &&
        ("receiptChecks" in l || "receiptChecks" in r)
      ) {
        if (r[k] !== undefined) result[k] = r[k];
        continue;
      }
      if (k === "demandUserIds" && "documents" in l && "documents" in r) {
        result[k] = [
          ...new Set([...(Array.isArray(l[k]) ? l[k] : []), ...(Array.isArray(r[k]) ? r[k] : [])]),
        ].sort();
        continue;
      }
      const v =
        k === "receivedAt" && l["received"] === r["received"]
          ? r["received"] === true
            ? (r[k] ?? l[k])
            : undefined
          : merge(b[k], l[k], r[k]);
      if (v !== undefined) result[k] = v;
    }
    return result;
  }
  if (Array.isArray(b) && Array.isArray(l) && Array.isArray(r)) {
    if ([...b, ...l, ...r].every((item) => object(item) && "id" in item)) {
      const result: Json[] = [],
        seen = new Set<string>();
      for (const item of [...r, ...l]) {
        const id = String((item as Record<string, Json>)["id"]);
        if (seen.has(id)) continue;
        seen.add(id);
        const find = (items: Json[]) =>
          items.find((candidate) => object(candidate) && String(candidate["id"]) === id);
        const value = merge(find(b), find(l), find(r));
        if (value !== undefined) result.push(value);
      }
      return result;
    }
    if ([...b, ...l, ...r].every((item) => typeof item === "string"))
      return [...new Set([...l, ...r])].sort();
  }
  throw new Error("CONFERENCE_CONFLICT");
}
export function mergeConference(
  base: ConferenceState,
  local: ConferenceState,
  remote: ConferenceState,
): ConferenceState {
  const state = conferenceStateSchema.parse(
    merge(JSON.parse(encode(base)), JSON.parse(encode(local)), JSON.parse(encode(remote))),
  );
  state.activity.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  state.activity = state.activity.slice(0, 20);
  // If two different documents were received together, the merged pre finishes.
  state.manifests = state.manifests.map((m) => {
    if (m.documents.length && m.documents.every((d) => d.received)) {
      const completed =
        remote.manifests.find((other) => other.id === m.id)?.finishedAt ??
        local.manifests.find((other) => other.id === m.id)?.finishedAt ??
        m.documents
          .map((d) => d.receivedAt ?? "")
          .sort()
          .at(-1);
      if (!m.finishedAt && completed) m.finishedAt = completed;
    } else delete m.finishedAt;
    return m;
  });
  return state;
}

type Rpc = (
  name: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
export type TeamSyncView = {
  team: ConferenceTeam;
  state: ConferenceState;
  status: string;
  error: string;
  conflict: boolean;
  pending: boolean;
};
export class TeamSync {
  private base: ConferenceState;
  private local: ConferenceState;
  private busy = false;
  private stopped = false;
  private failure = "";
  private collision = false;
  private refreshRetryAt = 0;
  private refreshFailures = 0;
  constructor(
    private team: ConferenceTeam,
    private rpc: Rpc,
    private publish: (view: TeamSyncView) => void,
  ) {
    this.base = team.data;
    this.local = team.data;
  }
  private emit() {
    if (!this.stopped)
      this.publish({
        team: this.team,
        state: this.local,
        status: this.failure
          ? this.pending()
            ? "Alterações ainda não salvas"
            : "Sincronização interrompida"
          : this.busy && this.pending()
            ? "Salvando…"
            : "Todos os dados salvos",
        error: this.failure,
        conflict: this.collision,
        pending: this.pending(),
      });
  }
  pending() {
    return !equal(this.local, this.base);
  }
  stop() {
    this.stopped = true;
  }
  change(state: ConferenceState) {
    if (this.stopped) return;
    this.local = conferenceStateSchema.parse(state);
    this.emit();
    void this.flush();
  }
  retry() {
    this.failure = "";
    this.collision = false;
    this.refreshRetryAt = 0;
    this.refreshFailures = 0;
    this.emit();
    if (this.pending()) void this.flush();
    else void this.refresh();
  }
  private fail(error: unknown, refreshing = false) {
    const message = String((error as { message?: string })?.message ?? error);
    this.collision = /CONFERENCE_CONFLICT|CONFERENCE_DUPLICATE|CONFERENCE_TEAM_CHANGED/.test(
      message,
    );
    // Read failures can recover automatically. A failed save or an actual
    // conflict still requires explicit action, preserving the local edits.
    this.refreshRetryAt =
      refreshing && !this.collision
        ? Date.now() + Math.min(60000, 5000 * 2 ** Math.min(this.refreshFailures++, 4))
        : 0;
    this.failure = /CONFERENCE_TEAM_CHANGED/.test(message)
      ? "Sua equipe mudou nesta sessão. Gere o PDF se precisar guardar alterações locais e recarregue para abrir os dados da equipe atual. Nenhum dado foi transferido automaticamente."
      : /CONFERENCE_TOTALS_REVIEW/.test(message)
        ? "Os totais diferem do cabeçalho. Revise o pré antes de salvar. As alterações locais foram preservadas."
        : /CONFERENCE_DUPLICATE/.test(message)
          ? "Outra pessoa já cadastrou esse pré, CTC ou foto. Nenhuma duplicata foi salva. Gere o PDF se precisar guardar as alterações locais e recarregue os dados."
          : this.collision
            ? "O mesmo campo foi alterado por outra pessoa ou o registro foi excluído. Gere o PDF para guardar as alterações locais antes de recarregar."
            : "Não foi possível sincronizar. Mantenha esta página aberta e tente novamente.";
  }
  async flush() {
    if (this.stopped || this.busy || this.failure || !this.pending()) return;
    this.busy = true;
    this.emit();
    try {
      while (!this.stopped && this.pending()) {
        const sent = this.local;
        const result = await this.rpc("save_team_conference", {
          base_data: this.base,
          next_data: sent,
        });
        if (this.stopped) return;
        if (result.error) throw result.error;
        const committed = savedTeamSchema.parse(result.data);
        this.local = mergeConference(sent, this.local, committed.data);
        this.base = committed.data;
        this.team = { ...this.team, ...committed };
        this.emit();
      }
    } catch (error) {
      this.fail(error);
    } finally {
      this.busy = false;
      this.emit();
    }
  }
  async refresh(force = false) {
    if (
      this.stopped ||
      this.busy ||
      (this.failure &&
        (this.collision || !this.refreshRetryAt || (!force && Date.now() < this.refreshRetryAt)))
    )
      return;
    this.busy = true;
    let succeeded = false;
    try {
      if (!force) {
        const version = await this.rpc("get_conference_revision", {});
        if (this.stopped) return;
        if (version.error) throw version.error;
        const stamp = z
          .object({ teamId: z.guid(), revision: z.number().int().nonnegative() })
          .parse(version.data);
        if (stamp.teamId !== this.team.teamId) throw new Error("CONFERENCE_TEAM_CHANGED");
        if (stamp.revision === this.team.revision) {
          succeeded = true;
          return;
        }
      }
      const result = await this.rpc("get_conference_team", { accept_invitation: false });
      if (this.stopped) return;
      if (result.error) throw result.error;
      const fresh = teamSchema.parse(result.data);
      if (fresh.teamId !== this.team.teamId) throw new Error("CONFERENCE_TEAM_CHANGED");
      if (fresh.revision !== this.team.revision) {
        this.local = mergeConference(this.base, this.local, fresh.data);
        this.base = fresh.data;
      }
      this.team = fresh;
      succeeded = true;
    } catch (error) {
      this.fail(error, true);
    } finally {
      if (succeeded) {
        this.failure = "";
        this.collision = false;
        this.refreshRetryAt = 0;
        this.refreshFailures = 0;
      }
      this.busy = false;
      this.emit();
      if (!this.failure) void this.flush();
    }
  }
}
