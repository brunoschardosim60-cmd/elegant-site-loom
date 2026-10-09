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
- Isolate CT-e parsing and conference transitions in a browser-safe domain module so barcode rules can be tested independently.
- Require explicit CT-e identifiers on manifest documents; never derive a CT-e number from a Luft internal CTC identifier.
- Use a single operational workspace with view tabs for the ongoing conference, completed manifests and session occurrences to preserve live scan state.
