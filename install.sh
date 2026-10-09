#!/bin/bash
# CloudCLI 本机定制版一键安装（macOS）
#   用法:  ./install.sh                         # 不走代理
#          PROXY=http://127.0.0.1:7897 ./install.sh   # Claude 需要走本地代理时
# 做的事: 装 @cloudcli-ai/cloudcli@1.37.3 → 覆盖补丁文件 → 写 launchd 常驻 → 注册占位用户并跳过引导
# 前提:   已装 Node 20+ 和 Claude Code CLI，并且终端里 `claude` 已登录（订阅账号）
set -euo pipefail

VERSION=1.37.3
PORT=3001
LABEL=com.cloudcli.server
KIT="$(cd "$(dirname "$0")" && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m错误:\033[0m %s\n' "$*" >&2; exit 1; }

[[ "$(uname)" == Darwin ]] || die "这个脚本只支持 macOS（launchd、open 命令都依赖它）"
NODE="$(command -v node)" || die "找不到 node，请先装 Node 20+（推荐 nvm）"
command -v npm >/dev/null || die "找不到 npm"
CLAUDE="$(command -v claude)" || die "找不到 claude，请先装 Claude Code CLI 并登录"
NODE_MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"
(( NODE_MAJOR >= 20 )) || die "Node 版本太旧（$("$NODE" -v)），需要 20 以上"

# 1. 安装固定版本：补丁依赖 1.37.3 的文件结构，别装最新版
say "安装 @cloudcli-ai/cloudcli@$VERSION"
npm install -g "@cloudcli-ai/cloudcli@$VERSION"
PKG="$(npm root -g)/@cloudcli-ai/cloudcli"
[[ "$("$NODE" -p "require('$PKG/package.json').version")" == "$VERSION" ]] || die "装上的版本不是 $VERSION"

# 2. 覆盖补丁文件，原文件第一次覆盖前备份成 *.orig
say "应用补丁到 $PKG"
cd "$KIT/files"
find . -type f | while read -r f; do
  dst="$PKG/${f#./}"
  mkdir -p "$(dirname "$dst")"
  [[ -f "$dst" && ! -f "$dst.orig" ]] && cp "$dst" "$dst.orig"
  cp "$f" "$dst"
done
cd "$KIT"

# 3. launchd 常驻。launchd 不读 shell 配置，所以 node / claude 的目录都写成绝对路径
say "写入 $PLIST"
mkdir -p "$HOME/.cloudcli" "$HOME/Library/LaunchAgents"
PATH_VALUE="$(dirname "$NODE"):$(dirname "$CLAUDE"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
PROXY_XML=""
if [[ -n "${PROXY:-}" ]]; then
  for k in http_proxy https_proxy HTTP_PROXY HTTPS_PROXY; do
    PROXY_XML+="    <key>$k</key><string>$PROXY</string>"$'\n'
  done
  for k in no_proxy NO_PROXY; do
    PROXY_XML+="    <key>$k</key><string>localhost,127.0.0.1,::1</string>"$'\n'
  done
fi
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$PKG/dist-server/server/modules/cli/cli.js</string>
  </array>
  <key>WorkingDirectory</key><string>$HOME</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$PATH_VALUE</string>
    <key>HOME</key><string>$HOME</string>
$PROXY_XML  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>$HOME/.cloudcli/server.log</string>
  <key>StandardErrorPath</key><string>$HOME/.cloudcli/server.log</string>
</dict>
</plist>
EOF
plutil -lint "$PLIST" >/dev/null

# 端口被旧实例占着时 launchd 会无限重启，先清掉
OLD_PID="$(lsof -nP -t -iTCP:$PORT -sTCP:LISTEN 2>/dev/null || true)"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
[[ -n "$OLD_PID" ]] && { say "结束占用 $PORT 端口的旧进程 $OLD_PID"; kill $OLD_PID 2>/dev/null || true; sleep 1; }
launchctl bootstrap "gui/$(id -u)" "$PLIST"

say "等待服务启动"
for _ in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:$PORT/" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "http://127.0.0.1:$PORT/" >/dev/null 2>&1 || die "服务没起来，看日志: tail -50 ~/.cloudcli/server.log"

# 4. 注册占位用户（免登录模式下所有请求都映射到第一个用户，密码随机生成后不再使用）
say "注册占位用户 local 并跳过首次引导"
PW="$(openssl rand -hex 16)"
curl -fsS -X POST "http://127.0.0.1:$PORT/api/auth/register" \
  -H 'Content-Type: application/json' -d "{\"username\":\"local\",\"password\":\"$PW\"}" >/dev/null 2>&1 \
  || echo "   （已有用户，跳过注册）"
curl -fsS -X POST "http://127.0.0.1:$PORT/api/user/complete-onboarding" \
  -H 'Authorization: Bearer local' -H 'Content-Type: application/json' -d '{}' >/dev/null 2>&1 || true

say "完成 → 打开 http://localhost:$PORT"
echo "   日志:   tail -f ~/.cloudcli/server.log"
echo "   重启:   launchctl kickstart -k gui/\$(id -u)/$LABEL"
echo "   卸载:   ./uninstall.sh"
open "http://localhost:$PORT" || true
