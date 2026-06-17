# YY Terminal

手机浏览器控制当前电脑终端的最小可运行版本。

## 启动

```bash
npm install
PORT=8789 npm start
```

启动后终端会打印：

```text
yy-terminal listening on http://localhost:8789
LAN: http://你的电脑局域网IP:8789
```

手机和电脑连同一个 Wi-Fi，用手机浏览器打开 `LAN` 地址。

## SSH 私钥连接

打开页面后，先保存私钥：

1. 连接模式选择 `SSH`
2. 在 Key name 输入一个名字，例如 `prod`
3. 在 Paste private key 粘贴私钥内容
4. 点 `Save Key`

然后连接 SSH：

- `Host`：远程机器 IP 或域名
- `Port`：默认 `22`
- `Username`：远程用户名
- 选择刚保存的 key
- `Passphrase`：私钥密码，没有就留空

注意：私钥会保存到本机项目目录的 `.keys/`，文件权限是 `0600`。列表接口只返回 key 的 `id` 和名字，不返回私钥内容。

## 直接进入 tmux

```bash
PORT=8789 STARTUP_COMMAND="tmux new -A -s codex" npm start
```

进入后可以运行：

```bash
codex
```

## 常用环境变量

- `PORT=8787`：修改端口
- `HOST=0.0.0.0`：监听地址
- `TERMINAL_SHELL=/bin/zsh`：指定 shell
- `STARTUP_COMMAND="tmux new -A -s codex"`：连接后自动执行命令
