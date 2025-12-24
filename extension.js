const vscode = require('vscode');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    const boardProvider = new BoardProvider();
    vscode.window.registerTreeDataProvider('todoBoardLauncher', boardProvider);

    const watcher = vscode.workspace.createFileSystemWatcher('**/*.board.json');
    watcher.onDidCreate(() => boardProvider.refresh());
    watcher.onDidDelete(() => boardProvider.refresh());
    watcher.onDidChange(() => boardProvider.refresh());
    context.subscriptions.push(watcher);

    context.subscriptions.push(
        vscode.commands.registerCommand('todoBoard.openPreview', openPreview)
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('todoBoard.createBoard', createBoard)
    );

    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider(
            'todoBoard.preview',
            new TodoBoardEditor(),
            {
                webviewOptions: {
                    retainContextWhenHidden: true,
                },
            }
        )
    );
}

// ---------------- Launcher ----------------

class BoardProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element) {
        return element;
    }

    async getChildren(element) {
        if (element) {
            return [];
        }

        const files = await vscode.workspace.findFiles('**/*.board.json');
        return files.map((uri) => {
            const item = new vscode.TreeItem(
                vscode.workspace.asRelativePath(uri),
                vscode.TreeItemCollapsibleState.None
            );
            item.iconPath = new vscode.ThemeIcon('breakpoints-activate');
            item.command = {
                command: 'todoBoard.openPreview',
                title: 'Open Board',
                arguments: [uri],
            };
            return item;
        });
    }
}

// ---------------- Open / Create File ----------------

async function openPreview(uri) {
    if (!uri && !vscode.workspace.workspaceFolders) {
        vscode.window.showErrorMessage('Open a workspace first.');
        return;
    }

    // If no URI passed (e.g. command palette), default to first workspace root's todo.board.json
    if (!uri || !(uri instanceof vscode.Uri)) {
        const root = vscode.workspace.workspaceFolders[0].uri;
        uri = vscode.Uri.joinPath(root, 'todo.board.json');
    }

    // Auto-create only if it doesn't exist AND we are using the default path
    // OR if we want to ensure the file exists before opening
    try {
        await vscode.workspace.fs.stat(uri);
    } catch {
        // Only create if it was the default inferred path?
        // Actually, if user provided a specific URI that doesn't exist, we probably shouldn't create it blindly,
        // but for now, the only way to get a non-existent URI passed here is if we constructed it successfully above.
        // If it came from the tree view, it exists (found by findFiles).
        // So this catch block is mainly for the default case.

        const initialTodo = {
            columns: [
                { id: 'Ideas', title: 'Ideas', cards: [] },
                { id: 'In-Progress', title: 'In Progress', cards: [] },
                { id: 'Done', title: 'Done', cards: [] },
            ],
        };

        await vscode.workspace.fs.writeFile(
            uri,
            Buffer.from(JSON.stringify(initialTodo, null, 2))
        );
    }

    // Open preview editor
    await vscode.commands.executeCommand(
        'vscode.openWith',
        uri,
        'todoBoard.preview'
    );
}

async function createBoard() {
    if (!vscode.workspace.workspaceFolders) {
        vscode.window.showErrorMessage('Open a workspace first.');
        return;
    }

    const name = await vscode.window.showInputBox({
        prompt: 'Enter name for new board (will be saved as .board.json)',
        placeHolder: 'e.g. "Project Alpha"',
    });

    if (!name) return;

    // Simple sanitization
    const safeName = name.replace(/[^a-z0-9\- ]/gi, '').trim();
    const filename = (safeName || 'untitled') + '.board.json';

    const root = vscode.workspace.workspaceFolders[0].uri;
    const uri = vscode.Uri.joinPath(root, filename);

    try {
        await vscode.workspace.fs.stat(uri);
        vscode.window.showErrorMessage('File already exists: ' + filename);
        return;
    } catch {
        // OK to create
    }

    const initialTodo = {
        columns: [
            { id: 'todo', title: 'To Do', cards: [] },
            { id: 'doing', title: 'Doing', cards: [] },
            { id: 'done', title: 'Done', cards: [] },
        ],
    };

    await vscode.workspace.fs.writeFile(
        uri,
        Buffer.from(JSON.stringify(initialTodo, null, 2))
    );

    // Provide small delay to let watcher update tree (optional)
    await openPreview(uri);
}

// ---------------- Custom Editor ----------------

class TodoBoardEditor {
    resolveCustomTextEditor(document, panel) {
        panel.webview.options = { enableScripts: true };
        panel.webview.html = this.getHtml();

        const sendData = () => {
            try {
                panel.webview.postMessage({
                    type: 'data',
                    data: JSON.parse(document.getText()),
                });
            } catch {
                // invalid JSON, ignore
            }
        };

        // Initial render
        sendData();

        // Update preview when JSON changes (AI / human)
        const docSub = vscode.workspace.onDidChangeTextDocument((e) => {
            if (e.document.uri.toString() === document.uri.toString()) {
                sendData();
            }
        });

        // Receive updates from board UI
        panel.webview.onDidReceiveMessage(async (msg) => {
            const currentText = document.getText();
            let data = {};
            try {
                data = JSON.parse(currentText);
            } catch {
                return;
            }

            let dirty = false;

            if (msg.type === 'update') {
                data = msg.data;
                dirty = true;
            } else if (msg.type === 'delete-column') {
                const index = data.columns.findIndex(
                    (c) => c.id === msg.columnId
                );
                if (index !== -1) {
                    data.columns.splice(index, 1);
                    dirty = true;
                }
            } else if (msg.type === 'rename-column') {
                const col = data.columns.find((c) => c.id === msg.columnId);
                if (col) {
                    col.title = msg.newTitle;
                    dirty = true;
                }
            } else if (msg.type === 'add-column') {
                const title = await vscode.window.showInputBox({
                    prompt: 'New Column Title',
                });
                if (title) {
                    const id =
                        title.toLowerCase().replace(/[^a-z0-9]/g, '-') +
                        '-' +
                        Date.now();
                    data.columns.push({ id, title, cards: [] });
                    dirty = true;
                    // Force refresh because we modified data based on input
                    sendData();
                }
            } else if (msg.type === 'add-card') {
                const title = await vscode.window.showInputBox({
                    prompt: 'New Card Title',
                });
                if (title) {
                    const col = data.columns.find((c) => c.id === msg.columnId);
                    if (col) {
                        const cardId = 'card-' + Date.now();
                        col.cards.push({ id: cardId, title });
                        dirty = true;
                        // Force refresh
                        sendData();
                    }
                }
            } else if (msg.type === 'delete-card') {
                const col = data.columns.find((c) => c.id === msg.columnId);
                if (col) {
                    const idx = col.cards.findIndex((c) => c.id === msg.cardId);
                    if (idx !== -1) {
                        col.cards.splice(idx, 1);
                        dirty = true;
                    }
                }
            }

            if (dirty) {
                const edit = new vscode.WorkspaceEdit();
                edit.replace(
                    document.uri,
                    new vscode.Range(
                        document.positionAt(0),
                        document.positionAt(currentText.length)
                    ),
                    JSON.stringify(data, null, 2)
                );
                await vscode.workspace.applyEdit(edit);
            }
        });

        panel.onDidDispose(() => docSub.dispose());
    }

    getHtml() {
        return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<style>
  body {
    font-family: system-ui;
    background: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
    padding: 16px;
  }
  .board {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    overflow-x: auto;
    height: 100vh;
  }
  .column {
    min-width: 250px;
    max-width: 250px;
    background: var(--vscode-sideBar-background);
    padding: 12px;
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    max-height: 90vh;
  }
  .column-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
    cursor: default;
  }
  .column-title {
    font-weight: bold;
    font-size: 1.1em;
    flex-grow: 1;
    margin-right: 8px;
    border: 1px solid transparent;
    padding: 2px 4px;
    border-radius: 3px;
  }
  .column-title:focus {
    border-color: var(--vscode-focusBorder);
    outline: none;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
  }
  .icon-btn {
    background: none;
    border: none;
    color: var(--vscode-icon-foreground);
    cursor: pointer;
    padding: 4px;
    border-radius: 3px;
    opacity: 0; /* Hidden by default */
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.2em; /* Bigger icon */
    transition: opacity 0.2s;
  }
  .column:hover .icon-btn {
    opacity: 0.6;
  }
  .column:hover .icon-btn:hover {
    background: var(--vscode-toolbar-hoverBackground);
    opacity: 1;
  }
  .cards-container {
    flex-grow: 1;
    overflow-y: auto;
    min-height: 50px; /* drop target area */
  }
  .card {
    background: var(--vscode-editorWidget-background);
    margin-bottom: 8px;
    padding: 8px 10px;
    border-radius: 4px;
    cursor: grab;
    box-shadow: 0 1px 2px rgba(0,0,0,0.1);
    display: flex;
    justify-content: space-between;
    align-items: center;
    group: card; /* for hover scoping if needed, though usually just .card:hover works */
  }
  .card:hover {
    background: var(--vscode-list-hoverBackground);
  }
  .card .delete-btn {
      opacity: 0;
      background: none;
      border: none;
      color: var(--vscode-icon-foreground);
      cursor: pointer;
      font-size: 1.1em;
      padding: 0 4px;
  }
  .card:hover .delete-btn {
      opacity: 0.7;
  }
  .card .delete-btn:hover {
      opacity: 1;
      color: var(--vscode-errorForeground);
  }
  .column.dragover {
    outline: 2px dashed var(--vscode-focusBorder);
  }
  .add-card-btn {
    width: 100%;
    padding: 8px 10px;
    background: transparent;
    color: var(--vscode-textLink-foreground);
    border: 1px dashed var(--vscode-input-border);
    border-radius: 4px;
    cursor: pointer;
    text-align: left;
    transition: background 0.2s;
  }
  .add-card-btn:hover {
    background: var(--vscode-list-hoverBackground);
    text-decoration: none;
  }
  .add-column-btn {
    min-width: 250px;
    height: 48px;
    background: rgba(128, 128, 128, 0.1);
    color: var(--vscode-foreground);
    border: 1px dashed var(--vscode-input-border);
    border-radius: 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1em;
    transition: background 0.2s;
  }
  .add-column-btn:hover {
    background: rgba(128, 128, 128, 0.2);
  }
</style>
</head>
<body>
  <div id="board" class="board"></div>

<script>
  const vscode = acquireVsCodeApi();
  let state = null;
  let dragged = null;
  let fromColumn = null;

  window.addEventListener("message", e => {
    if (e.data.type === "data") {
      state = e.data.data;
      render();
    }
  });

  function render() {
    board.innerHTML = "";
    
    // Add columns
    state.columns.forEach((col, index) => {
      const column = document.createElement("div");
      column.className = "column";
      
      // Header
      const header = document.createElement("div");
      header.className = "column-header";
      
      const title = document.createElement("div");
      title.className = "column-title";
      title.textContent = col.title;
      title.contentEditable = true;
      
      // Save rename on blur or enter
      const saveRename = () => {
         const newTitle = title.textContent.trim();
         if (newTitle && newTitle !== col.title) {
             vscode.postMessage({ type: "rename-column", columnId: col.id, newTitle });
         } else {
             title.textContent = col.title; // revert
         }
      };
      
      title.onblur = saveRename;
      title.onkeydown = (e) => {
          if (e.key === 'Enter') {
              e.preventDefault();
              title.blur();
          }
      };

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "icon-btn";
      deleteBtn.innerHTML = "×";
      deleteBtn.title = "Delete Column";
      deleteBtn.onclick = () => {
          vscode.postMessage({ type: "delete-column", columnId: col.id });
      };

      header.appendChild(title);
      header.appendChild(deleteBtn);
      column.appendChild(header);

      // Cards Container
      const cardsContainer = document.createElement("div");
      cardsContainer.className = "cards-container";

      // Drag events on column/container
      column.ondragover = e => {
        e.preventDefault();
        column.classList.add("dragover");
      };

      column.ondragleave = () => {
        column.classList.remove("dragover");
      };

      column.ondrop = () => {
        column.classList.remove("dragover");
        if (!dragged) return;

        moveCard(fromColumn, col.id, dragged.id);
        vscode.postMessage({ type: "update", data: state });

        dragged = null;
        fromColumn = null;
      };

      col.cards.forEach(card => {
        const el = document.createElement("div");
        el.className = "card";
        
        const span = document.createElement("span");
        span.textContent = card.title;
        el.appendChild(span);

        const delBtn = document.createElement("button");
        delBtn.className = "delete-btn";
        delBtn.innerHTML = "×";
        delBtn.title = "Delete Card";
        delBtn.onclick = (e) => {
            e.stopPropagation(); // prevent drag start logic if clicked
            vscode.postMessage({ type: "delete-card", columnId: col.id, cardId: card.id });
        };
        el.appendChild(delBtn);

        el.draggable = true;

        el.ondragstart = (e) => {
          dragged = card;
          fromColumn = col.id;
          e.stopPropagation(); // prevent bubbling to column
        };

        cardsContainer.appendChild(el);
      });
      
      column.appendChild(cardsContainer);

      // Add Card Button (Only for first column)
      if (index === 0) {
        const addCardBtn = document.createElement("button");
        addCardBtn.className = "add-card-btn";
        addCardBtn.textContent = "+ Add Todo";
        addCardBtn.onclick = () => {
            vscode.postMessage({ type: "add-card", columnId: col.id });
        };
        cardsContainer.appendChild(addCardBtn);
      }
      
      column.appendChild(cardsContainer);

      board.appendChild(column);
    });

    // Add New Column Button
    const addColBtn = document.createElement("button");
    addColBtn.className = "add-column-btn";
    addColBtn.textContent = "+ Add New Column";
    addColBtn.onclick = () => {
        vscode.postMessage({ type: "add-column" });
    };
    board.appendChild(addColBtn);
  }

  function moveCard(fromId, toId, cardId) {
    if (fromId === toId) return;

    const fromCol = state.columns.find(c => c.id === fromId);
    const toCol = state.columns.find(c => c.id === toId);

    const index = fromCol.cards.findIndex(c => c.id === cardId);
    if (index === -1) return;
    
    const [card] = fromCol.cards.splice(index, 1);
    toCol.cards.push(card);
  }
</script>
</body>
</html>
`;
    }
}

function deactivate() {}

module.exports = {
    activate,
    deactivate,
};
