和 Blink 比，你现在的 TinyConnect 已经有 Web SSH、tmux 恢复、Key 管理、Saved Host、设置同步、设备 link、SFTP、Debug/log、主题字体这些基础，但差距主要在这几层。

  核心底层差距

  1. 没有原生 Mosh
      - Blink 可以在 iOS 端直接跑 Mosh client，手机切 Wi-Fi/蜂窝时 UDP 会话仍能恢复。
      - TinyConnect 是浏览器 WebSocket 到服务端，再 SSH 到远端。手机到服务端这段仍依赖 WebSocket。

  2. 没有完整 SSH 高级能力
      - Blink 有 Jump Host、ProxyCommand、Port Forwarding、SOCKS、Agent Forwarding。
      - TinyConnect 当前主要是直连 SSH + key。

  3. 没有本地密钥/系统钥匙串级别集成
      - Blink 是原生 App，可以用 iOS Secure Enclave / Keychain / Files / Shortcuts 等能力。
      - TinyConnect key 在 Supabase 和服务端缓存，安全模型不同。

  终端体验差距
  4. 键盘体验还弱

  - Blink 的 Smart Keys、手势、快捷键、外接键盘支持更成熟。
  - TinyConnect 现在有基础快捷键和草稿区，但还缺可配置 keybar、tmux prefix、Ctrl/Alt 组合、方向键体验打磨。

  5. 终端交互细节
      - Blink 对移动端选择、复制、滚动、字体渲染、IME、外接键盘更原生。
      - TinyConnect 受浏览器限制，复制/选区/输入法体验需要继续做适配层。

  6. 本地命令环境
      - Blink 有本地 shell、Blink Code、文件系统集成等。
      - TinyConnect 更像远程终端入口，没有本地开发环境。

  连接管理差距
  7. 会话恢复模型

  - Blink + Mosh 是协议级恢复。
  - TinyConnect 是应用级恢复：WebSocket reconnect + 服务端 SSH session + tmux。能用，但不是同一层级。

  8. 连接编排
      - Blink 的 ssh_config/host aliases/代理/跳板更接近专业 SSH 工具链。
      - TinyConnect Saved Host 还比较产品化，但不够 SSH 原生兼容。

  文件和开发工作流差距
  9. 文件能力

  - Blink 有更成熟的文件/编辑器/远程开发集成。
  - TinyConnect SFTP 还偏基础：上传下载、目录浏览，缺预览、编辑、拖拽、进度、收藏路径。

  10. 开发辅助

  - Blink 生态有 Code、VS Code remote 类体验、Shortcuts 自动化。
  - TinyConnect 可以往 “Codex 远程工作台” 做差异化，但还没形成完整工作流。

  安全差距
  11. Known Hosts / host key 校验

  - Blink 作为 SSH 客户端会更重视 host fingerprint。
  - TinyConnect 目前还没完整做首次信任、指纹变更告警。

  12. 权限和审计

  - TinyConnect 有 Debug/log 雏形，但还缺：
      - key 使用审计
      - 设备撤销后的 session 处理
      - host fingerprint 记录
      - 更细的用户身份模型

  TinyConnect 可以反超 Blink 的方向
  你的产品不一定要完全复制 Blink。Web 形态的优势是：

  - 多设备同步更自然。
  - 可以做团队/设备管理。
  - 可以围绕 Codex 做一键进入项目、习惯命令、会话恢复。
  - 可以做浏览器内 Debug、日志、连接画像。
  - 可以和 Supabase/云端设置做轻量 SaaS。

  建议优先补齐
  按收益排序：

  1. Known Hosts 指纹校验。
  2. Port Forwarding / SOCKS。
  3. Jump Host / ProxyCommand。
  4. 可配置 Smart Keys。
  5. Snippets 和 Startup Habits 分层。
  6. Mosh-backed transport 实验版。
  7. SFTP 文件预览/编辑。
  8. 设备撤销 + session 强制失效。
  9. SSH config import/export。
  10. 更完整的连接日志和失败诊断。

  最关键一句：Blink 强在“原生终端协议能力”，TinyConnect 应该强在“Web 同步、移动远程工作流、Codex 场景”。
