# extend-ui File System, built for the SPA

The SPA's listing is the [File System (Finder)](https://www.extend.ai/ui/docs/components/file-system)
component of [extend-ui](https://github.com/extend-hq/ui) (MIT). It is a
React + Tailwind + shadcn component, while the SPA has no build step, so this
directory builds it once into a self-contained ES module plus stylesheet that
are committed under [`vendor/extend-ui/`](../vendor/extend-ui/) and loaded
directly by `index.html` / `app.js`:

```js
import { mountFileSystem } from "./vendor/extend-ui/file-system.js";

const listing = mountFileSystem(element, { items, defaultView: "list", … });
listing.render({ key: 2, items: otherItems, … }); // a new key remounts
```

## Rebuilding

After changing anything here:

```bash
npm ci --prefix extend-ui
npm run build --prefix extend-ui      # writes ../vendor/extend-ui/
npm run typecheck --prefix extend-ui
```

and commit the rebuilt `vendor/extend-ui/` together with the source change.

## What's in here

* `src/components/extend/file-system.tsx`, `file-thumbnail.tsx` and the
  shadcn primitives in `src/components/ui/` were installed with the shadcn
  CLI (`npx shadcn@latest add @extend/file-system`, `components.json`:
  `new-york` style, `lucide` icons). Imports of `cn` were pointed at
  `src/lib/utils.ts`.
* `pdf-viewer.tsx`, `docx-viewer.tsx`, `pptx-viewer.tsx`, `xlsx-viewer.tsx`
  are stubs: the component only lazy-loads those viewers for file URLs, and
  EverOne previews files in its own pane instead (it never gives the
  component a URL), so the real viewers and their renderers aren't bundled.
* `src/main.tsx` is the bundle's entry point (`mountFileSystem`).
* `src/styles.css` + `vite.config.ts` keep the styles from leaking into the
  page: Tailwind's preflight reset and shadcn's theme variables apply only
  within `@scope (.extend-ui, [data-slot])` — the mounted component plus the
  menus/dialogs it portals to `<body>`. In the other direction, the page's
  own element rules (`button`, `a`, …) in `../styles.css` exclude the same
  scope.

## Patches to file-system.tsx

The upstream source is in the first commit that added this directory; every
change since is marked with an `EverOne patch` comment:

* **Folders in the list view.** Upstream the list view's tree is built from
  file paths only, so empty folders and lazy folders (`hasChildren`, not
  loaded yet) don't show up. Folders are now rows of their own, and a lazy
  folder gets a "Loading…" placeholder child, so it can be expanded.
* **Lazy loading in the list view.** Upstream `loadChildren` only runs when
  navigating into a folder or selecting it. Expanding a lazy folder in the
  tree now loads its children too. The tree's decoration and selection
  callbacks read the latest index through a ref (the tree reads its options
  only once), so lazily loaded rows get their columns and can be selected.
* **`onFolderOpen`** — replaces the built-in navigation into a folder, like
  `onFileOpen` does for files. EverOne never navigates: the listing's root
  stays the drive's, and the selected folder is the one New Folder, Delete
  Folder and Upload act on.
* **`controllerRef`** (`FileSystemController`, also on the object
  `mountFileSystem` returns) — `reloadFolder(path)` fetches a folder's
  children anew after they changed (and opens the folder), `select(path)`
  selects an entry (opening the folders above it).
* **No navigation, view switcher or title in the header.** The Back /
  Forward buttons, the current folder's name (and so the `title` prop) and
  the view switcher (and so `onViewChange`) are gone; the header keeps sort,
  filter and search. The view is set by the host (`defaultView` / `view`).
* **`actions`** (`FileSystemAction[]`) — the host's buttons at the left of
  the header (EverOne's New Folder, Delete Folder and Upload): `id` (the
  button's `data-action`), `label`, `title`, `icon` (`"folderPlus"`,
  `"folderMinus"` or `"upload"`), `disabled` and `onSelect`. They're styled
  like the sort select's trigger. Below 520px of width they collapse into a
  "Tools" menu, and below iPad width they take the inline search's room (it
  collapses into its popover, as below 560px).
* **`dateColumn`** — `"createdAt"` makes the list view's date column "Date
  Created" (sorting by it); default `"updatedAt"` ("Date Modified").
* **`emptyLabel`** — the empty-folder message.
* **`originalName`** on files — when `name` is a shortened display name,
  the file type (icon, kind, MIME fallback) is read from `originalName`.
* **Date-only timestamps** (`"2021-03-04"`) are shown as just the day, in
  UTC, instead of a time in the local zone that can shift the day.
* A folder given with `hasChildren: false` and no children shows "0 items".
