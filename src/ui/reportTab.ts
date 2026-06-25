import * as vscode from 'vscode';

// Open a report in an editor tab instead of (only) a transient notification.
export async function openReportTab(content: string): Promise<void> {
  try {
    const doc = await vscode.workspace.openTextDocument({ content, language: 'markdown' });
    await vscode.window.showTextDocument(doc, { preview: false });
  } catch {
    /* ignore — the notification already conveyed the gist */
  }
}
