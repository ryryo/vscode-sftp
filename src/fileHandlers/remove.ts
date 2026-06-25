import * as vscode from 'vscode';
import * as fs from 'fs';
import { refreshRemoteExplorer } from './shared';
import { fileOperations, FileType } from '../core';
import createFileHandler from './createFileHandler';
import { FileHandleOption } from './option';
import logger from '../logger';
import * as operationReport from '../ui/operationReport';

export const removeRemote = createFileHandler<
  FileHandleOption & {
    skipDir?: boolean;
    removeLocalCopy?: boolean;
    skipRemote?: boolean;
    reportScope?: 'server' | 'local' | 'both';
    reportNote?: string;
  }
>({
  name: 'removeRemote',
  async handle(option) {
    if (!option.skipRemote) {
      const remoteFs = await this.fileService.getRemoteFileSystem(this.config);
      const { remoteFsPath, localFsPath } = this.target;
      const scope = option.reportScope ?? 'server';

      let stat: any = null;
      try {
        stat = await remoteFs.lstat(remoteFsPath);
      } catch (e) {
        logger.info(
          `removeRemote: '${remoteFsPath}' not on server (${(e && (e as Error).message) || String(e)}) — nothing to delete there`
        );
      }

      if (stat) {
        if (operationReport.isActive()) {
          const serverStat: operationReport.FileSideStat = {
            size: stat.size,
            mode: stat.mode,
            mtime: stat.mtime,
          };

          let localStat: operationReport.FileSideStat | null = null;
          if (localFsPath) {
            try {
              const s = fs.statSync(localFsPath);
              localStat = { size: s.size, mode: s.mode, mtime: s.mtimeMs };
            } catch {
              // Local copy absent.
            }
          }

          operationReport.addRow({
            action: 'deleted',
            path: remoteFsPath,
            scope,
            server: serverStat,
            local: localStat,
            note: option.reportNote,
          });
        }

        let promise;
        switch (stat.type) {
          case FileType.Directory:
            if (option.skipDir) {
              return;
            }

            promise = fileOperations.removeDir(remoteFsPath, remoteFs, {});
            break;
          case FileType.File:
          case FileType.SymbolicLink:
            promise = fileOperations.removeFile(remoteFsPath, remoteFs, {});
            break;
          default:
            logger.warn(`Unsupported file type (type = ${stat.type}). File ${remoteFsPath}`);
        }
        await promise;
      }
    } else if (operationReport.isActive()) {
      const { localFsPath } = this.target;
      let localStat: operationReport.FileSideStat | null = null;
      if (localFsPath) {
        try {
          const s = fs.statSync(localFsPath);
          localStat = { size: s.size, mode: s.mode, mtime: s.mtimeMs };
        } catch {
          // File already gone by the time we stat it.
        }
      }
      operationReport.addRow({
        action: 'deleted',
        path: localFsPath ?? this.target.remoteFsPath,
        scope: option.reportScope ?? 'local',
        local: localStat,
      });
    }

    if (option.removeLocalCopy) {
      const { localFsPath } = this.target;
      if (localFsPath && fs.existsSync(localFsPath)) {
        try {
          await vscode.workspace.fs.delete(vscode.Uri.file(localFsPath), {
            recursive: true,
            useTrash: true,
          });
        } catch (error) {
          logger.warn(
            `Local trash unavailable for '${localFsPath}' (${error.message}); deleting permanently`
          );
          try {
            await vscode.workspace.fs.delete(vscode.Uri.file(localFsPath), {
              recursive: true,
              useTrash: false,
            });
          } catch (err2) {
            logger.warn(`Failed to delete local copy '${localFsPath}': ${err2.message}`);
          }
        }
      }
    }
  },
  transformOption() {
    const config = this.config;
    return {
      ignore: config.ignore,
    };
  },
  afterHandle() {
    refreshRemoteExplorer(this.target, false);
  },
});
