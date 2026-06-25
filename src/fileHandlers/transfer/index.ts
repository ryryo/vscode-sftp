import * as fs from 'fs';
import { refreshRemoteExplorer } from '../shared';
import createFileHandler, { FileHandlerContext } from '../createFileHandler';
import { FileType } from '../../core';
import TransferTask from '../../core/transferTask';
import { openDownloadedFile } from '../../helper/smartOpen';
import * as operationReport from '../../ui/operationReport';
import { transfer, sync, TransferOption, SyncOption, TransferDirection } from './transfer';

interface TransferSchedulerLike {
  add(task: TransferTask): void;
}

function scheduleTask(
  scheduler: TransferSchedulerLike,
  task: TransferTask,
  remoteHost?: string
): void {
  if (!operationReport.isActive()) {
    scheduler.add(task);
    return;
  }

  const originalRun = task.run.bind(task);
  const { localFsPath, transferType } = task;
  const isUpload = transferType === TransferDirection.LOCAL_TO_REMOTE;
  const arrow = isUpload ? '→' : '←';

  Object.assign(task, {
    run: async () => {
      try {
        await originalRun();
        if (task.isCancelled()) {
          return;
        }

        let localStat: operationReport.FileSideStat | null = null;
        try {
          const s = fs.statSync(localFsPath);
          localStat = { size: s.size, mode: s.mode, mtime: s.mtimeMs };
        } catch {
          // File may not exist yet or was cleaned up.
        }

        operationReport.addRow({
          action: isUpload ? 'uploaded' : 'downloaded',
          path: localFsPath,
          local: localStat,
          note: remoteHost ? `${arrow} ${remoteHost}` : undefined,
        });
      } catch (error) {
        const reason = (error && error.message) || String(error);
        operationReport.addRow({
          action: 'FAILED',
          path: localFsPath,
          failed: true,
          note: remoteHost ? `${remoteHost}: ${reason}` : reason,
        });
        throw error;
      }
    },
  });

  scheduler.add(task);
}

function createCollect(scheduler: TransferSchedulerLike, remoteHost?: string) {
  return (task: TransferTask) => scheduleTask(scheduler, task, remoteHost);
}

function createTransferHandle(direction: TransferDirection) {
  return async function handle(this: FileHandlerContext, option) {
    const remoteFs = await this.fileService.getRemoteFileSystem(this.config);
    const localFs = this.fileService.getLocalFileSystem();
    const { localFsPath, remoteFsPath } = this.target;
    const scheduler = this.fileService.createTransferScheduler(this.config.concurrency);
    const remoteHost = this.config.host;
    let transferConfig;

    if (direction === TransferDirection.REMOTE_TO_LOCAL) {
      transferConfig = {
        srcFsPath: remoteFsPath,
        srcFs: remoteFs,
        targetFsPath: localFsPath,
        targetFs: localFs,
        transferOption: option,
        transferDirection: TransferDirection.REMOTE_TO_LOCAL,
      };
    } else {
      transferConfig = {
        srcFsPath: localFsPath,
        srcFs: localFs,
        targetFsPath: remoteFsPath,
        targetFs: remoteFs,
        transferOption: option,
        filePerm: this.config.filePerm,
        dirPerm: this.config.dirPerm,
        transferDirection: TransferDirection.LOCAL_TO_REMOTE,
      };
    }
    const collect = createCollect(scheduler, remoteHost);
    await transfer(transferConfig, collect);
    await scheduler.run();
  };
}

const uploadHandle = createTransferHandle(TransferDirection.LOCAL_TO_REMOTE);
const downloadHandle = createTransferHandle(TransferDirection.REMOTE_TO_LOCAL);

async function openDownloadedIfFile(this: FileHandlerContext) {
  const { localFsPath } = this.target;
  try {
    const stat = await this.fileService.getLocalFileSystem().lstat(localFsPath);
    if (stat.type === FileType.File) {
      await openDownloadedFile(this.target.localUri);
    }
  } catch {
    // Ignore open failures — the download itself succeeded.
  }
}

export const sync2Remote = createFileHandler<SyncOption>({
  name: 'sync local ➞ remote',
  async handle(option) {
    const remoteFs = await this.fileService.getRemoteFileSystem(this.config);
    const localFs = this.fileService.getLocalFileSystem();
    const { localFsPath, remoteFsPath } = this.target;
    const scheduler = this.fileService.createTransferScheduler(this.config.concurrency);
    option.filePerm = this.config.filePerm;
    option.dirPerm = this.config.dirPerm;
    const collect = createCollect(scheduler, this.config.host);
    await sync(
      {
        srcFsPath: localFsPath,
        srcFs: localFs,
        targetFsPath: remoteFsPath,
        targetFs: remoteFs,
        transferOption: option,
        transferDirection: TransferDirection.LOCAL_TO_REMOTE,
      },
      collect
    );
    await scheduler.run();
  },
  transformOption() {
    const config = this.config;
    const syncOption = config.syncOption || {};
    return {
      perserveTargetMode: config.protocol === 'sftp' && !config.filePerm && !config.dirPerm,
      useTempFile: config.useTempFile,
      openSsh: config.openSsh,
      ignore: config.ignore,
      delete: syncOption.delete,
      skipCreate: syncOption.skipCreate,
      ignoreExisting: syncOption.ignoreExisting,
      update: syncOption.update,
    };
  },
  afterHandle() {
    refreshRemoteExplorer(this.target, true);
  },
});

export const sync2Local = createFileHandler<SyncOption>({
  name: 'sync remote ➞ local',
  async handle(option) {
    const remoteFs = await this.fileService.getRemoteFileSystem(this.config);
    const localFs = this.fileService.getLocalFileSystem();
    const { localFsPath, remoteFsPath } = this.target;
    const scheduler = this.fileService.createTransferScheduler(this.config.concurrency);
    const collect = createCollect(scheduler, this.config.host);
    await sync(
      {
        srcFsPath: remoteFsPath,
        srcFs: remoteFs,
        targetFsPath: localFsPath,
        targetFs: localFs,
        transferOption: option,
        transferDirection: TransferDirection.REMOTE_TO_LOCAL,
      },
      collect
    );
    await scheduler.run();
  },
  transformOption() {
    const config = this.config;
    const syncOption = config.syncOption || {};
    return {
      perserveTargetMode: false,
      ignore: config.ignore,
      delete: syncOption.delete,
      skipCreate: syncOption.skipCreate,
      ignoreExisting: syncOption.ignoreExisting,
      update: syncOption.update,
    };
  },
});

export const upload = createFileHandler<TransferOption>({
  name: 'upload',
  handle: uploadHandle,
  transformOption() {
    const config = this.config;
    return {
      perserveTargetMode: config.protocol === 'sftp' && !config.filePerm && !config.dirPerm,
      useTempFile: config.useTempFile,
      openSsh: config.openSsh,
      ignore: config.ignore,
    };
  },
  afterHandle() {
    refreshRemoteExplorer(this.target, this.fileService);
  },
});

export const uploadFile = createFileHandler<TransferOption>({
  name: 'upload file',
  handle: uploadHandle,
  transformOption() {
    const config = this.config;
    return {
      perserveTargetMode: config.protocol === 'sftp' && !config.filePerm,
      useTempFile: config.useTempFile,
      openSsh: config.openSsh,
      ignore: config.ignore,
    };
  },
  afterHandle() {
    refreshRemoteExplorer(this.target, false);
  },
});

export const uploadFolder = createFileHandler<TransferOption>({
  name: 'upload folder',
  handle: uploadHandle,
  transformOption() {
    const config = this.config;
    return {
      perserveTargetMode: config.protocol === 'sftp' && !config.dirPerm,
      useTempFile: config.useTempFile,
      openSsh: config.openSsh,
      ignore: config.ignore,
    };
  },
  afterHandle() {
    refreshRemoteExplorer(this.target, true);
  },
});

export const download = createFileHandler<TransferOption>({
  name: 'download',
  handle: downloadHandle,
  transformOption() {
    const config = this.config;
    return {
      perserveTargetMode: false,
      ignore: config.ignore,
    };
  },
  afterHandle: openDownloadedIfFile,
});

export const downloadFile = createFileHandler<TransferOption>({
  name: 'download file',
  handle: downloadHandle,
  transformOption() {
    const config = this.config;
    return {
      perserveTargetMode: false,
      ignore: config.ignore,
    };
  },
  afterHandle: openDownloadedIfFile,
});

export const downloadFolder = createFileHandler<TransferOption>({
  name: 'download folder',
  handle: downloadHandle,
  transformOption() {
    const config = this.config;
    return {
      perserveTargetMode: false,
      ignore: config.ignore,
    };
  },
});

export * from './transfer';
