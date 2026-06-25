# AGENTS.md

## インストール手順

このフォーク版は元拡張と衝突しないよう、拡張 ID を `ryryo.sftp-node24-fix` に変更しています。

### VSIX を作成する

```sh
npx --yes @vscode/vsce package --out sftp-node24-fix-1.16.3.vsix
```

### Cursor にインストールする

```sh
cursor --install-extension /home/ryryo/vscode-sftp/sftp-node24-fix-1.16.3.vsix --force
```

### インストール確認

```sh
cursor --list-extensions --show-versions | rg -i 'sftp|node24|ryryo'
```

`ryryo.sftp-node24-fix@1.16.3` が表示されればインストール済みです。

元拡張 `natizyskunk.sftp` が残っている場合は、コマンドや設定が競合しやすいため無効化またはアンインストールしてください。
