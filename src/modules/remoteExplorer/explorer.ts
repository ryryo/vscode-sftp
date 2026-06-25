import * as vscode from 'vscode';
import {
  registerCommand,
  executeCommand,
  showWarningMessage,
  showErrorMessage,
} from '../../host';
import {
  COMMAND_REMOTEEXPLORER_REFRESH,
  COMMAND_REMOTEEXPLORER_REFRESH_ACTIVE_FILE,
  COMMAND_REMOTEEXPLORER_VIEW_CONTENT,
  COMMAND_REMOTEEXPLORER_COPY_PATH,
  COMMAND_REMOTEEXPLORER_OPEN_BY_PATH,
  COMMAND_REMOTEEXPLORER_EDITINLOCAL,
  COMMAND_REMOTEEXPLORER_SORT_BY_SIZE,
  COMMAND_REMOTEEXPLORER_SORT_BY_NAME,
  COMMAND_REMOTEEXPLORER_SHOW_SIZES,
  COMMAND_REMOTEEXPLORER_HIDE_SIZES,
  COMMAND_REMOTEEXPLORER_MEASURING_SIZES,
} from '../../constants';
import { UResource, upath } from '../../core';
import { toRemotePath } from '../../helper';
import { REMOTE_SCHEME } from '../../constants';
import { getFileService } from '../serviceManager';
import { getExtensionSetting } from '../ext';
import RemoteTreeDataProvider, { ExplorerItem, ExplorerRoot } from './treeDataProvider';

function isUnderRoot(rootPath: string, target: string): boolean {
  const root = upath.normalize(rootPath).replace(/\/+$/, '') || '/';
  const t = upath.normalize(target);
  if (root === '/') {
    return t.startsWith('/');
  }
  return t === root || t.startsWith(root + '/');
}

export default class RemoteExplorer {
  private _explorerView: vscode.TreeView<ExplorerItem>;
  private _treeDataProvider: RemoteTreeDataProvider;

  constructor(context: vscode.ExtensionContext) {
    this._treeDataProvider = new RemoteTreeDataProvider();
    context.subscriptions.push(
      vscode.workspace.registerTextDocumentContentProvider(REMOTE_SCHEME, this._treeDataProvider)
    );

    this._explorerView = vscode.window.createTreeView('remoteExplorer', {
      showCollapseAll: true,
      treeDataProvider: this._treeDataProvider,
      canSelectMany: true,
    });

    registerCommand(context, COMMAND_REMOTEEXPLORER_REFRESH, () => this.refresh());
    registerCommand(context, COMMAND_REMOTEEXPLORER_REFRESH_ACTIVE_FILE, () => this._refreshActiveRemoteFile());
    registerCommand(context, COMMAND_REMOTEEXPLORER_VIEW_CONTENT, (item: ExplorerItem) =>
      this._treeDataProvider.showItem(item)
    );
    registerCommand(context, COMMAND_REMOTEEXPLORER_COPY_PATH, (item: ExplorerItem) => {
      vscode.env.clipboard.writeText(item.resource.fsPath);
    });
    registerCommand(context, COMMAND_REMOTEEXPLORER_OPEN_BY_PATH, () => this.openByPath());
    registerCommand(context, COMMAND_REMOTEEXPLORER_SORT_BY_SIZE, () => this._setSortBySize(true));
    registerCommand(context, COMMAND_REMOTEEXPLORER_SORT_BY_NAME, () => this._setSortBySize(false));
    registerCommand(context, COMMAND_REMOTEEXPLORER_SHOW_SIZES, () => this._setShowSize(true));
    registerCommand(context, COMMAND_REMOTEEXPLORER_HIDE_SIZES, () => this._setShowSize(false));
    registerCommand(context, COMMAND_REMOTEEXPLORER_MEASURING_SIZES, () => undefined);
  }

  refresh(item?: ExplorerItem) {
    if (item && !UResource.isRemote(item.resource.uri)) {
      const uri = item.resource.uri;
      const fileService = getFileService(uri);
      if (!fileService) {
        if (uri.toString(true) == "file:///${command:sftp.sync.remoteToLocal}") {
          throw '';
        } else {
          throw new Error(`Config Not Found. (${uri.toString(true)})`);
        }
      }
      const config = fileService.getConfig();
      const localPath = item.resource.fsPath;
      const remotePath = toRemotePath(localPath, config.context, config.remotePath);
      item.resource = UResource.makeResource({
        remote: {
          host: config.host,
          port: config.port,
        },
        fsPath: remotePath,
        remoteId: fileService.id,
      });
    }

    return this._treeDataProvider.refresh(item);
  }

  refreshItem(item: ExplorerItem): void {
    this._treeDataProvider.refreshItem(item);
  }

  private async _setSortBySize(value: boolean): Promise<void> {
    await getExtensionSetting().update(
      'remoteExplorer.sortBySize',
      value,
      vscode.ConfigurationTarget.Global
    );
    this._treeDataProvider.rerender();
  }

  private async _setShowSize(value: boolean): Promise<void> {
    await getExtensionSetting().update(
      'remoteExplorer.showSize',
      value,
      vscode.ConfigurationTarget.Global
    );
    this._treeDataProvider.rerender();
  }

  reveal(
    item: ExplorerItem,
    options?: { select?: boolean; focus?: boolean; expand?: boolean | number }
  ): Thenable<void> {
    return item ? this._explorerView.reveal(item, options) : Promise.resolve();
  }

  async openByPath(): Promise<void> {
    const roots = this._treeDataProvider.getRoots();
    if (roots.length === 0) {
      showWarningMessage(
        'SFTP: no remote is configured. Open a workspace with .vscode/sftp.json first.'
      );
      return;
    }

    const input = await vscode.window.showInputBox({
      ignoreFocusOut: true,
      prompt: 'Open a remote file or folder by its full path',
      placeHolder: 'e.g. /var/www/html/index.php',
    });
    if (input === undefined) {
      return;
    }
    const raw = input.trim();
    if (!raw) {
      return;
    }

    let root: ExplorerRoot | undefined;
    let remotePath: string | undefined;
    if (raw.startsWith('/')) {
      const abs = upath.normalize(raw);
      remotePath = abs;
      const matching = roots.filter(r => isUnderRoot(r.resource.fsPath, abs));
      if (matching.length === 0) {
        showWarningMessage(
          `SFTP: "${abs}" is outside every configured remote root (${roots.map(r => r.resource.fsPath).join(', ')}).`
        );
        return;
      }
      root = matching.length === 1 ? matching[0] : await this._pickRoot(matching);
    } else {
      root = roots.length === 1 ? roots[0] : await this._pickRoot(roots);
      if (root) {
        remotePath = upath.normalize(upath.join(root.resource.fsPath, raw));
        if (!isUnderRoot(root.resource.fsPath, remotePath)) {
          showWarningMessage(
            `SFTP: "${raw}" resolves outside the remote root (${root.resource.fsPath}).`
          );
          return;
        }
      }
    }
    if (!root || remotePath === undefined) {
      return;
    }

    let item: ExplorerItem | undefined;
    try {
      item = await this._resolveByPath(root, remotePath);
    } catch (error) {
      const detail = error && (error as Error).message ? (error as Error).message : String(error);
      showErrorMessage(`SFTP: failed to reach "${remotePath}". ${detail}`);
      return;
    }
    if (!item) {
      showWarningMessage(`SFTP: "${remotePath}" was not found on the server.`);
      return;
    }

    await this.reveal(item, { select: true, focus: true, expand: true });

    if (!item.isDirectory) {
      await executeCommand(COMMAND_REMOTEEXPLORER_EDITINLOCAL, item);
    }
  }

  async showCreated(remoteUri: vscode.Uri, isDirectory: boolean): Promise<void> {
    const resource = UResource.makeResource(remoteUri);

    let parent: ExplorerItem;
    try {
      parent = await this._treeDataProvider.getParent({ resource, isDirectory });
    } catch (e) {
      return;
    }

    const created = this._treeDataProvider.pinKnownType(resource, isDirectory);

    try {
      await this._treeDataProvider.refresh(parent);
    } catch (e) {
      // Couldn't re-list the parent; leave the tree as-is.
    }

    if (created) {
      try {
        await this.reveal(created, { select: true, focus: false });
      } catch (e) {
        // reveal() can throw if VS Code hasn't registered the node yet.
      }
    }
  }

  findRoot(remoteUri: vscode.Uri) {
    return this._treeDataProvider.findRoot(remoteUri);
  }

  private async _pickRoot(roots: ExplorerRoot[]): Promise<ExplorerRoot | undefined> {
    const picks = roots.map(r => ({
      label: r.explorerContext.fileService.name || r.resource.fsPath,
      description: `${r.explorerContext.config.host} — ${r.resource.fsPath}`,
      root: r,
    }));
    const picked = await vscode.window.showQuickPick(picks, {
      placeHolder: 'Select the remote this path belongs to',
    });
    return picked ? picked.root : undefined;
  }

  private async _resolveByPath(
    root: ExplorerRoot,
    remotePath: string
  ): Promise<ExplorerItem | undefined> {
    const relative = upath.relative(root.resource.fsPath, remotePath);
    if (!relative || relative === '.') {
      return root;
    }
    const segments = relative.split('/').filter(segment => segment.length > 0);
    let current: ExplorerItem = root;
    for (const segment of segments) {
      if (!current.isDirectory) {
        return undefined;
      }
      const children = await this._treeDataProvider.getChildren(current);
      const next = children.find(child => upath.basename(child.resource.fsPath) === segment);
      if (!next) {
        return undefined;
      }
      current = next;
    }
    return current;
  }

  private _refreshActiveRemoteFile() {
    const focusedEditor = vscode.window.activeTextEditor;
    if (focusedEditor) {

      const remoteFileUri = focusedEditor.document.uri;
      const root = this._treeDataProvider.findRoot(remoteFileUri);
      const incompleteResource = UResource.makeResource(remoteFileUri);

      if (!root) {
        return;
      }
      const remoteFileItem = {
        resource: UResource.updateResource(root.resource, {
          remotePath: incompleteResource.fsPath
        }),
        isDirectory: false
      };

      this.refresh(remoteFileItem);
    }

  }
}
