// Entry point of vendor/extend-ui/file-system.js: mounts extend-ui's File
// System (Finder) component into a plain DOM element, for the build-less SPA
// at the repo root (see app.js).
import * as React from "react"
import { createRoot } from "react-dom/client"

import {
  FileSystem,
  type FileSystemController,
  type FileSystemProps,
} from "@/components/extend/file-system"
import "./styles.css"

export type {
  FileSystemController,
  FileSystemFileItem,
  FileSystemFolderItem,
  FileSystemItem,
  FileSystemLoadChildrenArgs,
  FileSystemLoadChildrenResult,
  FileSystemProps,
} from "@/components/extend/file-system"

// The component's dark styles key off a .dark class (shadcn's convention);
// the host page follows prefers-color-scheme instead.
function syncDarkClass() {
  const query = window.matchMedia("(prefers-color-scheme: dark)")
  const apply = () =>
    document.documentElement.classList.toggle("dark", query.matches)
  apply()
  query.addEventListener("change", apply)
}

let darkClassSynced = false

export type FileSystemMount = {
  /** Re-renders with new props; pass a new `key` to start from scratch. */
  render(props: FileSystemProps & { key?: React.Key }): void
  unmount(): void
} & FileSystemController

export function mountFileSystem(
  container: HTMLElement,
  props: FileSystemProps & { key?: React.Key }
): FileSystemMount {
  if (!darkClassSynced) {
    darkClassSynced = true
    syncDarkClass()
  }
  container.classList.add("extend-ui")
  const root = createRoot(container)
  // The controller of whichever component the latest render mounted.
  const controller: { current: FileSystemController | null } = {
    current: null,
  }
  const render = ({ key, ...rest }: FileSystemProps & { key?: React.Key }) =>
    root.render(<FileSystem key={key} {...rest} controllerRef={controller} />)
  render(props)
  return {
    render,
    unmount: () => root.unmount(),
    reloadFolder: async (path) => controller.current?.reloadFolder(path),
    select: (path) => controller.current?.select(path),
  }
}
