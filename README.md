# VS Code 用 SFTP 同期拡張機能

## このフォークについて
このリポジトリは [Natizyskunk/vscode-sftp](https://github.com/Natizyskunk/vscode-sftp) を、私達の利用環境向けに修正・保守するためのフォークです。元拡張 `Natizyskunk.sftp` と衝突しないよう、拡張 ID は `ryryo.sftp-node24-fix`、表示名は `SFTP (Node 24 Fix)` に変更しています。

主な目的は、Cursor / VS Code 1.123 以降に同梱される Node.js 24 系で発生する SFTP download/upload の失敗を回避することです。元 issue は [Natizyskunk/vscode-sftp#590](https://github.com/Natizyskunk/vscode-sftp/issues/590) です。

## 更新情報
- `1.17.0` では保守中フォークの `v2.4.18` を参照し、このフォークに必要な範囲だけを backport しました。
- Remote Explorer にパスコピー、パス指定で開く、ホバー情報、chmod、ローカル / リモート / 両方の削除、サイズ表示、サイズ順ソート、Size & MD5 レポートを追加しました。
- 転送 UX として進捗表示、キャンセル、完了通知、操作レポート、スマートオープンを追加しました。
- 安全性・堅牢性として、双方向同期、case-only rename、realpath / UNC / symlink / subst drive 対応、明示設定時のみの legacy DH、SSH / FTP 周辺の検証とクリーンアップを強化しました。
- `ssh2` を `^1.13.0` から `^1.17.0` に更新し、Node.js 24 系で `TypeError: isDate is not a function` が発生する問題を修正しました。
- Jest 28 の transformer API 変更に合わせてテスト前処理を更新しました。
- 既存の TypeScript compile エラーを修正し、`npm test -- --runInBand` と `npm run compile` が成功する状態にしました。
- テスト環境の Node.js 24 対応として `memfs` を `^3.6.0` に更新し、scheduler spec の open handle を解消しました。
- このフォーク用の VSIX は `sftp-node24-fix-1.17.0.vsix` として生成できます。

[@Natizyskunk](https://github.com/Natizyskunk/) による、メンテナンスおよび更新を継続している新バージョンです 😀 <!-- and [@satiromarra](https://github.com/satiromarra) --> <br>
（メンテナンスが終了した [liximomo の SFTP プラグイン](https://github.com/liximomo/vscode-sftp.git) からフォーク）

- VS Code マーケットプレイス : https://marketplace.visualstudio.com/items?itemName=Natizyskunk.sftp <br>
- VSIX リリース : https://github.com/Natizyskunk/vscode-sftp/releases/

✳ このプロジェクトに、何らかの形で参加していただけると大変嬉しいです。新しい issue や pull request を開く際は、[テンプレート](https://github.com/Natizyskunk/vscode-sftp/issues/new/choose) に従ってください。

## ℹ お知らせ - 2025/03/13
この拡張機能をできる限り最新の状態に保ち、多くの新しい有用な機能を追加してきました。残念ながら、ここ1年半ほどは個人的な理由により、プロジェクトに取り組む時間をほとんど確保できませんでした。今後、再び時間を割けるかどうかも不明です。そのため、現時点では [v1.16.3](https://github.com/Natizyskunk/vscode-sftp/releases/tag/v1.16.3) を、利用可能な最新の公式安定版リリースとお考えください。

## ℹ お知らせ - 2023/06/23
[@liximomo](https://github.com/liximomo) が自身のリポジトリを非推奨とし、VSCode マーケットプレイスでは本リポジトリを推奨するようになったため、こちらが SFTP 拡張機能のメインリポジトリとなっています。
他にも利用可能なフォークが存在します。お気軽にお試しください。

約2年間にわたり、バグ修正や新機能の追加など多くの作業が行われ、50回以上のアップデートがリリースされ、多くの改善と安定性の修正が加えられてきました。😎

約3年間にわたり、多くの修正に取り組み、50回以上の新しいリリースを行い、多くの改善と安定性の修正、そして新機能を提供してきました。

---

VSCode-SFTP では、ローカルディレクトリ内のファイルを追加・編集・削除し、FTP や SSH などのさまざまな転送プロトコルを使ってリモートサーバーのディレクトリと同期できます。最も基本的なセットアップでは、わずか数行の設定で動作し、あらゆるユーザーのニーズに応えるための幅広い詳細設定も利用できます。強力かつ高速で、使い慣れたエディターと環境をそのまま使えるため、開発者の時間を節約するのに役立ちます。

- 機能
  - [Remote Explorer によるリモートブラウズ](#remote-explorer)
  - ローカルとリモートの差分表示
  - ディレクトリの同期
  - アップロード / ダウンロード
  - 保存時アップロード
  - ファイルウォッチャー
  - 複数設定
  - 切り替え可能なプロファイル
  - 一時ファイルのサポート
- [コマンド](https://github.com/Natizyskunk/vscode-sftp/wiki/Commands)
- [デバッグ](#debug)
- [FAQ](#faq)

## インストール

### 方法 1（推奨：自動更新）
1. 拡張機能（Ctrl + Shift + X）を開きます。
2. @liximomo の既存の sftp 拡張機能をアンインストールします。
3. VS Code マーケットプレイスから新しい拡張機能を直接インストールします : https://marketplace.visualstudio.com/items?itemName=Natizyskunk.sftp。
4. 完了です！

### 方法 2（手動更新）
インストールするには、VSCode 内で次の手順に従ってください:
1. 拡張機能（Ctrl + Shift + X）を開きます。
2. @liximomo の既存の sftp 拡張機能をアンインストールします。
3. 上部の「その他のアクション」メニュー（省略記号）を開き、「Install from VSIX…（VSIX からインストール）」をクリックします。
4. VSIX ファイルを探して選択します。
5. VSCode を再読み込みします。
6. 完了です！

## ドキュメント
- [ホーム](https://github.com/Natizyskunk/vscode-sftp/wiki)
- [設定](https://github.com/Natizyskunk/vscode-sftp/wiki/Setting)
- [共通設定](https://github.com/Natizyskunk/vscode-sftp/wiki/Common-Configuration)
- [SFTP 設定](https://github.com/Natizyskunk/vscode-sftp/wiki/SFTP-only-Configuration)
- [FTP 設定](https://github.com/Natizyskunk/vscode-sftp/wiki/FTP(s)-only-Configuration)
- [コマンド](https://github.com/Natizyskunk/vscode-sftp/wiki/Commands)

## 使い方
最新のファイルがすでにリモートサーバー上にある場合は、空のローカルフォルダから始め、プロジェクトをダウンロードしてから同期を行えます。

1. `VS Code` で、リモートサーバーと同期したいローカルディレクトリを開きます（または、リモートサーバーのフォルダ内容をまずローカルにダウンロードして編集するための空のディレクトリを作成します）。
2. Windows/Linux では `Ctrl+Shift+P`、Mac では `Cmd+Shift+P` でコマンドパレットを開き、`SFTP: config` コマンドを実行します。
3. `.vscode` ディレクトリ配下に `sftp.json` という名前の基本設定ファイルが表示されるので、開いてリモートサーバー情報で設定パラメータを編集します。

例:
```json
{
    "name": "Profile Name",
    "host": "name_of_remote_host",
    "protocol": "ftp",
    "port": 21,
    "secure": true,
    "username": "username",
    "remotePath": "/public_html/project", // <--- 「Download Project」を実行すると、このパスがダウンロードされます
    "password": "password",
    "uploadOnSave": false
}
```
`sftp.json` の password パラメータは省略可能です。省略した場合、同期時にパスワードの入力を求められます。
_注：_ バックスラッシュやその他の特殊文字は、バックスラッシュでエスケープする必要があります。

4. `sftp.json` ファイルを保存して閉じます。
5. Windows/Linux では `Ctrl+Shift+P`、Mac では `Cmd+Shift+P` でコマンドパレットを開きます。
6. `sftp` と入力すると、他にも多くのコマンドが表示されます。プロジェクトのファイルエクスプローラーのコンテキストメニューからも、多くのコマンドにアクセスできます。
7. リモートフォルダと同期を始める場合は、`SFTP: Download Project` から始めるのがおすすめです。これにより、`sftp.json` の `remotePath` 設定に示されているディレクトリが、開いているローカルディレクトリにダウンロードされます。
8. 完了です — ローカルで編集できるようになり、保存のたびにアップロードされ、リモートファイルがローカルコピーと同期されます。
9. お楽しみください！

詳しい説明は [wiki](https://github.com/Natizyskunk/vscode-sftp/wiki) をご覧ください。

## 設定例
設定オプションの一覧は [こちら](https://github.com/Natizyskunk/vscode-sftp/wiki/configuration) で確認できます。

- [VS Code 用 SFTP 同期拡張機能](#vs-code-用-sftp-同期拡張機能)
  - [インストール](#インストール)
    - [方法 1（推奨：自動更新）](#方法-1推奨自動更新)
    - [方法 2（手動更新）](#方法-2手動更新)
  - [ドキュメント](#ドキュメント)
  - [使い方](#使い方)
  - [設定例](#設定例)
    - [シンプル](#シンプル)
    - [プロファイル](#プロファイル)
    - [複数コンテキスト](#複数コンテキスト)
    - [接続ホッピング](#接続ホッピング)
      - [シングルホップ](#シングルホップ)
      - [マルチホップ](#マルチホップ)
    - [ユーザー設定での構成](#ユーザー設定での構成)
  - [Remote Explorer](#remote-explorer)
    - [複数選択](#複数選択)
    - [表示順](#表示順)
  - [デバッグ](#debug)
  - [FAQ](#faq)
  - [寄付](#寄付)
    - [Buy Me a Coffee](#buy-me-a-coffee)
    - [PayPal](#paypal)

### シンプル
```json
{
  "host": "host",
  "username": "username",
  "remotePath": "/remote/workspace"
}
```

### プロファイル
```json
{
  "username": "username",
  "password": "password",
  "remotePath": "/remote/workspace/a",
  "watcher": {
    "files": "dist/*.{js,css}",
    "autoUpload": false,
    "autoDelete": false
  },
  "profiles": {
    "dev": {
      "host": "dev-host",
      "remotePath": "/dev",
      "uploadOnSave": true
    },
    "prod": {
      "host": "prod-host",
      "remotePath": "/prod"
    }
  },
  "defaultProfile": "dev"
}
```

_注：_ `context` と `watcher` はルートレベルでのみ利用できます。

プロファイルを切り替えるには `SFTP: Set Profile` を使用します。

### 複数コンテキスト
context は **同じであってはいけません**。
```json
[
  {
    "name": "server1",
    "context": "project/build",
    "host": "host",
    "username": "username",
    "password": "password",
    "remotePath": "/remote/project/build"
  },
  {
    "name": "server2",
    "context": "project/src",
    "host": "host",
    "username": "username",
    "password": "password",
    "remotePath": "/remote/project/src"
  }
]
```

_注：_ このモードでは `name` が必須です。

### 接続ホッピング
SSH プロトコルを使い、プロキシ経由でターゲットサーバーに接続できます。

_注：_ ホップ設定では変数置換は動作しません。

#### シングルホップ
local -> hop -> target
```json
{
  "name": "target",
  "remotePath": "/path/in/target",

  // hop
  "host": "hopHost",
  "username": "hopUsername",
  "privateKeyPath": "/Users/localUser/.ssh/id_rsa", // <-- キーファイルはローカル上にあると想定されます。

  "hop": {
    // target
    "host": "targetHost",
    "username": "targetUsername",
    "privateKeyPath": "/Users/hopUser/.ssh/id_rsa", // <-- キーファイルはホップ上にあると想定されます。
  }
}
```

#### マルチホップ
local -> hopa -> hopb -> target
```json
{
  "name": "target",
  "remotePath": "/path/in/target",

  // hopa
  "host": "hopAHost",
  "username": "hopAUsername",
  "privateKeyPath": "/Users/hopAUsername/.ssh/id_rsa" // <-- キーファイルはローカル上にあると想定されます。

  "hop": [
    // hopb
    {
      "host": "hopBHost",
      "username": "hopBUsername",
      "privateKeyPath": "/Users/hopaUser/.ssh/id_rsa" // <-- キーファイルは hopa 上にあると想定されます。
    },

    // target
    {
      "host": "targetHost",
      "username": "targetUsername",
      "privateKeyPath": "/Users/hopbUser/.ssh/id_rsa", // <-- キーファイルは hopb 上にあると想定されます。
    }
  ]
}
```

### ユーザー設定での構成
`remote` を使って、sftp に [remote-fs](https://github.com/liximomo/vscode-remote-fs) から設定を取得させることができます。

ユーザー設定:
```json
"remotefs.remote": {
  "dev": {
    "scheme": "sftp",
    "host": "host",
    "username": "username",
    "rootPath": "/path/to/somewhere"
  },
  "projectX": {
    "scheme": "sftp",
    "host": "host",
    "username": "username",
    "privateKeyPath": "/Users/xx/.ssh/id_rsa",
    "rootPath": "/home/foo/some/projectx"
  }
}
```

sftp.json:
```json
{
  "remote": "dev",
  "remotePath": "/home/xx/",
  "uploadOnSave": false,
  "ignore": [".vscode", ".git", ".DS_Store"]
}
```

## Remote Explorer
![remote-explorer-preview](https://raw.githubusercontent.com/Natizyskunk/vscode-sftp/master/assets/showcase/remote-explorer.png)

Remote Explorer では、リモート上のファイルを閲覧できます。Remote Explorer を開く方法:

1. コマンド `View: Show SFTP` を実行します。
2. アクティビティバーの SFTP ビューをクリックします。

Remote Explorer ではファイルの内容を閲覧するだけです。ローカルで編集するには、コマンド `SFTP: Edit in Local` を実行してください。

### 複数選択
リモートサーバー上で、複数のファイル / フォルダを一度に選択してダウンロードおよびアップロードできます。通常のエクスプローラービューと同様に、Ctrl または Shift を押しながら必要なファイルをすべて選択するだけで操作できます。

_注：_ ファイルを **削除** した後、エクスプローラーが正しく更新されない場合は、親フォルダを手動で更新する必要があります。

### 表示順
`sftp.json` 設定ファイル内に `remoteExplorer.order` パラメータを追加することで、リモートエクスプローラーの表示順を変更できます。

sftp.json:
```json
{
  "remoteExplorer": {
    "order": 1 // <-- デフォルト値は 0 です。
  }
}
```

## デバッグ
1. ユーザー設定を開きます。
  - Windows/Linux - `File > Preferences > Settings`
  - macOS - `Code > Preferences > Settings`
2. `sftp.debug` を `true` に設定し、vscode を再読み込みします。
3. `View > Output > sftp` でログを確認します。

## FAQ
よくある質問は [こちら](./FAQ.md) で確認できます。

## 寄付
このプロジェクトが開発時間の短縮に役立ち、金銭的に貢献したいとお考えの場合

### Buy Me a Coffee
[![Buy Me A Coffee](https://bmc-cdn.nyc3.digitaloceanspaces.com/BMC-button-images/custom_images/orange_img.png)](https://www.buymeacoffee.com/Natizyskunk)

### PayPal
<!-- [![PayPal](https://www.paypalobjects.com/en_US/i/btn/btn_donate_SM.gif)](https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=BY89QD47D7MPS&source=url) -->
[![PayPal](https://www.paypalobjects.com/en_US/i/btn/btn_donate_SM.gif)](https://www.paypal.com/donate?business=DELD7APHHM3BC&no_recurring=0&currency_code=EUR)
[![PayPal Me](https://img.shields.io/badge/Donate-PayPal-green.svg)](https://paypal.me/natanfourie)
