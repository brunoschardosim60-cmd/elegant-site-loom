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
- Keep conference state in React memory only during this prototype phase; no browser persistence or backend is configured.
- Isolate CTC parsing and conference transitions in a browser-safe domain module so barcode rules can be tested independently.
- Confer by the Luft CTC identifier (10 digits), as requested by the user. Preserve leading zeroes and never derive a CTC from a CT-e or NF-e key.
- Show one document editor at a time with an Add CTC button; keep all photo-imported documents accessible without rendering a long list of forms.
- Use a single operational workspace with view tabs for the ongoing conference, completed manifests and session occurrences to preserve live scan state.
