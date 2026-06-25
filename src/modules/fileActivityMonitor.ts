import * as vscode from 'vscode';
import logger from '../logger';
import app from '../app';
import StatusBarItem from '../ui/statusBarItem';
import { onDidOpenTextDocument, onDidSaveTextDocument, showConfirmMessage } from '../host';
import { readConfigsFromFile } from './config';
import {
  createFileService,
  getFileService,
  findAllFileService,
  disposeFileService,
} from './serviceManager';
import { reportError, isValidFile, isConfigFile, isInWorkspace, realpathIfCaseOnly } from '../helper';
import { downloadFile, uploadFile, allHandleCtxFromUri, FileHandlerContext } from '../fileHandlers';

let workspaceWatcher: vscode.Disposable;

async function handleConfigSave(uri: vscode.Uri) {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  if (!workspaceFolder) {
    return;
  }

  const workspacePath = workspaceFolder.uri.fsPath;

  // dispose old service
  findAllFileService(service => service.workspace === workspacePath).forEach(disposeFileService);

  // create new service
  try {
    const configs = await readConfigsFromFile(uri.fsPath);
    configs.forEach(config => createFileService(config, workspacePath));
  } catch (error) {
    reportError(error);
  } finally {
    app.remoteExplorer.refresh();
  }
}

async function handleFileSave(uri: vscode.Uri) {
  const fileService = getFileService(uri);
  if (!fileService) {
    return;
  }

  // With profiles, upload on save to every profile whose uploadOnSave is true.
  if (fileService.getAvailableProfiles().length > 0) {
    // Normalise the on-disk casing so the upload uses the canonical name (#589) — only a case-only
    // realpath change is adopted; a structural one (symlink / subst) is left as-is.
    const fspath = realpathIfCaseOnly(uri.fsPath);
    const fileUri = vscode.Uri.file(fspath);
    let targets: FileHandlerContext[];
    try {
      targets = allHandleCtxFromUri(fileUri).filter(ctx => ctx.config.uploadOnSave === true);
    } catch (error) {
      logger.error(error, `upload-on-save ${fspath}`);
      return;
    }
    if (targets.length === 0) {
      return;
    }
    logger.info(`[file-save] [profiles] ${fspath}`);
    const results = await Promise.all(
      targets.map(ctx =>
        uploadFile(ctx).then(
          () => ({ ctx, error: null as any }),
          (error: any) => ({ ctx, error })
        )
      )
    );
    const failures = results.filter(r => r.error != null);
    if (failures.length) {
      const labelOf = (ctx: FileHandlerContext) =>
        ctx.config.name || ctx.config.host || '?';
      failures.forEach(({ ctx, error }) => {
        const host = ctx.config && ctx.config.host;
        logger.error(error, `upload → ${labelOf(ctx)}${host ? ` (${host})` : ''} ${fspath}`);
      });
      const total = targets.length;
      const failedNames = failures.map(({ ctx }) => labelOf(ctx)).join(', ');
      const allFailed = failures.length === total;
      app.sftpBarItem.updateStatus(
        allFailed ? StatusBarItem.Status.error : StatusBarItem.Status.warn
      );
      app.sftpBarItem.showMsg(
        allFailed
          ? `upload failed: ${failedNames}`
          : `uploaded to ${total - failures.length}/${total}, failed: ${failedNames}`,
        fspath,
        5000
      );
    }
    return;
  }

  const config = fileService.getConfig();
  if (config.uploadOnSave) {
    // Normalise the on-disk casing so the upload uses the canonical name (#589), but ONLY when realpath
    // differs by case alone. A structural realpath change — a resolved symlink (Linux/macOS) or an
    // expanded subst/mapped drive (Windows) — is rejected: the service is registered under the path the
    // workspace was opened with, so adopting a different real path makes the trie lookup miss and
    // resurfaces as "Config Not Found" on save (#339, #397, #521). See test/realpath.spec.js.
    const fspath = realpathIfCaseOnly(uri.fsPath);
    uri = vscode.Uri.file(fspath);
    logger.info(`[file-save] ${fspath}`);
    try {
      await uploadFile(uri);
    } catch (error) {
      logger.error(error, `upload ${fspath}`);
      app.sftpBarItem.updateStatus(StatusBarItem.Status.error);
    }
  }
}

async function downloadOnOpen(uri: vscode.Uri) {
  const fileService = getFileService(uri);
  if (!fileService) {
    return;
  }

  const config = fileService.getConfig();
  if (config.downloadOnOpen) {
    if (config.downloadOnOpen === 'confirm') {
      const isConfirm = await showConfirmMessage('Do you want SFTP to download this file?');
      if (!isConfirm) return;
    }

    const fspath = uri.fsPath;
    logger.info(`[file-open] ${fspath}`);
    try {
      await downloadFile(uri);
    } catch (error) {
      logger.error(error, `download ${fspath}`);
      app.sftpBarItem.updateStatus(StatusBarItem.Status.error);
    }
  }
}

function watchWorkspace({
  onDidSaveFile,
  onDidSaveSftpConfig,
}: {
  onDidSaveFile: (uri: vscode.Uri) => void;
  onDidSaveSftpConfig: (uri: vscode.Uri) => void;
}) {
  if (workspaceWatcher) {
    workspaceWatcher.dispose();
  }

  workspaceWatcher = onDidSaveTextDocument((doc: vscode.TextDocument) => {
    const uri = doc.uri;
    if (!isValidFile(uri) || !isInWorkspace(uri.fsPath)) {
      return;
    }

    // remove staled cache
    if (app.fsCache.has(uri.fsPath)) {
      app.fsCache.del(uri.fsPath);
    }

    if (isConfigFile(uri)) {
      onDidSaveSftpConfig(uri);
      return;
    }

    onDidSaveFile(uri);
  });
}

function init() {
  onDidOpenTextDocument((doc: vscode.TextDocument) => {
    if (!isValidFile(doc.uri) || !isInWorkspace(doc.uri.fsPath)) {
      return;
    }

    downloadOnOpen(doc.uri);
  });

  watchWorkspace({
    onDidSaveFile: handleFileSave,
    onDidSaveSftpConfig: handleConfigSave,
  });
}

function destory() {
  if (workspaceWatcher) {
    workspaceWatcher.dispose();
  }
}

export default {
  init,
  destory,
};
