<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

## Application rules

- Persist registered conference state in Supabase behind authentication. Team members are confirmed accounts admitted by explicit email invitation, without a fixed member cap; shared RPCs must verify membership and all tables keep RLS. Preserve the owner's original records and never merge unrelated personal accounts automatically. Use transactional three-way merges, server-side duplicate checks and immutable authenticated audit; reject conflicting field edits. Never persist unsaved import drafts or photos or expose service-role keys.
- Isolate CTC parsing and conference transitions in a browser-safe domain module so barcode rules can be tested independently.
- Confer by the Luft CTC identifier (10 digits), as requested by the user. Preserve leading zeroes and never derive a CTC from a CT-e or NF-e key.
- Show one document editor at a time with an Add CTC button; keep all photo-imported documents accessible without rendering a long list of forms.
- Use a single operational workspace with view tabs for the ongoing conference, completed manifests and session occurrences to preserve live scan state.
- A CTC can be remanifested on a different original issue date, including to another driver. Preserve each route attempt and its receipt/audit history. Only the most recent dated attempt is a scan target; earlier unreceived attempts are shown as remanifested, never falsely marked received. Same-day, undated, repeated manifesto IDs and repeated NF rows still require resolution. Enforce this rule in both import validation and the transactional shared RPC, including stale-client receipt checks.
- Authenticated users start directly in their own records, without a Minhas demandas tab or per-member overview cards. Only the top account-bar Equipe control opens the same workspace with everyone's combined totals and normal manifest list; that team view is read-only for conference records, with a return control in the same top-bar position. These are display scopes, not separate databases or new permission boundaries. Always validate imports/scans against the whole team, resolve remanifestations globally before filtering, and persist the complete canonical snapshot, never a filtered subset. Manifest creators remain immutable; last editor and receipt actor are separately assigned by the authenticated shared RPC, visible with time, and recoverable from immutable audit where evidence exists. Client-supplied actor names never override server attribution.
- Keep the personal view compact: hide the manifest's Atualizado por line in personal Conference and Pending lists. Show that line in the team consultation and keep authenticated audit intact. Receipt authors remain visible independently.
