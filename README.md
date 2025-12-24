# Todo Board for VS Code

A simple, Kanban-style todo board extension for Visual Studio Code. Manage your tasks visually right inside your editor.

![Todo Board Preview](https://github.com/ihbyi/todo-board/blob/main/media/preview.png)

## Features

-   **🗂️ Kanban Boards**: Create multiple boards to organize different projects. Boards are saved as human-readable `.board.json` files.
-   **📝 Drag & Drop**: Intuitively reorganize your work.
    -   **Reorder Cards**: Prioritize tasks by dragging them up or down.
    -   **Move Cards**: Drag tasks between columns (e.g., from "Todo" to "Done").
    -   **Reorder Columns**: Rearrange your workflow by dragging column headers.
-   **🖱️ Drag-to-Scroll**: Navigate wide boards easily by clicking and dragging on the background (like a map).
-   **💾 Auto-Save**: All changes (edits, moves, deletions) are saved instantly.
-   **🎨 Native Look**: Styled to match your current VS Code theme perfectly.

## Usage

1.  **Open the Board**: Click the "Todo Board" icon in the Activity Bar (left sidebar).
2.  **Create a Board**: Click the `+` icon to create a new `.board.json` file.
3.  **Manage Tasks**:
    -   **Add Column**: Click "+ Add New Column" on the far right.
    -   **Add Todo**: Click "+ Add Todo" in the first column.
    -   **Edit**: Click on any column title to rename it.
    -   **Delete**: Hover over a card or column header to reveal the `×` delete button.

## Extension Settings

This extension currently uses `.board.json` files located in your workspace to store data. You can commit these files to version control to share boards with your team.

## Known Issues

-   Ensure you have a workspace or folder open to create new boards.

## Release Notes

### 1.0.0

Initial release with:

-   Full drag-and-drop support (Cards & Columns).
-   Drag-to-scroll navigation.
-   Auto-saving and native VS Code theming.
