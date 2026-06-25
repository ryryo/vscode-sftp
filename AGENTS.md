# AGENTS.md

## インストール手順

このフォーク版は元拡張と衝突しないよう、拡張 ID を `ryryo.sftp-node24-fix` に変更しています。

### VSIX を作成する

```sh
npx --yes @vscode/vsce package --out sftp-node24-fix-1.16.3.vsix
```

### Cursor にインストールする

Cursor を WSL ワークスペースで使う場合、拡張は Windows local 側と WSL/Cursor Server 側で別々に管理されます。VSIX を更新したら、混乱を避けるため **local と WSL の両方** に同じ VSIX を入れ直してください。

#### WSL 側にインストールする

```sh
cursor --install-extension /home/ryryo/vscode-sftp/sftp-node24-fix-1.16.3.vsix --force
```

#### Windows local 側にインストールする

```sh
cp /home/ryryo/vscode-sftp/sftp-node24-fix-1.16.3.vsix /mnt/c/Users/ryomi/AppData/Local/Temp/sftp-node24-fix-1.16.3.vsix
cmd.exe /c "cd /d C:\Users\ryomi && C:\Users\ryomi\AppData\Local\Programs\cursor\resources\app\bin\cursor.cmd --install-extension C:\Users\ryomi\AppData\Local\Temp\sftp-node24-fix-1.16.3.vsix --force"
```

### インストール確認

```sh
cursor --list-extensions --show-versions | rg -i 'sftp|node24|ryryo'
cmd.exe /c "cd /d C:\Users\ryomi && C:\Users\ryomi\AppData\Local\Programs\cursor\resources\app\bin\cursor.cmd --list-extensions --show-versions" | tr -d '\r' | rg -i 'sftp|node24|ryryo'
```

どちらの確認コマンドでも `ryryo.sftp-node24-fix@1.16.3` が表示されればインストール済みです。

元拡張 `natizyskunk.sftp` が残っている場合は、コマンドや設定が競合しやすいため無効化またはアンインストールしてください。
