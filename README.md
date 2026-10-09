# CloudCLI 本机定制版

在浏览器里用 Claude Code：基于开源的 [@cloudcli-ai/cloudcli](https://www.npmjs.com/package/@cloudcli-ai/cloudcli) 1.37.3，加了一组本地补丁。

## 安装（macOS）

前提：Node 20+、Claude Code CLI 已安装并在终端登录（订阅账号）。

图文手册（含全部代码）：https://amewiki777.github.io/cloudcli-kit/

```bash
git clone https://github.com/Amewiki777/cloudcli-kit.git && cd cloudcli-kit
./install.sh                                  # 不走代理
PROXY=http://127.0.0.1:7897 ./install.sh      # Claude 需要走本地代理时，换成你自己的端口
```

装完打开 http://localhost:3001 。

## 目录

| 路径 | 说明 |
|---|---|
| `install.sh` / `uninstall.sh` | 一键安装 / 卸载（`--purge` 连 ~/.cloudcli 一起删） |
| `files/` | 打好补丁的完整文件，按包内相对路径存放，install.sh 直接覆盖 |
| `patches.diff` | 同一套改动的 unified diff，方便阅读或升级后对照重打 |
| `tools/import_to_claude_desktop.py` | 把 CloudCLI / 终端里的对话挂到 Claude 桌面客户端左侧列表 |

## 补丁做了什么

1. 免登录，只监听 127.0.0.1（`.env`：`VITE_IS_PLATFORM=true`、`HOST=127.0.0.1`；`dist/index.html` 注入占位 token）
2. 只显示 Claude 会话，隐藏 Codex 等其它 provider
3. 会话标题与 Claude 客户端一致（custom-title > ai-title > 首条输入），隐藏 `claude -p` 脚本产生的一次性会话
4. 右下角额度胶囊：5 小时 / 本周 / 本周 Fable 用量
5. 模型标签带版本号（Fable 5.1、Opus 5.5…）
6. 工具调用里的文件名旁加「打开 ▾」菜单：默认程序、指定编辑器、在 Finder 中显示、Markdown 预览
7. 输入框可以粘贴非图片文件
8. 让 Claude 用 LaTeX 写公式（网页端用 KaTeX 渲染）

## 安全

免登录 + 打开本地文件的接口 = **绝对不能对局域网开放**。`.env` 里的 `HOST=127.0.0.1` 不要改。要远程用，请先恢复登录（删掉 `VITE_IS_PLATFORM=true` 和 index.html 里的占位 token 脚本）。

## 运维

```bash
tail -f ~/.cloudcli/server.log                               # 日志
launchctl kickstart -k gui/$(id -u)/com.cloudcli.server      # 重启
lsof -nP -iTCP:3001 -sTCP:LISTEN                             # 谁占着端口
```

**不要 `npm update -g`**：升级会冲掉全部补丁，而且注入脚本依赖 1.37.3 的前端结构。要升级就先对照 `patches.diff` 逐个确认再重打。

## 许可

`files/` 和 `patches.diff` 是对 CloudCLI（AGPL-3.0-or-later）的修改，按同一许可发布，见 [LICENSE](LICENSE)。CloudCLI 原项目：https://www.npmjs.com/package/@cloudcli-ai/cloudcli
