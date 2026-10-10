# Code Atlas for VS Code

Turn Python and C source into a visual map beside your editor. Code Atlas is designed for reading robotics, AI locomotion, Raspberry Pi, and STM32 projects.

Open a `.py`, `.c`, or `.h` file and press **Ctrl+Shift+V** (macOS: **Cmd+Shift+V**), or run **Code Atlas: Open Code Map** from the Command Palette. The map opens immediately in a VS Code panel, like Markdown Preview. It does not create a map file.

## Explore the map

- Each function or method is a block. Lines connect calls that can be resolved within the files on the map. Files and Python classes have their own frames.
- Click a block to see its source, callers, callees, decorators, and unresolved calls. Double-click a block or click **Về code ở dòng này** to jump to its source line in the editor.
- The map starts with the current file. Click **Thư mục** to include related Python/C files from its workspace folder; **File** switches back. The map refreshes as you edit, including unsaved changes.
- Pan, zoom, move blocks, and add notes. VS Code stores layout and annotations in workspace state, outside the source files.
- C callbacks and IRQ-style functions are highlighted by name. Python inheritance, relative imports, and many calls across files are resolved when their definitions are in the open folder.

## Privacy and limits

Parsing runs locally. The extension does not execute or upload your code. It reads up to 120 Python/C files, 500 KB per file, and 3 MB per map. The map is a **static call graph**: it cannot prove runtime order or fully resolve dynamic Python calls, framework callbacks, C macros, or function pointers. Unresolved calls are shown with their reason instead of an invented connection.
