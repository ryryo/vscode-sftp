import { Uri, window } from 'vscode';
import { COMMAND_CHMOD_REMOTE } from '../constants';
import { upath, FileType } from '../core';
import { chmodRemote, handleCtxFromUri } from '../fileHandlers';
import { reportError } from '../helper';
import { ExplorerItem } from '../modules/remoteExplorer';
import { checkCommand } from './abstract/createCommand';
import app from '../app';

// `mode & 0o777` rendered as a 3-digit octal string, e.g. 0o755 -> "755".
function toOctal(mode: number): string {
  // tslint:disable-next-line:no-bitwise
  return (mode & 0o777).toString(8).padStart(3, '0');
}

const PRESETS: Array<{ mode: number; rwx: string; hint: string }> = [
  { mode: 0o644, rwx: 'rw-r--r--', hint: 'regular files' },
  { mode: 0o755, rwx: 'rwxr-xr-x', hint: 'folders, scripts' },
  { mode: 0o600, rwx: 'rw-------', hint: 'private' },
  { mode: 0o700, rwx: 'rwx------', hint: 'private folder' },
  { mode: 0o777, rwx: 'rwxrwxrwx', hint: 'everyone, everything' },
];

async function pickMode(currentMode: number | undefined): Promise<number | undefined> {
  const currentTag = '  · current';

  const items = PRESETS.map(p => ({
    label: p.mode.toString(8).padStart(3, '0'),
    description: p.rwx + (currentMode === p.mode ? currentTag : ''),
    detail: p.hint,
    mode: p.mode as number | undefined,
  }));
  items.push({ label: 'Custom value…', description: '', detail: '', mode: undefined });

  const picked = await window.showQuickPick(items, {
    placeHolder:
      currentMode !== undefined
        ? `Permissions (now ${toOctal(currentMode)})`
        : 'Permissions',
  });
  if (!picked) {
    return undefined;
  }
  if (picked.mode !== undefined) {
    return picked.mode;
  }

  const input = await window.showInputBox({
    value: currentMode !== undefined ? toOctal(currentMode) : '',
    prompt: 'Octal permissions, e.g. 755',
    validateInput: v =>
      /^[0-7]{3,4}$/.test((v || '').trim())
        ? undefined
        : 'Enter 3–4 octal digits (0–7), e.g. 644',
  });
  if (input === undefined) {
    return undefined;
  }
  return parseInt(input.trim(), 8);
}

async function pickRecursive(name: string, mode: number): Promise<boolean | undefined> {
  const items = [
    { label: 'This folder only', value: false, description: '' },
    {
      label: 'Recursively (-R)',
      value: true,
      description: 'apply to all contents',
    },
  ];
  const picked = await window.showQuickPick(items, {
    placeHolder: `Apply ${toOctal(mode)} to '${name}'`,
  });
  return picked ? picked.value : undefined;
}

export default checkCommand({
  id: COMMAND_CHMOD_REMOTE,
  async handleCommand(item) {
    try {
      let uri: Uri | undefined;
      let isDirectory = false;
      if (item instanceof Uri) {
        uri = item;
      } else if (item && (item as ExplorerItem).resource) {
        uri = (item as ExplorerItem).resource.uri;
        isDirectory = (item as ExplorerItem).isDirectory === true;
      }
      if (!uri) {
        return;
      }

      const ctx = handleCtxFromUri(uri);
      const remoteFs = await ctx.fileService.getRemoteFileSystem(ctx.config);
      const remotePath = ctx.target.remoteFsPath;

      let currentMode: number | undefined;
      try {
        const stat = await remoteFs.lstat(remotePath);
        currentMode = stat.mode;
        if (!(item && (item as ExplorerItem).resource)) {
          isDirectory = stat.type === FileType.Directory;
        }
      } catch {
        // leave currentMode undefined
      }

      const mode = await pickMode(currentMode);
      if (mode === undefined) {
        return;
      }

      let recursive = false;
      if (isDirectory) {
        const choice = await pickRecursive(upath.basename(remotePath), mode);
        if (choice === undefined) {
          return;
        }
        recursive = choice;
      }

      await chmodRemote(ctx, { mode, recursive });
      if (item && (item as ExplorerItem).resource) {
        (item as ExplorerItem).mode = mode;
        if (app.remoteExplorer) {
          app.remoteExplorer.refreshItem(item as ExplorerItem);
        }
      }

      window.showInformationMessage(
        recursive
          ? `Permissions set to ${toOctal(mode)} (recursively)`
          : `Permissions set to ${toOctal(mode)}`
      );
    } catch (error) {
      reportError(error);
    }
  },
});
