import * as vscode from 'vscode';
import { showTextDocument, setContextValue } from '../../host';
import {
  upath,
  UResource,
  Resource,
  FileService,
  FileType,
  FileEntry,
  Ignore,
  ServiceConfig,
  FileSystem,
} from '../../core';
import {
  COMMAND_REMOTEEXPLORER_VIEW_CONTENT,
  COMMAND_REMOTEEXPLORER_EDITINLOCAL,
} from '../../constants';
import { getAllFileService } from '../serviceManager';
import { getExtensionSetting } from '../ext';
import { duSizes } from './folderSize';

type Id = number;

const previewDocumentPathPrefix = '/~ ';

const DEFAULT_FILES_EXCLUDE = ['.git', '.svn', '.hg', 'CVS', '.DS_Store'];
/**
 * covert the url path for a customed docuemnt title
 *
 *  There is no api to custom title.
 *  So we change url path for custom title.
 *  This is not break anything because we get fspth from uri.query.'
 */
function makePreivewUrl(uri: vscode.Uri) {
  // const query = querystring.parse(uri.query);
  // query.originPath = uri.path;
  // query.originQuery = uri.query;

  return uri.with({
    path: previewDocumentPathPrefix + upath.basename(uri.path),
    // query: querystring.stringify(query),
  });
}

interface ExplorerChild {
  resource: Resource;
  isDirectory: boolean;
  size?: number;
  mode?: number;
  mtime?: number;
  // Real folder size from a server-side `du`; populated when show/sort-by-size is active.
  folderBytes?: number;
}

export interface ExplorerRoot extends ExplorerChild {
  explorerContext: {
    fileService: FileService;
    config: ServiceConfig;
    id: Id;
  };
}

export type ExplorerItem = ExplorerRoot | ExplorerChild;

function dirFirstSort(fileA: ExplorerItem, fileB: ExplorerItem) {
  if (fileA.isDirectory === fileB.isDirectory) {
    return fileA.resource.fsPath.localeCompare(fileB.resource.fsPath);
  }

  return fileA.isDirectory ? -1 : 1;
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  const text = i === 0 ? String(value) : value.toFixed(value < 10 ? 1 : 0);
  return `${text} ${units[i]}`;
}

function formatMode(mode: number): string {
  // tslint:disable-next-line:no-bitwise
  const simpleMode = mode & 0o777;
  const octal = simpleMode.toString(8).padStart(3, '0');
  const symbols = [0o400, 0o200, 0o100, 0o040, 0o020, 0o010, 0o004, 0o002, 0o001]
    // tslint:disable-next-line:no-bitwise
    .map((bit, index) => (simpleMode & bit ? 'rwx'[index % 3] : '-'))
    .join('');
  return `${octal} (${symbols})`;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  if (isNaN(d.getTime())) {
    return '';
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

function buildTooltip(item: ExplorerItem, isRoot: boolean): string {
  const lines = [item.resource.fsPath];
  if (!isRoot && !item.isDirectory && typeof item.size === 'number') {
    lines.push(`Size: ${formatBytes(item.size)}`);
  }
  if (!isRoot && typeof item.mode === 'number') {
    lines.push(`Permissions: ${formatMode(item.mode)}`);
  }
  if (typeof item.mtime === 'number' && item.mtime > 0) {
    lines.push(`Modified: ${formatTime(item.mtime)}`);
  }
  return lines.join('\n');
}

export default class RemoteTreeData
  implements vscode.TreeDataProvider<ExplorerItem>, vscode.TextDocumentContentProvider {
  private _roots: ExplorerRoot[] | null;
  private _rootsMap: Map<Id, ExplorerRoot> | null;
  private _map: Map<vscode.Uri['query'], ExplorerItem>;
  private _measuring = new Set<string>();

  private _onDidChangeFolder: vscode.EventEmitter<ExplorerItem | undefined> = new vscode.EventEmitter<
    ExplorerItem | undefined
  >();
  private _onDidChangeFile: vscode.EventEmitter<vscode.Uri> = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChangeTreeData: vscode.Event<ExplorerItem | undefined> = this._onDidChangeFolder.event;
  readonly onDidChange: vscode.Event<vscode.Uri> = this._onDidChangeFile.event;

  async refresh(item?: ExplorerItem): Promise<any> {
    if (this._map) {
      this._map.forEach(node => {
        node.folderBytes = undefined;
      });
    }
    // refresh root
    if (!item) {
      // clear cache
      this._roots = null;
      this._rootsMap = null;

      this._onDidChangeFolder.fire(undefined);
      return;
    }

    if (item.isDirectory) {
      this._onDidChangeFolder.fire(item);

      // refresh top level files as well
      const children = await this.getChildren(item);
      children
        .filter(i => !i.isDirectory)
        .forEach(i => this._onDidChangeFile.fire(makePreivewUrl(i.resource.uri)));
      return children;
    } else {
      const parent = await this.getParent(item);
      if (parent) {
        this._onDidChangeFolder.fire(parent);
      }
      this._onDidChangeFile.fire(makePreivewUrl(item.resource.uri));
    }
  }

  refreshItem(item: ExplorerItem): void {
    this._onDidChangeFolder.fire(item);
  }

  rerender(): void {
    this._onDidChangeFolder.fire(undefined);
  }

  getTreeItem(item: ExplorerItem): vscode.TreeItem {
    const isRoot = (item as ExplorerRoot).explorerContext !== undefined;
    const setting = getExtensionSetting();
    let customLabel: string | undefined;
    let description: string | undefined;
    if (isRoot) {
      customLabel = (item as ExplorerRoot).explorerContext.fileService.name;
    }
    if (!customLabel) {
      customLabel = upath.basename(item.resource.fsPath);
    }
    if (!isRoot && setting.get<boolean>('remoteExplorer.showSize', false)) {
      if (!item.isDirectory && typeof item.size === 'number') {
        description = formatBytes(item.size);
      } else if (item.isDirectory && typeof item.folderBytes === 'number' && item.folderBytes >= 0) {
        description = formatBytes(item.folderBytes);
      }
    }
    return {
      label: customLabel,
      description,
      resourceUri: item.resource.uri,
      tooltip: buildTooltip(item, isRoot),
      collapsibleState: item.isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : undefined,
      contextValue: isRoot ? 'root' : item.isDirectory ? 'folder' : 'file',
      command: item.isDirectory
        ? undefined
        : {
            command: getExtensionSetting().downloadWhenOpenInRemoteExplorer
              ? COMMAND_REMOTEEXPLORER_EDITINLOCAL
              : COMMAND_REMOTEEXPLORER_VIEW_CONTENT,
            arguments: [item],
            title: 'View Remote Resource',
          },
    };
  }

  async getChildren(item?: ExplorerItem): Promise<ExplorerItem[]> {
    if (!item) {
      return this._getRoots();
    }

    const root = this.findRoot(item.resource.uri);
    if (!root) {
      throw new Error(`Can't find config for remote resource ${item.resource.uri}.`);
    }
    const config = root.explorerContext.config;
    const remotefs = await root.explorerContext.fileService.getRemoteFileSystem(config);
    const fileEntries = await remotefs.list(item.resource.fsPath);

    const filesExcludeList: string[] =
      config.remoteExplorer && config.remoteExplorer.filesExclude
        ? config.remoteExplorer.filesExclude.concat(DEFAULT_FILES_EXCLUDE)
        : DEFAULT_FILES_EXCLUDE;

    const ignore = new Ignore(filesExcludeList);
    function filterFile(file: FileEntry) {
      const relativePath = upath.relative(config.remotePath, file.fspath);
      return !ignore.ignores(relativePath);
    }

    const filtered = fileEntries.filter(filterFile);

    const items: ExplorerItem[] = filtered.map(file => {
      const isDirectory = file.type === FileType.Directory;
      const newResource = UResource.updateResource(item.resource, {
        remotePath: file.fspath,
      });
      const mapItem = this._map.get(newResource.uri.query);
      if (mapItem) {
        mapItem.size = file.size;
        mapItem.mode = file.mode;
        mapItem.mtime = file.mtime;
        return mapItem;
      }
      const newItem = {
        resource: UResource.updateResource(item.resource, {
          remotePath: file.fspath,
        }),
        isDirectory,
        size: file.size,
        mode: file.mode,
        mtime: file.mtime,
      };
      this._map.set(newItem.resource.uri.query, newItem);
      return newItem;
    });

    const setting = getExtensionSetting();
    const sortBySize = setting.get<boolean>('remoteExplorer.sortBySize', false);
    const showSize = setting.get<boolean>('remoteExplorer.showSize', false);
    if (sortBySize || showSize) {
      const unmeasured = items.filter(i => i.isDirectory && typeof i.folderBytes !== 'number');
      if (unmeasured.length > 0) {
        this._measureFolderSizes(remotefs, unmeasured, item).catch(() => undefined);
      }
    }

    if (!sortBySize) {
      return items.sort(dirFirstSort);
    }
    const dirs = items.filter(i => i.isDirectory);
    const files = items.filter(i => !i.isDirectory);
    const folderBytesOf = (i: ExplorerItem) => (typeof i.folderBytes === 'number' ? i.folderBytes : -1);
    dirs.sort(
      (a, b) => folderBytesOf(b) - folderBytesOf(a) || a.resource.fsPath.localeCompare(b.resource.fsPath)
    );
    files.sort(
      (a, b) => (b.size || 0) - (a.size || 0) || a.resource.fsPath.localeCompare(b.resource.fsPath)
    );
    return dirs.concat(files);
  }

  private async _measureFolderSizes(
    remotefs: FileSystem,
    folders: ExplorerItem[],
    parent: ExplorerItem
  ): Promise<void> {
    const key = parent.resource.uri.query;
    if (this._measuring.has(key)) {
      return;
    }
    this._measuring.add(key);
    setContextValue('measuringSizes', true);
    try {
      const sizes = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Window,
          title: 'SFTP: requesting folder sizes from your server — this takes a moment, please wait…',
        },
        () => duSizes(remotefs, folders.map(f => f.resource.fsPath))
      );
      let changed = false;
      for (const folder of folders) {
        const bytes = sizes.has(folder.resource.fsPath)
          ? (sizes.get(folder.resource.fsPath) as number)
          : -1;
        if (folder.folderBytes !== bytes) {
          folder.folderBytes = bytes;
          changed = true;
        }
      }
      if (changed) {
        this._onDidChangeFolder.fire(parent);
      }
    } finally {
      this._measuring.delete(key);
      if (this._measuring.size === 0) {
        setContextValue('measuringSizes', false);
      }
    }
  }

  pinKnownType(resource: Resource, isDirectory: boolean): ExplorerItem | undefined {
    if (!this._map) {
      return undefined;
    }
    const existing = this._map.get(resource.uri.query);
    if (existing) {
      existing.isDirectory = isDirectory;
      return existing;
    }
    const node: ExplorerChild = { resource, isDirectory };
    this._map.set(resource.uri.query, node);
    return node;
  }

  async getParent(item: ExplorerChild): Promise<ExplorerItem> {
    const resourceUri = item.resource.uri;
    const root = this.findRoot(resourceUri);
    if (!root) {
      throw new Error(`Can't find config for remote resource ${resourceUri}.`);
    }

    if (item.resource.fsPath === root.resource.fsPath) {
      return root;
    }

    const fspath = upath.dirname(item.resource.fsPath);
    const newResource = UResource.updateResource(item.resource, {
      remotePath: fspath,
    });
    const mapItem = this._map.get(newResource.uri.query);
    if (mapItem) {
      return mapItem;
    } else {
      const newMapItem = {
        resource: newResource,
        isDirectory: true,
      };
      this._map.set(newResource.uri.query, newMapItem);
      await this.getChildren(newMapItem);
      return newMapItem;
    }
  }

  getRoots(): ExplorerRoot[] {
    return this._getRoots();
  }

  findRoot(uri: vscode.Uri): ExplorerRoot | null | undefined {
    if (!this._rootsMap) {
      return null;
    }

    const rootId = UResource.makeResource(uri).remoteId;
    return this._rootsMap.get(rootId);
  }

  async provideTextDocumentContent(
    uri: vscode.Uri,
    token: vscode.CancellationToken
  ): Promise<string> {
    const root = this.findRoot(uri);
    if (!root) {
      throw new Error(`Can't find remote for resource ${uri}.`);
    }

    const config = root.explorerContext.config;
    const remotefs = await root.explorerContext.fileService.getRemoteFileSystem(config);
    const buffer = await remotefs.readFile(UResource.makeResource(uri).fsPath);
    return buffer.toString();
  }

  showItem(item: ExplorerItem): void {
    if (item.isDirectory) {
      return;
    }

    showTextDocument(makePreivewUrl(item.resource.uri));
  }

  private _getRoots(): ExplorerRoot[] {
    if (this._roots) {
      return this._roots;
    }

    this._roots = [];
    this._rootsMap = new Map();
    this._map = new Map();
    getAllFileService().forEach(fileService => {
      const config = fileService.getConfig();
      const id = fileService.id;
      const item = {
        resource: UResource.makeResource({
          remote: {
            host: config.host,
            port: config.port,
          },
          fsPath: config.remotePath,
          remoteId: id,
        }),
        isDirectory: true,
        explorerContext: {
          fileService,
          config,
          id,
        },
      };
      this._roots!.push(item);
      this._rootsMap!.set(id, item);
      this._map.set(item.resource.uri.query, item);
    });
    this._roots.sort((a,b) => a.explorerContext.config.remoteExplorer.order - b.explorerContext.config.remoteExplorer.order || a.explorerContext.fileService.name.localeCompare(b.explorerContext.fileService.name));
    return this._roots;
  }
}
