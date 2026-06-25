import { Uri, window, ProgressLocation, CancellationToken } from 'vscode';
import * as fse from 'fs-extra';
import * as nodePath from 'path';
import * as crypto from 'crypto';
import { COMMAND_REMOTEEXPLORER_CALC_FOLDER_SIZE } from '../constants';
import { upath, FileType, FileSystem } from '../core';
import { handleCtxFromUri } from '../fileHandlers';
import { reportError } from '../helper';
import logger from '../logger';
import { ExplorerItem } from '../modules/remoteExplorer';
import { checkCommand } from './abstract/createCommand';
import { openTextReport } from '../ui/operationReport';

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value >= 10 || i === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`;
}

function groupDigits(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function sizeDetail(bytes: number): string {
  return `${groupDigits(bytes)} bytes (${humanSize(bytes)})`;
}

function formatPerm(mode: number): string {
  // tslint:disable-next-line:no-bitwise
  const bits = mode & 0o777;
  const octal = bits.toString(8).padStart(3, '0');
  const sym = [0o400, 0o200, 0o100, 0o040, 0o020, 0o010, 0o004, 0o002, 0o001]
    // tslint:disable-next-line:no-bitwise
    .map((b, i) => (bits & b ? 'rwx'[i % 3] : '-'))
    .join('');
  return `${octal} (${sym})`;
}

interface SizeAcc {
  files: number;
  folders: number;
  bytes: number;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      v => {
        clearTimeout(timer);
        resolve(v);
      },
      e => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

function execClient(remoteFs: FileSystem): any {
  return (remoteFs as any).getClient ? (remoteFs as any).getClient() : null;
}

async function serverDuBytes(remoteFs: FileSystem, remotePath: string): Promise<number | null> {
  const client = execClient(remoteFs);
  if (!client || typeof client.exec !== 'function') {
    return null;
  }
  if (/[\r\n\0]/.test(remotePath)) {
    return null;
  }
  const quoted = `'${remotePath.replace(/'/g, `'\\''`)}'`;
  const attempts: Array<{ cmd: string; toBytes: (n: number) => number }> = [
    { cmd: `du -sb ${quoted}`, toBytes: n => n },
    { cmd: `du -sk ${quoted}`, toBytes: n => n * 1024 },
  ];
  for (const attempt of attempts) {
    try {
      const out = await client.exec(attempt.cmd);
      const n = parseInt(String(out).trim().split(/\s+/)[0], 10);
      if (Number.isFinite(n)) {
        return attempt.toBytes(n);
      }
    } catch (e) {
      // try the next form
    }
  }
  return null;
}

async function serverFileMd5(remoteFs: FileSystem, remotePath: string): Promise<string | null> {
  const client = execClient(remoteFs);
  if (!client || typeof client.exec !== 'function' || /[\r\n\0]/.test(remotePath)) {
    return null;
  }
  const q = `'${remotePath.replace(/'/g, `'\\''`)}'`;
  const cmds = [`md5sum ${q}`, `md5 -q ${q}`, `openssl md5 -r ${q}`];
  let lastErr = '';
  for (const cmd of cmds) {
    try {
      const out = String(await withTimeout(client.exec(cmd), 120000));
      const m = out.match(/\b[0-9a-fA-F]{32}\b/);
      if (m) {
        return m[0].toLowerCase();
      }
    } catch (e) {
      lastErr = (e && (e as Error).message) || String(e);
      logger.debug(`server md5: \`${cmd}\` failed: ${lastErr}`);
    }
  }
  logger.info(`server md5 unavailable for ${remotePath}${lastErr ? ` — ${lastErr}` : ''}`);
  return null;
}

function localFileMd5(filePath: string): Promise<string | null> {
  return new Promise(resolve => {
    try {
      const hash = crypto.createHash('md5');
      const stream = (fse as any).createReadStream(filePath);
      stream.on('data', (d: Buffer) => hash.update(d));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', () => resolve(null));
    } catch (e) {
      resolve(null);
    }
  });
}

async function serverFolderFingerprint(remoteFs: FileSystem, remotePath: string): Promise<string | null> {
  const client = execClient(remoteFs);
  if (!client || typeof client.exec !== 'function' || /[\r\n\0]/.test(remotePath)) {
    return null;
  }
  const q = `'${remotePath.replace(/'/g, `'\\''`)}'`;
  const cmd = `find ${q} -type f -exec md5sum {} + 2>/dev/null | awk '{print $1}' | LC_ALL=C sort | md5sum`;
  logger.info(`server md5 (folder): hashing every file under ${remotePath} — can take a while on large folders…`);
  try {
    const out = String(await withTimeout(client.exec(cmd), 600000));
    const m = out.match(/\b[0-9a-fA-F]{32}\b/);
    return m ? m[0].toLowerCase() : null;
  } catch (e) {
    logger.info(`server md5 (folder) failed for ${remotePath}: ${(e && (e as Error).message) || String(e)}`);
    return null;
  }
}

async function localFolderFingerprint(dir: string, token: CancellationToken): Promise<string | null> {
  const hexes: string[] = [];
  async function walk(d: string): Promise<void> {
    let entries: any[];
    try {
      entries = await (fse.readdir as any)(d, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const entry of entries) {
      if (token.isCancellationRequested) {
        return;
      }
      const full = nodePath.join(d, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const h = await localFileMd5(full);
        if (h) {
          hexes.push(h);
        }
      }
    }
  }
  try {
    await walk(dir);
    hexes.sort();
    const buf = Buffer.from(hexes.map(h => `${h}\n`).join(''), 'utf8');
    return crypto.createHash('md5').update(buf).digest('hex');
  } catch (e) {
    return null;
  }
}

async function walkRemoteSize(
  remoteFs: FileSystem,
  dir: string,
  token: CancellationToken,
  acc: SizeAcc,
  onTick: () => void
): Promise<void> {
  const entries = await remoteFs.list(dir);
  for (const entry of entries) {
    if (token.isCancellationRequested) {
      return;
    }
    if (entry.type === FileType.Directory) {
      acc.folders += 1;
      await walkRemoteSize(remoteFs, entry.fspath, token, acc, onTick);
    } else {
      acc.files += 1;
      acc.bytes += entry.size || 0;
    }
    onTick();
  }
}

async function localDirSize(dir: string, token: CancellationToken): Promise<SizeAcc | null> {
  const acc: SizeAcc = { files: 0, folders: 0, bytes: 0 };
  async function walk(d: string): Promise<void> {
    const entries: any[] = await (fse.readdir as any)(d, { withFileTypes: true });
    for (const entry of entries) {
      if (token.isCancellationRequested) {
        return;
      }
      const full = nodePath.join(d, entry.name);
      if (entry.isDirectory()) {
        acc.folders += 1;
        await walk(full);
      } else if (entry.isFile()) {
        acc.files += 1;
        try {
          acc.bytes += (await fse.stat(full)).size;
        } catch (e) {
          // unreadable file — skip its size
        }
      }
    }
  }
  try {
    await walk(dir);
    return acc;
  } catch (e) {
    return null;
  }
}

export default checkCommand({
  id: COMMAND_REMOTEEXPLORER_CALC_FOLDER_SIZE,
  async handleCommand(item) {
    try {
      let uri: Uri | undefined;
      if (item instanceof Uri) {
        uri = item;
      } else if (item && (item as ExplorerItem).resource) {
        uri = (item as ExplorerItem).resource.uri;
      }
      if (!uri) {
        return;
      }

      const ctx = handleCtxFromUri(uri);
      const remoteFs = await ctx.fileService.getRemoteFileSystem(ctx.config);
      const remotePath = ctx.target.remoteFsPath;
      const localPath = ctx.target.localFsPath;
      const name = upath.basename(remotePath) || remotePath;

      let serverMode: number | undefined;
      let serverStat: any;
      let serverLstatError = '';
      try {
        serverStat = await remoteFs.lstat(remotePath);
        serverMode = serverStat.mode;
      } catch (e) {
        serverLstatError = (e && (e as Error).message) || String(e);
        logger.info(`Size & MD5: server lstat failed for ${remotePath}: ${serverLstatError}`);
      }
      let isDir: boolean;
      if (!(item instanceof Uri) && typeof (item as ExplorerItem).isDirectory === 'boolean') {
        isDir = (item as ExplorerItem).isDirectory;
      } else if (typeof serverMode === 'number') {
        // tslint:disable-next-line:no-bitwise
        isDir = (serverMode & 0o170000) === 0o040000;
      } else {
        try {
          isDir = (await fse.stat(localPath)).isDirectory();
        } catch (e) {
          isDir = true;
        }
      }

      let wantMd5 = true;
      if (isDir) {
        const pick = await window.showWarningMessage(
          `Compute MD5 for the folder "${name}"? MD5 hashes every file recursively and can be slow on large folders. The size is computed either way.`,
          { modal: true },
          'Size + MD5',
          'Size only'
        );
        if (pick === undefined) {
          return;
        }
        wantMd5 = pick === 'Size + MD5';
      }

      await window.withProgress(
        {
          location: ProgressLocation.Notification,
          title: `SFTP: inspecting "${name}"…`,
          cancellable: true,
        },
        async (progress, token) => {
          const lines: string[] = [];
          const naServerMd5 = '(n/a — needs SFTP + md5sum)';

          if (!isDir) {
            const serverSize: number | null = serverStat ? serverStat.size : null;
            let serverMd5: string | null = null;
            if (serverStat) {
              progress.report({ message: 'hashing on server…' });
              serverMd5 = await serverFileMd5(remoteFs, remotePath);
            }

            let localSize: number | null = null;
            let localMd5: string | null = null;
            let hasLocal = false;
            try {
              const st = await fse.stat(localPath);
              hasLocal = st.isFile();
              if (hasLocal) {
                localSize = st.size;
              }
            } catch (e) {
              hasLocal = false;
            }
            if (hasLocal && !token.isCancellationRequested) {
              progress.report({ message: 'hashing local copy…' });
              localMd5 = await localFileMd5(localPath);
            }
            if (token.isCancellationRequested) {
              return;
            }

            lines.push(`File — ${name}`);
            lines.push('='.repeat(Math.max(20, name.length + 12)));
            lines.push('');
            lines.push('Server');
            lines.push(`  path  : ${remotePath}`);
            if (!serverStat) {
              lines.push(`  ⚠ NOT FOUND on server${serverLstatError ? ` — ${serverLstatError}` : ''}`);
            } else {
              if (serverMode !== undefined) {
                lines.push(`  perms : ${formatPerm(serverMode)}`);
              }
              lines.push(
                `  size  : ${serverSize === null ? '(unknown)' : sizeDetail(serverSize)}`
              );
              lines.push(`  md5   : ${serverMd5 || naServerMd5}`);
            }
            lines.push('');
            lines.push('Local');
            if (hasLocal) {
              lines.push(`  path  : ${localPath}`);
              lines.push(`  size  : ${localSize === null ? '?' : sizeDetail(localSize)}`);
              lines.push(`  md5   : ${localMd5 || '?'}`);
            } else {
              lines.push(`  ${localPath ? '(no local copy)' : '(n/a)'}`);
            }
            if (serverMd5 && localMd5) {
              lines.push('');
              lines.push(
                serverMd5 === localMd5
                  ? 'MD5: ✓ match — server and local are identical'
                  : 'MD5: ✗ DIFFER — server and local are not the same'
              );
            }
          } else {
            let serverBytes: number | null = null;
            let serverCounts: SizeAcc | null = null;
            if (serverStat) {
              if (ctx.config.protocol === 'sftp') {
                serverBytes = await serverDuBytes(remoteFs, remotePath);
              }
              if (serverBytes === null) {
                const acc: SizeAcc = { files: 0, folders: 0, bytes: 0 };
                let lastTick = 0;
                try {
                  await walkRemoteSize(remoteFs, remotePath, token, acc, () => {
                    const now = Date.now();
                    if (now - lastTick < 150) return;
                    lastTick = now;
                    progress.report({
                      message: `server: ${acc.files} files, ${humanSize(acc.bytes)}`,
                    });
                  });
                } catch (e) {
                  logger.info(
                    `Size & MD5: server walk failed for ${remotePath}: ${(e && (e as Error).message) || String(e)}`
                  );
                }
                if (token.isCancellationRequested) {
                  return;
                }
                serverBytes = acc.bytes;
                serverCounts = acc;
              }
            }

            progress.report({ message: 'measuring local copy…' });
            let local: SizeAcc | null = null;
            let hasLocal = false;
            try {
              hasLocal = !!localPath && (await fse.stat(localPath)).isDirectory();
            } catch (e) {
              hasLocal = false;
            }
            if (hasLocal) {
              local = await localDirSize(localPath, token);
            }

            let serverFp: string | null = null;
            let localFp: string | null = null;
            if (wantMd5 && serverStat && !token.isCancellationRequested) {
              progress.report({ message: 'hashing on server (md5)…' });
              serverFp = await serverFolderFingerprint(remoteFs, remotePath);
            }
            if (wantMd5 && hasLocal && !token.isCancellationRequested) {
              progress.report({ message: 'hashing local copy (md5)…' });
              localFp = await localFolderFingerprint(localPath, token);
            }
            if (token.isCancellationRequested) {
              return;
            }

            lines.push(`Folder size — ${name}`);
            lines.push('='.repeat(Math.max(20, name.length + 16)));
            lines.push('');
            lines.push('Server');
            lines.push(`  path  : ${remotePath}`);
            if (!serverStat) {
              lines.push(`  ⚠ NOT FOUND on server${serverLstatError ? ` — ${serverLstatError}` : ''}`);
            } else {
              if (serverMode !== undefined) {
                lines.push(`  perms : ${formatPerm(serverMode)}`);
              }
              lines.push(
                `  size  : ${sizeDetail(serverBytes || 0)}` +
                  (serverCounts
                    ? ` · ${serverCounts.files} files · ${serverCounts.folders} folders`
                    : ' · via du')
              );
              if (wantMd5) {
                lines.push(`  md5   : ${serverFp || '(n/a — needs SFTP + md5sum/find)'}`);
              }
            }
            lines.push('');
            lines.push('Local');
            if (local) {
              lines.push(`  path  : ${localPath}`);
              lines.push(
                `  size  : ${sizeDetail(local.bytes)} · ${local.files} files · ${local.folders} folders`
              );
              if (wantMd5) {
                lines.push(`  md5   : ${localFp || '?'}`);
              }
              const diff = (serverBytes || 0) - local.bytes;
              if (diff !== 0) {
                lines.push(
                  `  diff  : ${diff > 0 ? '+' : '−'}${sizeDetail(Math.abs(diff))} ${
                    diff > 0 ? '(more on server)' : '(more locally)'
                  }`
                );
              }
            } else {
              lines.push(`  ${localPath ? '(no local copy)' : '(n/a)'}`);
            }
            if (wantMd5 && serverFp && localFp) {
              lines.push('');
              lines.push(
                serverFp === localFp
                  ? 'MD5: ✓ match — folder contents are identical'
                  : 'MD5: ✗ DIFFER — folder contents are not the same'
              );
            }
          }

          await openTextReport(isDir ? 'folder-size.txt' : 'file-info.txt', lines.join('\n'));
        }
      );
    } catch (error) {
      reportError(error);
    }
  },
});
