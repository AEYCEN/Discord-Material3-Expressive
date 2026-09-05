# Material 3 Expressive for Discord

A Material-You-inspired dark theme for Discord: primary-tinted surface tiers,
three colour roles, mono for identifiers. Built for [Vencord](https://vencord.dev).

One seed hue drives every surface and accent — change `--t-hue` and the whole
theme retunes.

## Install (Vencord)

1. Open **Settings → Vencord → Themes → Online Themes**
2. Add:

   ```
   https://discord-material3-expressive.aeycen.dev/main.css
   ```

To customise, copy [`Material3-Expressive-v1-Vencord.css`](Material3-Expressive-v1-Vencord.css)
into **Settings → Vencord → Themes → Edit QuickCSS** instead. It imports the
same stylesheet and exposes every `--t-*` token with its default in a comment.
Delete a line to fall back to its default.

Either way the theme updates itself: the stylesheet is rebuilt and republished
on every push, so a Discord class-name change reaches you on the next restart.

## Development

```bash
npm install
npm run build     # -> public/main.css (published) and the root distributable
npm run watch     # recompile on save
npm run test      # unminified build in test/ for eyeballing
```

On Windows, PowerShell may refuse these with *"npm.ps1 ist nicht digital
signiert"* / *"cannot be loaded because it is not digitally signed"*. That is the
execution policy blocking npm's PowerShell shim, and if it comes from Group
Policy (`Get-ExecutionPolicy -List` shows `AllSigned` under `MachinePolicy`) you
cannot override it locally. Use the batch shims instead — `npm.cmd run build` —
or run the commands from Git Bash.

### Layout

| Path | What it is |
| --- | --- |
| `src/main.scss` | The theme. Contains no class hashes. |
| `src/backend/_classes.scss` | Every hashed Discord class, once. |
| `src/backend/_mixins.scss` | `tone()` — modern-syntax `hsl()` Sass won't rewrite. |
| `src/start/_index.scss` | Version, URLs, metadata. Single source of truth. |
| `dist/*.scss` | Sources for the user-facing distributables. |
| `public/` | Build output, published to GitHub Pages. |

### When Discord rotates a class name

Nothing in `src/main.scss` contains a hash — every selector goes through
`#{c(...)}` and resolves in `src/backend/_classes.scss`. A rotation is a
one-line change there.

Most entries mirror [ClearVision v7](https://github.com/ClearVision/ClearVision-v7)'s
map, so you usually do not have to find the new hash yourself:

```bash
npm run classes:check   # report every class whose upstream value moved
npm run classes:sync    # write those values into the map
```

Entries marked `// UNION` or `// LOCAL` have no upstream equivalent and are
maintained by hand; `classes:sync` never touches them.

A value may also be a list, which compiles to `:is(a, b)`. Use it while Discord
rolls a change out and both the old and the new build are live.

## Credits

The class-lookup machinery and the class map are derived from
[ClearVision v7](https://github.com/ClearVision/ClearVision-v7) (Apache-2.0).
See [NOTICE](NOTICE).

## Licence

Apache-2.0. See [LICENSE](LICENSE).
