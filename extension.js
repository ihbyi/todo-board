const vscode = require('vscode');

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

async function openPreview(uri) {
    if (!uri && !vscode.workspace.workspaceFolders) {
        vscode.window.showErrorMessage('Open a workspace first.');
        return;
    }

    if (!uri || !(uri instanceof vscode.Uri)) {
        const root = vscode.workspace.workspaceFolders[0].uri;
        uri = vscode.Uri.joinPath(root, 'todo.board.json');
    }

    try {
        await vscode.workspace.fs.stat(uri);
    } catch {
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
        placeHolder: 'e.g. "Plan"',
    });

    if (!name) return;

    const safeName = name.replace(/[^a-z0-9\- ]/gi, '').trim();
    const filename = (safeName || 'untitled') + '.board.json';

    const root = vscode.workspace.workspaceFolders[0].uri;
    const uri = vscode.Uri.joinPath(root, filename);

    try {
        await vscode.workspace.fs.stat(uri);
        vscode.window.showErrorMessage('File already exists: ' + filename);
        return;
    } catch {}

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

    await openPreview(uri);
}

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
            } catch {}
        };

        sendData();

        const docSub = vscode.workspace.onDidChangeTextDocument((e) => {
            if (e.document.uri.toString() === document.uri.toString()) {
                sendData();
            }
        });

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
            } else if (msg.type === 'move-column') {
                const fromIndex = data.columns.findIndex(
                    (c) => c.id === msg.fromId
                );
                const toIndex = data.columns.findIndex(
                    (c) => c.id === msg.toId
                );
                if (
                    fromIndex !== -1 &&
                    toIndex !== -1 &&
                    fromIndex !== toIndex
                ) {
                    const [col] = data.columns.splice(fromIndex, 1);
                    data.columns.splice(toIndex, 0, col);
                    dirty = true;
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
                await document.save();
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
    padding-bottom: 24px;
    cursor: grab;
  }
  .board.active {
    cursor: grabbing;
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
    user-select: none;
  }

  .column-header {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: center; 
    margin-bottom: 12px;
    cursor: default;
    width: 100%;
  }
  .column-title {
    font-weight: bold;
    font-size: 1.1em;
    flex: 1 1 auto;
    margin-right: 8px;
    border: 1px solid transparent;
    padding: 2px 4px;
    border-radius: 3px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .column-title:focus {
    border-color: var(--vscode-focusBorder);
    outline: none;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
  }
  .icon-btn {
    flex-shrink: 0;
    background: none;
    border: none;
    color: var(--vscode-icon-foreground);
    cursor: pointer;
    padding: 4px;
    border-radius: 3px;
    opacity: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.2em;
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
    min-height: 50px;
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
    group: card;
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
  .card.dragging {
    opacity: 0.5;
    background: var(--vscode-editor-selectionBackground);
  }
  .column.dragover {
    outline: 2px dashed var(--vscode-focusBorder);
  }
  .column.card-dragover {
      background: var(--vscode-editor-inactiveSelectionBackground);
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
  let draggedType = null;

  window.addEventListener("message", e => {
    if (e.data.type === "data") {
      state = e.data.data;
      render();
    }
  });

  function render() {
    board.innerHTML = "";
    
    state.columns.forEach((col, index) => {
      const column = document.createElement("div");
      column.className = "column";
      column.draggable = true;
      
      column.ondragstart = (e) => {
          if (e.target.closest('.card')) {
              return;
          }
          dragged = col;
          draggedType = 'column';
          e.dataTransfer.effectAllowed = 'move';
          setTimeout(() => column.style.opacity = '0.5', 0);
      };
      
      column.ondragend = () => {
          column.style.opacity = '1';
          dragged = null;
          draggedType = null;
          document.querySelectorAll('.column').forEach(c => c.classList.remove('dragover'));
      };

      const header = document.createElement("div");
      header.className = "column-header";
      
      const title = document.createElement("div");
      title.className = "column-title";
      title.textContent = col.title;
      title.contentEditable = true;
      
      const saveRename = () => {
         const newTitle = title.textContent.trim();
         if (newTitle && newTitle !== col.title) {
             vscode.postMessage({ type: "rename-column", columnId: col.id, newTitle });
         } else {
             title.textContent = col.title;
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
      const cardsContainer = document.createElement("div");
      cardsContainer.className = "cards-container";
      column.ondragover = e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (draggedType === 'column' && dragged.id !== col.id) {
             column.classList.add("dragover");
        } else if (draggedType === 'card' && fromColumn !== col.id) {
             column.classList.add("card-dragover"); 
        }
      };

      column.ondragleave = () => {
        column.classList.remove("dragover");
        column.classList.remove("card-dragover");
      };

      column.ondrop = (e) => {
        e.preventDefault();
        column.classList.remove("dragover");
        column.classList.remove("card-dragover");
        if (!dragged) return;

        if (draggedType === 'column') {
             if (dragged.id !== col.id) {
                 vscode.postMessage({ type: "move-column", fromId: dragged.id, toId: col.id });
             }
        } else if (draggedType === 'card') {
            const afterElement = getDragAfterElement(cardsContainer, e.clientY);
            const index = afterElement ? 
                state.columns.find(c => c.id === col.id).cards.findIndex(c => c.id === afterElement.dataset.id) : 
                state.columns.find(c => c.id === col.id).cards.length;

            moveCard(fromColumn, col.id, dragged.id, index);
            render();
            vscode.postMessage({ type: "update", data: state });
        }
        
        dragged = null;
        fromColumn = null;
        draggedType = null;
      };

      col.cards.forEach(card => {
        const el = document.createElement("div");
        el.className = "card";
        el.dataset.id = card.id;
        
        const span = document.createElement("span");
        span.textContent = card.title;
        el.appendChild(span);

        const delBtn = document.createElement("button");
        delBtn.className = "delete-btn";
        delBtn.innerHTML = "×";
        delBtn.title = "Delete Card";
        delBtn.onclick = (e) => {
            e.stopPropagation();
            vscode.postMessage({ type: "delete-card", columnId: col.id, cardId: card.id });
        };
        el.appendChild(delBtn);

        el.draggable = true;

        el.ondragstart = (e) => {
          dragged = card;
          draggedType = 'card';
          fromColumn = col.id;
          el.classList.add('dragging');
          e.stopPropagation();
        };
        
        el.ondragend = () => {
             el.classList.remove('dragging');
        };

        cardsContainer.appendChild(el);
      });
      
      column.appendChild(cardsContainer);

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

    const addColBtn = document.createElement("button");
    addColBtn.className = "add-column-btn";
    addColBtn.textContent = "+ Add New Column";
    addColBtn.onclick = () => {
        vscode.postMessage({ type: "add-column" });
    };
    board.appendChild(addColBtn);
  }

  let isDown = false;
  let startX;
  let scrollLeft;

  board.addEventListener('mousedown', (e) => {
    if (e.target.closest('.card') || e.target.tagName === 'BUTTON' || e.target.isContentEditable || e.target.closest('.column-header')) {
        return;
    }
    e.preventDefault();
    isDown = true;
    board.classList.add('active');
    startX = e.pageX - board.offsetLeft;
    scrollLeft = board.scrollLeft;
  });

  board.addEventListener('mouseleave', () => {
    isDown = false;
    board.classList.remove('active');
  });

  board.addEventListener('mouseup', () => {
    isDown = false;
    board.classList.remove('active');
  });

  board.addEventListener('mousemove', (e) => {
    if (!isDown) return;
    e.preventDefault();
    const x = e.pageX - board.offsetLeft;
    const walk = (x - startX) * 2;
    board.scrollLeft = scrollLeft - walk;
  });


  function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.card:not(.dragging)')];

    return draggableElements.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset: offset, element: child };
      } else {
        return closest;
      }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  }

  function moveCard(fromId, toId, cardId, toIndex) {
    const fromCol = state.columns.find(c => c.id === fromId);
    const toCol = state.columns.find(c => c.id === toId);

    const fromIdx = fromCol.cards.findIndex(c => c.id === cardId);
    if (fromIdx === -1) return;
    
    const [card] = fromCol.cards.splice(fromIdx, 1);
    
    let finalIndex = toIndex;
    if (fromId === toId && fromIdx < toIndex) {
        if (toIndex !== undefined && toIndex > fromIdx) {
             finalIndex = toIndex - 1;
        }
    }
    
    if (finalIndex === undefined) finalIndex = toCol.cards.length;

    toCol.cards.splice(finalIndex, 0, card);
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
