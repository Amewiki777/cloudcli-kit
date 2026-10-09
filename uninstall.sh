#!/bin/bash
# 停掉常驻服务并卸载 CloudCLI。~/.cloudcli（数据库、上传的图片）默认保留，加 --purge 一并删除
set -euo pipefail
LABEL=com.cloudcli.server
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
npm uninstall -g @cloudcli-ai/cloudcli || true
if [[ "${1:-}" == "--purge" ]]; then
  rm -rf "$HOME/.cloudcli"
  echo "已删除 ~/.cloudcli"
fi
echo "已卸载。Claude Code 的对话记录（~/.claude/projects）没有动。"
