# Local browser LaTeX editor

Double-click `start-editor.cmd` to open **LaTeX Studio** at http://127.0.0.1:4380. The editor runs on this computer. Node.js, the portable Tectonic compiler in `.artifacts/latex-editor/tools`, and the repository's npm dependencies are required. On a new checkout, run `npm install` first.

## Work with different documents

Click the project name at the top, or use the **File** menu:

- **New document** creates an editable `main.tex` in a separate local project folder.
- **Open local folder** opens an existing folder by its full path. Inspect the folder, choose the main `.tex` file, and open it. Saves update that file in the original folder.
- **Import files** or **Import folder** copies a document and its images, bibliography, fonts, and other supported files into a new local project. Folder imports preserve subfolders. Choose the main `.tex` file before importing. Saves update this imported copy.
- **Recent projects** reopens any previously opened document, including the original proposal. The selected document is remembered when the editor restarts.

Main files can have any name, such as `report.tex`, `thesis.tex`, or `main.tex`. Several documents in one folder can be opened separately by choosing a different main file. Each document keeps its own source, compilation jobs, latest successful PDF, and preview reading position. Browser tabs remain tied to their project when another tab switches documents.

The file tree lists the current project's files, including subfolders. The chosen main `.tex` file is editable; click other files for a read-only preview. Included `.tex`, `.sty`, `.cls`, bibliography, image, and font files are copied into a fresh local build snapshot for each compilation. Changes to these supporting files on disk are picked up on the next build.

## Edit and compile

Changes save automatically. **Auto** starts a build after you pause typing. **Ctrl+Enter** recompiles, **Ctrl+S** saves, and **File → Download PDF** exports the result. Compilation errors keep that project's previous good PDF visible. If another application changes the main source, reload it before saving to avoid overwriting those changes.

The PDF scrolls continuously through its pages. The page number follows scrolling and can also jump directly to a page. Zoom and reading position survive successful builds and are saved separately for each document.

The source toolbar supports bold, italic, sections, lists, comments, undo, and redo. Click a heading in the outline to jump to its source line. **Layout** switches between split, code, and PDF views. On small screens use the **Code** and **PDF** tabs.

Tectonic uses a shared local package cache and downloads missing TeX packages when needed. The document is compiled locally. To use cached packages only, start with `-Offline`. This compiler supports the XeTeX/Tectonic toolchain; projects requiring shell escape or separate external tools need a compatible local workflow.

## Launch a specific document

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\latex-editor\start-editor.ps1 -ProjectFolder 'D:\Documents\My report' -MainFile 'report.tex'
```

`-MainFile` is optional: the editor chooses a likely main document automatically and lets you choose another from the project dialog. `-Port 4381` starts another instance; `-NoBrowser` starts without opening a browser; `-Offline` disables package downloads for a newly started server.

The optional ignored `editor.config.local.json` beside the launcher supplies an initial folder:

```json
{
  "projectFolder": "D:\\Documents\\My report",
  "mainFile": "report.tex"
}
```

The launcher reuses the running editor. Project history, imported documents, build output, compiler cache, and startup logs live under `.artifacts/latex-editor`. Source and image files in opened folders remain there; the compiler works from local snapshots.

## Checks

```powershell
node latex-editor/editor-tests.mjs
node latex-editor/projects-tests.mjs
node latex-editor/browser-smoke.mjs
node latex-editor/projects-browser-smoke.mjs
```
