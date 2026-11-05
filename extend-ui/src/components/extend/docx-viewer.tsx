// Stand-in for extend-ui's @extend/docx-viewer, which file-system.tsx lazy-loads for
// its gallery stage and viewer dialog. EverOne previews files in its own pane
// (viewer.js) and never hands the component a file URL, so those viewers are
// never shown and the real one (and its renderer dependencies) isn't bundled.
export function DocxViewerPreview(_props: Record<string, unknown>) {
  return null
}
