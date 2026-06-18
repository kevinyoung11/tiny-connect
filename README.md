# TinyConnect

手机浏览器使用的 Web SSH terminal，支持 SSH key 管理、保存主机、多 tab、SFTP、tmux、复制模式和断线重连。

## 启动

需要 Supabase 配置：

```bash
export SUPABASE_URL="https://你的项目.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="你的 service role key"
export Direct_Link="postgresql://..."
npm install
PORT=8789 npm start
```

启动后终端会打印：

```text
tiny-connect listening on http://localhost:8789
LAN: http://你的电脑局域网IP:8789
```

手机和电脑连同一个 Wi-Fi，用手机浏览器打开 `LAN` 地址。

## SSH Key 和 Saved Hosts

- SSH key 按设备用户保存到 Supabase。
- 本地私钥缓存按用户隔离在 `.keys/<userId>/<keyId>.pem`。
- Saved Hosts 保存 host、port、username、key、passphrase 和 tmux 选项。
- Saved tab 用来选择已保存主机。

## Settings

Settings 中可配置：

- Font size：终端字体大小。
- Keepalive interval：SSH keepalive 间隔。
- Disconnect timeout：手机断开后服务端保留 SSH session 的时间，支持 `Never`。
- Auto reconnect：手机浏览器回来后自动重连到保留的 session。
- Startup habits：按优先级保存启动命令，例如 `cd ~/project && codex`。
- Device pairing：老设备生成 6 位码，新设备输入后绑定到同一个用户。

注意：浏览器或部署平台仍可能被系统回收。长期任务建议开启 tmux。

## Supabase Migration

如果部署环境不能直连 Postgres 自动建表，在 Supabase SQL editor 手动执行：

```sql
CREATE TABLE IF NOT EXISTS device_pairing_codes (
  code       TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS device_pairing_codes_user_idx
ON device_pairing_codes(user_id, created_at DESC);

ALTER TABLE device_pairing_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "device_pairing_codes_client_select" ON device_pairing_codes;
DROP POLICY IF EXISTS "device_pairing_codes_client_insert" ON device_pairing_codes;
DROP POLICY IF EXISTS "device_pairing_codes_client_update" ON device_pairing_codes;
DROP POLICY IF EXISTS "device_pairing_codes_client_delete" ON device_pairing_codes;
CREATE POLICY "device_pairing_codes_client_select" ON device_pairing_codes FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "device_pairing_codes_client_insert" ON device_pairing_codes FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "device_pairing_codes_client_update" ON device_pairing_codes FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "device_pairing_codes_client_delete" ON device_pairing_codes FOR DELETE TO anon, authenticated USING (true);
```

## 终端操作

- HUD 和底部快捷栏支持 Paste。
- Copy Mode 会把当前 terminal buffer 展开成可选择文本，方便手机浏览器长按选择复制。
- Files 打开当前 SSH session 的 SFTP 文件浏览器，支持上传和下载。

## 常用环境变量

- `PORT=8787`：修改端口
- `HOST=0.0.0.0`：监听地址
- `TERMINAL_SHELL=/bin/zsh`：本地模式 shell
- `STARTUP_COMMAND="tmux new -A -s codex"`：连接后自动执行命令
