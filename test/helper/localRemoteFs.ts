import * as fs from 'fs';
import * as fse from 'fs-extra';
import FileSystem, { FileStats } from '../../src/core/fs/fileSystem';
import localfs from '../../src/core/localFs';
import RemoteFileSystem from '../../src/core/fs/remoteFileSystem';

// @ts-ignore
export default class LocalRemoteFileSystem extends RemoteFileSystem {
  private _fdPathMap: { [fd: number]: string } = {};

  _createClient() {
    return {};
  }

  async open(path: string, flags: string, mode?: number): Promise<number> {
    const fd = await localfs.open(path, flags, mode);
    this._fdPathMap[fd] = path;
    return fd;
  }

  async close(fd: number): Promise<void> {
    try {
      await localfs.close(fd);
    } catch (error) {
      if (!error || error.code !== 'EBADF') {
        throw error;
      }
    } finally {
      delete this._fdPathMap[fd];
    }
  }

  toFileStat(stat: fs.Stats): FileStats {
    return {
      type: FileSystem.getFileTypecharacter(stat),
      size: stat.size,
      mode: stat.mode & parseInt('777', 8), // tslint:disable-line:no-bitwise
      mtime: this.toLocalTime(stat.mtime.getTime()),
      atime: this.toLocalTime(stat.atime.getTime()),
    };
  }

  futimes(fd: number, atime: number, mtime: number): Promise<void> {
    const remoteAtime = this.toRemoteTimeInSecnonds(atime);
    const remoteMtime = this.toRemoteTimeInSecnonds(mtime);
    return fse.futimes(fd, remoteAtime, remoteMtime).catch(error => {
      const path = this._fdPathMap[fd];
      if (!path || !error || error.code !== 'EBADF') {
        throw error;
      }
      return fse.utimes(path, remoteAtime, remoteMtime);
    });
  }
}

[
  'toFileEntry',
  'readFile',
  'fstat',
  'get',
  'put',
  'mkdir',
  'ensureDir',
  'list',
  'lstat',
  'readlink',
  'symlink',
  'unlink',
  'rmdir',
  'rename',
].forEach(method => {
  Object.defineProperty(LocalRemoteFileSystem.prototype, method, {
    enumerable: false,
    value(...args) {
      const fn = localfs[method];
      return fn.call(this, ...args);
    },
  });
});
