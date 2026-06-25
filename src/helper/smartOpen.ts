import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { showTextDocument } from '../host';

const LARGE_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

const BINARY_EXTS = new Set([
  'exe', 'dll', 'so', 'dylib', 'bin', 'o', 'a', 'lib', 'msi', 'apk', 'app', 'deb', 'rpm', 'class',
  'zip', 'rar', '7z', 'gz', 'tar', 'tgz', 'bz2', 'xz', 'jar', 'war', 'iso', 'dmg',
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'tif', 'tiff', 'webp', 'psd', 'heic',
  'wav', 'mp3', 'flac', 'aac', 'ogg', 'm4a', 'mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'ttf', 'otf', 'woff', 'woff2', 'eot',
  'sqlite', 'db', 'mdb', 'dat',
  'cdr', 'ai', 'eps', 'sketch', 'fig', 'xcf', 'blend',
]);

const TEXT_EXTS = new Set([
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'json', 'json5', 'jsonc', 'py', 'rb', 'php', 'phtml',
  'java', 'c', 'h', 'cpp', 'hpp', 'cc', 'cxx', 'cs', 'go', 'rs', 'swift', 'kt', 'kts', 'scala',
  'lua', 'pl', 'pm', 'r', 'dart', 'ex', 'exs', 'erl', 'hs', 'clj', 'groovy', 'vb', 'fs', 'fsx',
  'sh', 'bash', 'zsh', 'fish', 'bat', 'cmd', 'ps1', 'psm1', 'sql', 'graphql', 'gql', 'proto',
  'html', 'htm', 'xhtml', 'css', 'scss', 'sass', 'less', 'vue', 'svelte', 'astro', 'xml', 'svg',
  'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'config', 'properties', 'env', 'editorconfig',
  'gitignore', 'gitattributes', 'dockerignore', 'csv', 'tsv', 'tab',
  'txt', 'text', 'md', 'markdown', 'rst', 'adoc', 'asciidoc', 'tex', 'log', 'nfo', 'srt', 'vtt',
  'diff', 'patch', 'lock',
]);

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

export async function openDownloadedFile(
  uri: vscode.Uri,
  option?: vscode.TextDocumentShowOptions
): Promise<void> {
  let size = 0;
  try {
    size = fs.statSync(uri.fsPath).size;
  } catch {
    // Can't stat — fall back to the normal open path.
  }

  const name = path.basename(uri.fsPath);
  const ext = path.extname(name).slice(1).toLowerCase();
  const isLarge = size > LARGE_FILE_BYTES;
  const isBinary = BINARY_EXTS.has(ext);
  const isText = ext === '' || TEXT_EXTS.has(ext);

  if (isText && !isLarge) {
    await showTextDocument(uri, option);
    return;
  }

  let question: string;
  if (isLarge) {
    question =
      `"${name}" is ${humanSize(size)} (over 10 MB). Opening large files in VS Code can freeze the editor. Open it anyway?`;
  } else if (isBinary) {
    question =
      `"${name}" looks like a binary file (.${ext}). VS Code can't display it as text and may freeze. Open it anyway?`;
  } else {
    question =
      `"${name}" is not a recognized text file (.${ext}). It may be binary and could make VS Code choke. Open it anyway?`;
  }

  const choice = await vscode.window.showWarningMessage(
    question,
    { modal: true },
    { title: 'Open' },
    { title: 'Reveal in Explorer' }
  );

  if (!choice) {
    return;
  }
  if (choice.title === 'Reveal in Explorer') {
    vscode.commands.executeCommand('revealFileInOS', uri);
    return;
  }
  await showTextDocument(uri, option);
}
