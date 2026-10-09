#!/usr/bin/env python3
"""把 ~/.claude/projects 里的 Claude Code 对话挂到 Claude 桌面客户端（Code 标签页）左侧列表。

CloudCLI 和终端里的 claude 都把对话写在 ~/.claude/projects/<编码后的目录>/<id>.jsonl，
桌面客户端左侧列表的每一项则是
  ~/Library/Application Support/Claude/claude-code-sessions/<账号>/<组织>/local_<uuid>.json，
里面的 cliSessionId 指向那个 jsonl。本脚本只新建这些小 JSON，不改任何对话记录。

用法:
  python3 import_to_claude_desktop.py            # 试运行：只统计、预览标题
  python3 import_to_claude_desktop.py --apply    # 真正写入，之后 ⌘Q 退出客户端再打开
撤销: 删掉本脚本写入的 local_*.json（文件里带 "importedBy": "cloudcli-kit"）。
"""
import glob
import json
import os
import re
import sys
import uuid
from datetime import datetime

APPLY = "--apply" in sys.argv
PROJECTS = os.path.expanduser("~/.claude/projects")
SESSIONS_ROOT = os.path.expanduser("~/Library/Application Support/Claude/claude-code-sessions")


def find_meta_dir():
    # <账号>/<组织> 目录里放着现有会话的 local_*.json；取最近用过的那个
    dirs = [d for d in glob.glob(os.path.join(SESSIONS_ROOT, "*", "*")) if os.path.isdir(d)]
    if not dirs:
        sys.exit("找不到桌面客户端的会话目录：先在 Claude 桌面客户端的 Code 标签页里随便开一个会话")
    return max(dirs, key=os.path.getmtime)


def encode(path):
    return re.sub(r"[^A-Za-z0-9]", "-", path)


def to_ms(ts):
    return int(datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp() * 1000)


def short_title(text):
    text = re.sub(r"<command-name>(.*?)</command-name>", r"\1 ", text)
    text = re.sub(r"<[^>]+>[^<]*</[^>]+>", "", text)
    return re.sub(r"\s+", " ", text).strip()[:50]


def scan(path):
    info = dict(ts=[], cwds=[], model=None, custom=None, ai=None, first=None, mode=None, entry=set())
    for line in open(path, errors="ignore"):
        try:
            d = json.loads(line)
        except ValueError:
            continue
        kind = d.get("type")
        if d.get("timestamp"):
            info["ts"].append(d["timestamp"])
        if d.get("cwd") and d["cwd"] not in info["cwds"]:
            info["cwds"].append(d["cwd"])
        if d.get("entrypoint"):
            info["entry"].add(d["entrypoint"])
        if kind == "custom-title":
            info["custom"] = d.get("customTitle")
        elif kind == "ai-title":
            info["ai"] = d.get("aiTitle")
        elif kind == "permission-mode":
            info["mode"] = d.get("permissionMode")
        msg = d.get("message") or {}
        if kind == "assistant" and msg.get("model") and not msg["model"].startswith("<"):
            info["model"] = msg["model"]
        if info["first"] is None and kind == "user" and not d.get("isMeta"):
            content = msg.get("content")
            if isinstance(content, list):
                content = " ".join(x.get("text", "") for x in content if isinstance(x, dict) and x.get("type") == "text")
            if content and content.strip():
                info["first"] = content
    return info


def main():
    meta_dir = find_meta_dir()
    linked = set()
    for m in glob.glob(os.path.join(meta_dir, "local_*.json")):
        try:
            linked.add(json.load(open(m)).get("cliSessionId"))
        except ValueError:
            pass

    new, skipped = [], {}
    for proj in sorted(os.listdir(PROJECTS)):
        for path in glob.glob(os.path.join(PROJECTS, proj, "*.jsonl")):
            cli_id = os.path.basename(path)[:-6]
            if cli_id in linked:
                continue
            s = scan(path)
            reason = None
            if not s["first"] or not s["ts"]:
                reason = "没有用户消息"
            elif s["entry"] and s["entry"] <= {"sdk-cli"}:
                reason = "脚本里 claude -p 的一次性调用"
            cwd = next((c for c in s["cwds"] if encode(c) == proj), s["cwds"][0] if s["cwds"] else None)
            if not reason and not (cwd and os.path.isdir(cwd)):
                reason = "工作目录已不存在"
            if reason:
                skipped[reason] = skipped.get(reason, 0) + 1
                continue
            new.append(dict(cli=cli_id, cwd=cwd, created=to_ms(min(s["ts"])), last=to_ms(max(s["ts"])),
                            model=s["model"], mode=s["mode"] or "default",
                            title=s["custom"] or s["ai"] or short_title(s["first"])))

    print(f"客户端会话目录: {meta_dir}")
    print(f"已在列表: {len(linked)}   待导入: {len(new)}   跳过: {skipped or 0}")
    for o in sorted(new, key=lambda o: -o["last"])[:20]:
        print("  ", datetime.fromtimestamp(o["last"] / 1000).strftime("%m-%d %H:%M"), o["title"])
    if not APPLY:
        print("\n这是试运行。确认无误后加 --apply 写入，然后 ⌘Q 退出 Claude 客户端再打开。")
        return
    for o in new:
        sid = "local_" + str(uuid.uuid4())
        meta = {
            "sessionId": sid, "cliSessionId": o["cli"], "cwd": o["cwd"], "originCwd": o["cwd"],
            "createdAt": o["created"], "lastActivityAt": o["last"], "lastFocusedAt": o["last"],
            "isArchived": False, "title": o["title"], "titleSource": "user",
            "permissionMode": o["mode"], "importedBy": "cloudcli-kit",
        }
        if o["model"]:
            meta["model"] = o["model"]
        with open(os.path.join(meta_dir, sid + ".json"), "w") as f:
            json.dump(meta, f, ensure_ascii=False)
    print(f"\n已写入 {len(new)} 条。⌘Q 完全退出 Claude 客户端再打开即可看到。")


if __name__ == "__main__":
    main()
