const vscode = require('vscode');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    // Hidden sidebar view (exists ONLY to create Activity Bar icon)
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'todoBoardLauncher',
            new HiddenLauncher()
        )
    );

    // Command to open preview
    context.subscriptions.push(
        vscode.commands.registerCommand('todoBoard.openPreview', openPreview)
    );

    // Custom editor (Todo Board preview)
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

class HiddenLauncher {
    resolveWebviewView() {
        // As soon as the icon is clicked → open the board
        vscode.commands.executeCommand('todoBoard.openPreview');
    }
}

// ---------------- Open / Create File ----------------

async function openPreview() {
    if (!vscode.workspace.workspaceFolders) {
        vscode.window.showErrorMessage('Open a workspace first.');
        return;
    }

    const root = vscode.workspace.workspaceFolders[0].uri;
    const uri = vscode.Uri.joinPath(root, 'todo.json');

    // Auto-create todo.json if missing
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

    // Open preview editor
    await vscode.commands.executeCommand(
        'vscode.openWith',
        uri,
        'todoBoard.preview'
    );
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
        panel.webview.onDidReceiveMessage((msg) => {
            if (msg.type === 'update') {
                const edit = new vscode.WorkspaceEdit();
                edit.replace(
                    document.uri,
                    new vscode.Range(
                        document.positionAt(0),
                        document.positionAt(document.getText().length)
                    ),
                    JSON.stringify(msg.data, null, 2)
                );
                vscode.workspace.applyEdit(edit);
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
    padding: 8px;
  }
  .board {
    display: flex;
    gap: 8px;
    overflow-x: auto;
  }
  .column {
    min-width: 220px;
    background: var(--vscode-sideBar-background);
    padding: 8px;
    border-radius: 6px;
  }
  .column h3 {
    margin: 0 0 8px;
  }
  .card {
    background: var(--vscode-editorWidget-background);
    margin-bottom: 6px;
    padding: 6px;
    border-radius: 4px;
    cursor: grab;
  }
  .column.dragover {
    outline: 2px dashed var(--vscode-focusBorder);
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

    state.columns.forEach(col => {
      const column = document.createElement("div");
      column.className = "column";
      column.innerHTML = "<h3>" + col.title + "</h3>";

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
        el.textContent = card.title;
        el.draggable = true;

        el.ondragstart = () => {
          dragged = card;
          fromColumn = col.id;
        };

        column.appendChild(el);
      });

      board.appendChild(column);
    });
  }

  function moveCard(fromId, toId, cardId) {
    if (fromId === toId) return;

    const fromCol = state.columns.find(c => c.id === fromId);
    const toCol = state.columns.find(c => c.id === toId);

    const index = fromCol.cards.findIndex(c => c.id === cardId);
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
