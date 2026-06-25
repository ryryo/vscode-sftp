import * as vscode from 'vscode';
import { COMMAND_DELETE_REMOTE } from '../constants';
import { upath } from '../core';
import { removeRemote } from '../fileHandlers';
import { reportError } from '../helper';
import { checkCommand } from './abstract/createCommand';
import { uriFromExplorerContextOrEditorContext } from './shared';
import * as operationReport from '../ui/operationReport';

type DeleteScope = 'server' | 'local' | 'both';

async function askDeleteScope(subject: string): Promise<DeleteScope | undefined> {
  const picked = await vscode.window.showQuickPick(
    [
      {
        label: 'On server',
        description: 'Remove from remote only',
        scope: 'server' as const,
      },
      {
        label: 'On computer',
        description: 'Move local copy to trash; leave server unchanged',
        scope: 'local' as const,
      },
      {
        label: 'On both',
        description: 'Remove from server and move local copy to trash',
        scope: 'both' as const,
      },
    ],
    {
      placeHolder: `Delete ${subject}? The local copy is moved to the OS trash, not erased.`,
      ignoreFocusOut: true,
    }
  );
  return picked ? picked.scope : undefined;
}

export default checkCommand({
  id: COMMAND_DELETE_REMOTE,

  async handleCommand(item, items) {
    const targets = uriFromExplorerContextOrEditorContext(item, items);
    if (!targets) {
      return;
    }

    const targetList = Array.isArray(targets) ? targets : [targets];
    const names = targetList.map(t => upath.basename(t.fsPath));
    const subject =
      names.length > 5 ? `${names.length} items` : `'${names.join(', ')}'`;

    const scope = await askDeleteScope(subject);
    if (scope === undefined) {
      return;
    }

    const option =
      scope === 'server'
        ? { removeLocalCopy: false, ignore: null, reportScope: 'server' as const }
        : scope === 'local'
        ? { removeLocalCopy: true, skipRemote: true, ignore: null, reportScope: 'local' as const }
        : { removeLocalCopy: true, ignore: null, reportScope: 'both' as const };

    await operationReport.withReport('delete', () =>
      Promise.all(
        targetList.map(async uri => {
          try {
            await removeRemote(uri, option);
          } catch (error) {
            reportError(error);
          }
        })
      )
    );
  },
});
