import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, expect, it, vi } from "vitest";
import { TeamPanel } from "@/components/team-panel";
import type { ConferenceTeam } from "@/lib/conference-team";
const team: ConferenceTeam = {
  teamId: "00000000-0000-4000-8000-000000000001",
  name: "Equipe",
  owner: true,
  members: [{ email: "owner@example.com", owner: true, pending: false }],
  revision: 1,
  data: { manifests: [], activity: [], issues: [] },
};
afterEach(cleanup);
const auditEvent = (id: number, manifest_id = "06052233") => ({
  id,
  actor_email: "operator@example.invalid",
  occurred_at: "2026-10-15T03:00:00Z",
  manifest_id,
  action: "ctc_received",
  details: { ctc: String(id).padStart(10, "0") },
});
it("paginates the applied history query rather than unsent input", async () => {
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({
      data: Array.from({ length: 100 }, (_, n) => auditEvent(200 - n)),
      error: null,
    })
    .mockResolvedValue({ data: [], error: null });
  render(
    <TeamPanel
      client={{ rpc } as unknown as SupabaseClient}
      team={team}
      open
      selectedPre="06052233"
      onOpenChange={() => {}}
      onRefresh={() => {}}
    />,
  );
  await screen.findByRole("button", { name: "Mais antigas" });
  fireEvent.change(screen.getByRole("textbox", { name: "Filtrar histórico por pré" }), {
    target: { value: "06052234" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Mais antigas" }));
  await waitFor(() =>
    expect(rpc).toHaveBeenLastCalledWith("get_conference_audit", {
      pre_id: "06052233",
      before_id: 101,
    }),
  );
});
it("does not present the previous manifest history as results of a failed new query", async () => {
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({ data: [auditEvent(1)], error: null })
    .mockResolvedValueOnce({ data: null, error: { message: "offline" } });
  render(
    <TeamPanel
      client={{ rpc } as unknown as SupabaseClient}
      team={team}
      open
      selectedPre="06052233"
      onOpenChange={() => {}}
      onRefresh={() => {}}
    />,
  );
  await screen.findByText("06052233 · 0000000001");
  fireEvent.change(screen.getByRole("textbox", { name: "Filtrar histórico por pré" }), {
    target: { value: "06052234" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Consultar" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Não foi possível carregar o histórico",
  );
  expect(screen.queryByText("06052233 · 0000000001")).not.toBeInTheDocument();
  expect(screen.queryByText(/Nenhuma ação registrada/)).not.toBeInTheDocument();
});
it("prepares a named email invitation only on submit and tells the owner how the person joins", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: team, error: null }),
    refresh = vi.fn();
  render(
    <TeamPanel
      client={{ rpc } as unknown as SupabaseClient}
      team={team}
      open
      onOpenChange={() => {}}
      onRefresh={refresh}
    />,
  );
  expect(rpc).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("textbox", { name: "E-mail da pessoa" }), {
    target: { value: "coworker@example.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Liberar acesso à equipe" }));
  await waitFor(() =>
    expect(rpc).toHaveBeenCalledExactlyOnceWith("invite_conference_member", {
      member_email: "coworker@example.com",
    }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent("criar e confirmar a conta");
  expect(refresh).toHaveBeenCalledOnce();
});
it("keeps audit discreet, filters by pre and shows reliable actor and NF changes on demand", async () => {
  const rpc = vi.fn().mockResolvedValue({
    data: [
      {
        id: 1,
        actor_email: "coworker@example.com",
        occurred_at: "2026-10-13T03:00:00Z",
        manifest_id: "DI00123456789",
        action: "ctc_edited",
        details: { ctc: "0000000001", before: { nf: "123" }, after: { nf: "456" } },
      },
    ],
    error: null,
  });
  render(
    <TeamPanel
      client={{ rpc } as unknown as SupabaseClient}
      team={team}
      open
      selectedPre="DI00123456789"
      onOpenChange={() => {}}
      onRefresh={() => {}}
    />,
  );
  expect(await screen.findByText(/coworker@example.com/)).toBeInTheDocument();
  expect(rpc).toHaveBeenLastCalledWith("get_conference_audit", {
    pre_id: "DI00123456789",
    before_id: null,
  });
  expect(screen.getByText("NF: 123 → 456")).toBeInTheDocument();
  expect(screen.getByText("Ver alterações")).toBeInTheDocument();
});
it("offers invitations only to owners, without a displayed count or a fixed cap", () => {
  const rpc = vi.fn();
  const first = render(
    <TeamPanel
      client={{ rpc } as unknown as SupabaseClient}
      team={{ ...team, owner: false }}
      open
      onOpenChange={() => {}}
      onRefresh={() => {}}
    />,
  );
  expect(screen.queryByRole("button", { name: "Liberar acesso à equipe" })).not.toBeInTheDocument();
  first.unmount();
  render(
    <TeamPanel
      client={{ rpc } as unknown as SupabaseClient}
      team={{
        ...team,
        members: [
          ...team.members,
          { email: "two@example.com", owner: false, pending: false },
          { email: "three@example.com", owner: false, pending: true },
        ],
      }}
      open
      onOpenChange={() => {}}
      onRefresh={() => {}}
    />,
  );
  expect(screen.getByRole("button", { name: "Liberar acesso à equipe" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Pessoas" })).toBeInTheDocument();
  expect(screen.queryByText(/três pessoas|\/3/)).not.toBeInTheDocument();
  expect(rpc).not.toHaveBeenCalled();
});

const ownerId = "00000000-0000-4000-8000-0000000000aa";
const roleTeam = (role: ConferenceTeam["role"], owner = role === "owner"): ConferenceTeam => ({
  ...team,
  owner,
  role,
  settings: { branches: ["06"], reasons: ["DIS"] },
  members: [
    { email: "owner@example.com", userId: ownerId, owner: true, pending: false, role: "owner" },
    {
      email: "admin@example.com",
      userId: "00000000-0000-4000-8000-0000000000bb",
      owner: false,
      pending: false,
      role: "admin",
    },
    {
      email: "conf@example.com",
      userId: "00000000-0000-4000-8000-0000000000cc",
      owner: false,
      pending: false,
      role: "conferente",
    },
  ],
});
const renderPanel = (value: ConferenceTeam, accountId: string) => {
  const rpc = vi.fn().mockResolvedValue({ data: {}, error: null });
  const onRefresh = vi.fn();
  render(
    <TeamPanel
      client={{ rpc } as unknown as SupabaseClient}
      team={value}
      open
      onOpenChange={() => {}}
      onRefresh={onRefresh}
      accountId={accountId}
    />,
  );
  return { rpc, onRefresh };
};

it("lets the owner change a member's role, remove members and save the 108 filter", async () => {
  const { rpc, onRefresh } = renderPanel(roleTeam("owner"), ownerId);
  fireEvent.change(screen.getByLabelText("Papel de conf@example.com"), {
    target: { value: "leitura" },
  });
  await waitFor(() =>
    expect(rpc).toHaveBeenCalledWith("set_conference_member_role", {
      member_email: "conf@example.com",
      new_role: "leitura",
    }),
  );
  expect(screen.getAllByRole("button", { name: "Remover" })).toHaveLength(2);
  fireEvent.change(screen.getByLabelText("Filiais"), { target: { value: "06, 12;26" } });
  fireEvent.change(screen.getByLabelText("Motivos"), { target: { value: "DIS" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar configuração" }));
  await waitFor(() =>
    expect(rpc).toHaveBeenCalledWith("set_conference_settings", {
      branch_codes: ["06", "12", "26"],
      reason_codes: ["DIS"],
    }),
  );
  expect(onRefresh).toHaveBeenCalled();
});

it("lets an administrator manage conferentes but not roles, other admins or themselves", () => {
  renderPanel(roleTeam("admin"), "00000000-0000-4000-8000-0000000000bb");
  expect(screen.queryByLabelText("Papel de conf@example.com")).not.toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Remover" })).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Liberar acesso à equipe" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Salvar configuração" })).toBeInTheDocument();
});

it("shows conferentes the roles without any management controls", () => {
  renderPanel(roleTeam("conferente"), "00000000-0000-4000-8000-0000000000cc");
  expect(screen.queryByRole("button", { name: "Remover" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Liberar acesso à equipe" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Salvar configuração" })).not.toBeInTheDocument();
  expect(screen.getAllByText("Administrador").length).toBeGreaterThan(0);
});
