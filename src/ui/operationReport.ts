import * as vscode from 'vscode';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ReportKind = 'upload' | 'download' | 'delete';

/** Server-side or local-side stat snapshot for a single path. */
export interface FileSideStat {
  size: number;
  mode: number;
  mtime: number;
}

/** One line in the operation log. */
export interface Row {
  /** Short verb: 'uploaded', 'downloaded', 'deleted', … */
  action: string;
  /** The primary path (remote for delete; local for upload/download). */
  path: string;
  /** For delete rows: where the deletion happened. */
  scope?: 'server' | 'local' | 'both';
  /** Server-side stat at the moment of the operation. */
  server?: FileSideStat | null;
  /** Local-side stat at the moment of the operation. */
  local?: FileSideStat | null;
  /** Optional extra note shown after the path. */
  note?: string;
  /** True for a failed operation — drives the ✖ marker and the result tally. */
  failed?: boolean;
}

// ─── Module state ─────────────────────────────────────────────────────────────

interface ActiveReport {
  kind: ReportKind;
  rows: Row[];
  // Ref-count so two overlapping commands share one session and the LAST to finish renders —
  // otherwise the first finisher nulls `active` out from under a still-running second command.
  refs: number;
}

let active: ActiveReport | null = null;

// ─── Public API ──────────────────────────────────────────────────────────────

export function isActive(): boolean {
  return active !== null;
}

export function addRow(row: Row): void {
  if (active) {
    active.rows.push(row);
  }
}

/**
 * Run `work` inside a report session for `kind`.
 * If a session is already active (nested call) the work joins it without opening a second tab.
 * After `work` completes the rendered log is opened as a virtual document.
 */
export async function withReport<T>(kind: ReportKind, work: () => Promise<T>): Promise<T> {
  let session: ActiveReport;
  if (active) {
    session = active;
    session.refs += 1;
  } else {
    session = { kind, rows: [], refs: 1 };
    active = session;
  }

  try {
    return await work();
  } finally {
    session.refs -= 1;
    if (session.refs === 0) {
      if (active === session) {
        active = null;
      }
      if (session.rows.length > 0) {
        await openReport(session.kind, session.rows).catch(() => {
          // Never let a display failure surface as an error from the operation.
        });
      }
    }
  }
}

// ─── Virtual document provider ───────────────────────────────────────────────

export const REPORT_SCHEME = 'sftp-report';

const reportContents = new Map<string, string>();

export const reportProvider: vscode.TextDocumentContentProvider = {
  provideTextDocumentContent(uri: vscode.Uri): string {
    return reportContents.get(uri.toString()) ?? '';
  },
};

// ─── Formatting helpers ──────────────────────────────────────────────────────

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatPerm(mode: number): string {
  // tslint:disable-next-line:no-bitwise
  const bits = mode & 0o777;
  const octal = bits.toString(8).padStart(3, '0');
  const symbols = [0o400, 0o200, 0o100, 0o040, 0o020, 0o010, 0o004, 0o002, 0o001]
    // tslint:disable-next-line:no-bitwise
    .map((bit, i) => (bits & bit ? 'rwx'[i % 3] : '-'))
    .join('');
  return `${octal} (${symbols})`;
}

function formatDate(mtimeMs: number): string {
  const d = new Date(mtimeMs);
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function formatSide(stat: FileSideStat | null | undefined): string {
  if (!stat) return '(unavailable)';
  return `${humanSize(stat.size).padEnd(10)}  ${formatPerm(stat.mode)}  ${formatDate(stat.mtime)}`;
}

function statsDiffer(a: FileSideStat | null | undefined, b: FileSideStat | null | undefined): boolean {
  if (!a || !b) return false;
  // tslint:disable-next-line:no-bitwise
  return a.size !== b.size || Math.floor(a.mtime / 1000) !== Math.floor(b.mtime / 1000) || (a.mode & 0o777) !== (b.mode & 0o777);
}

function renderRows(kind: ReportKind, rows: Row[]): string {
  const kindLabel = kind === 'upload' ? 'upload' : kind === 'download' ? 'download' : 'delete';
  const now = formatDate(Date.now());
  const heading = `${kind}.log — ${now}, ${rows.length} entries  [${kindLabel}]`;
  const separator = '─'.repeat(Math.max(heading.length, 60));
  const lines: string[] = [heading, separator, ''];

  const failedCount = rows.filter(r => r.failed).length;
  if (failedCount > 0) {
    const okCount = rows.length - failedCount;
    lines.push(`Result: ${okCount} ok, ${failedCount} failed`, '');
  }

  for (const row of rows) {
    let primary = `${row.failed ? '✖ ' : ''}${row.action.padEnd(12)}${row.path}`;
    if (row.scope) {
      primary += `  [${row.scope}]`;
    }
    if (row.note) {
      primary += `  — ${row.note}`;
    }
    lines.push(primary);

    const hasLocal = row.local != null;
    const hasServer = row.server != null;

    if (hasLocal || hasServer) {
      const differ = statsDiffer(row.local, row.server);
      if (hasLocal) {
        lines.push(`  local  : ${formatSide(row.local)}`);
      }
      if (hasServer) {
        lines.push(`  server : ${formatSide(row.server)}${differ ? '  ← differ' : ''}`);
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}

export async function openTextReport(fileName: string, body: string): Promise<void> {
  const uri = vscode.Uri.parse(`${REPORT_SCHEME}:/${fileName}?${Date.now()}`);
  reportContents.set(uri.toString(), body);
  while (reportContents.size > 20) {
    reportContents.delete(reportContents.keys().next().value);
  }
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: false });
}

async function openReport(kind: ReportKind, rows: Row[]): Promise<void> {
  await openTextReport(`${kind}.log`, renderRows(kind, rows));
}
