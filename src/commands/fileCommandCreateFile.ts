import { COMMAND_CREATE_FILE } from '../constants';
import { createRemoteFile, FileHandlerContext } from '../fileHandlers';
import { upath, UResource } from '../core';
import { checkFileCommand } from './abstract/createCommand';
import { uriFromExplorerContextOrEditorContext, validateRemoteEntryName } from './shared';
import { window } from 'vscode';
import app from '../app';

async function handleCreateFile(ctx: FileHandlerContext) {
  await createRemoteFile(ctx);
  if (app.remoteExplorer) {
    await app.remoteExplorer.showCreated(ctx.target.remoteUri, false);
  }
}

export default checkFileCommand({
  id: COMMAND_CREATE_FILE,
  async getFileTarget(item, items) {
    const targets = await uriFromExplorerContextOrEditorContext(item, items);
    if (!targets) {
      return;
    }
    const parentUri = Array.isArray(targets) ? targets[0] : targets;

    const result = await window.showInputBox({
      value: '',
      prompt: 'Please input file name',
      validateInput: validateRemoteEntryName,
    });
    if (result === undefined || validateRemoteEntryName(result) !== undefined) {
      return undefined;
    }

    const parent = UResource.makeResource(parentUri);
    const childPath = upath.join(parent.fsPath, result);
    return UResource.updateResource(parent, { remotePath: childPath }).uri;
  },

  handleFile: handleCreateFile,
});
