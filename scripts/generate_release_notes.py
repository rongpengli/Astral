#!/usr/bin/env python3
"""Generate conservative, Chinese release notes for Astral New Tab.

Uses the net Git diff, not Conventional Commits. Requires Python >= 3.9.
Typical invocation:
  python scripts/generate_release_notes.py --version 1.12.6 --output release-notes.md
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
from collections import Counter
from pathlib import Path


MODULES = [
    ("壁纸管理", r"wallpaper|bing|background|bgimage|bg_img|壁纸|背景"),
    ("天气", r"weather|forecast|天气|预报"),
    ("日历", r"calendar|日历"),
    ("导航与图标", r"bookmark|navigation|favicon|shortcut|siteicon|书签|导航|图标"),
    ("配置与同步", r"sync|storage|config|import|export|同步|配置|导入|导出"),
    ("设置与外观", r"options?|settings?|customiz|theme|darkmode|dark.mode|暗色|主题|设置"),
]
COMPILED_MODULES = [(name, re.compile(pattern, re.I)) for name, pattern in MODULES]
DESCRIPTIONS = {
    "壁纸管理": "壁纸和背景相关实现有调整",
    "天气": "天气功能相关实现有调整",
    "日历": "日历功能相关实现有调整",
    "导航与图标": "导航、书签或站点图标相关实现有调整",
    "配置与同步": "配置管理或同步相关实现有调整",
    "设置与外观": "设置界面或外观相关实现有调整",
    "扩展权限与元数据": "扩展权限或元数据发生变化",
    "界面资源": "图像、字体或其他界面资源发生变化",
    "其他源代码": "其他源代码发生变化",
}
SOURCE_EXTS = {".js", ".jsx", ".ts", ".tsx", ".css", ".html", ".py"}
ASSET_EXTS = {".png", ".jpg", ".jpeg", ".svg", ".webp", ".ico", ".woff", ".woff2", ".ttf"}
NON_MEANINGFUL_SUBJECT = re.compile(
    r"^(?:(?:chore|fix|update|feat|refactor|minor|misc|wip|test|cleanup)[:!. ]*|"
    r"(?:更新|修改|调整|修复|优化|整理|小改动|版本更新)[!！.。 ]*|"
    r"(?:bump|release|version)\s*[:v ]*\d[\d.\-]*)$",
    re.I,
)


def git(*args: str) -> str:
    proc = subprocess.run(
        ["git", *args], check=True, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, encoding="utf-8", errors="replace"
    )
    return proc.stdout


def parse_version(tag: str) -> tuple[int, int, int, int] | None:
    m = re.fullmatch(r"v(\d+(?:\.\d+){1,3})", tag)
    if not m:
        return None
    bits = [int(part) for part in m.group(1).split(".")]
    return tuple((bits + [0] * 4)[:4])  # v1.12 == v1.12.0


def previous_tag(current_tag: str) -> str | None:
    current = parse_version(current_tag)
    if current is None:
        raise ValueError(f"Unsupported release tag: {current_tag}")
    tags = git("tag", "--merged", "HEAD", "--list", "v*").splitlines()
    candidates = [tag for tag in tags if (v := parse_version(tag)) is not None and v < current]
    return max(candidates, key=parse_version) if candidates else None


def manifest_has_non_version_changes(previous: str) -> bool:
    """Return True if manifest changed beyond the top-level version keys.

    If the JSON cannot be inspected, include it rather than silently dismissing it.
    """
    try:
        before = json.loads(git("show", f"{previous}:src/manifest.json"))
        after = json.loads(Path("src/manifest.json").read_text(encoding="utf-8"))
        for obj in (before, after):
            obj.pop("version", None)
            obj.pop("version_name", None)
        return before != after
    except (subprocess.CalledProcessError, OSError, json.JSONDecodeError, AttributeError):
        return True


def changed_lines_by_file(previous: str) -> dict[str, str]:
    """Collect only added/deleted source lines; no unchanged context.

    Only scan text source files. Do not scan preset JSON, which may mention
    every feature without any of those features actually changing.
    """
    patch = git("-c", "core.quotePath=false", "diff", "--no-ext-diff", "--no-color", "--unified=0", previous, "HEAD", "--", "src/")
    lines: dict[str, list[str]] = {}
    current_file = ""
    for line in patch.splitlines():
        if line.startswith("+++ b/"):
            current_file = line[6:]
            lines.setdefault(current_file, [])
        elif line.startswith("+++ /dev/null"):
            current_file = ""  # deleted file: filename matching still works
        elif current_file and line.startswith(("+", "-")) and not line.startswith(("+++", "---")):
            if Path(current_file).suffix.lower() in SOURCE_EXTS and len(lines[current_file]) < 400:
                lines[current_file].append(line[1:][:1500])
    return {name: "\n".join(chunks) for name, chunks in lines.items()}


def meaningful_paths(previous: str) -> list[str]:
    names = git("diff", "--name-only", "-z", "--find-renames", previous, "HEAD", "--", "src/")
    paths = [x for x in names.split("\0") if x]
    keep = []
    for path in paths:
        lower = path.lower()
        if lower.endswith((".map", ".pyc")) or "/__pycache__/" in lower:
            continue
        if path == "src/manifest.json" and not manifest_has_non_version_changes(previous):
            continue
        keep.append(path)
    return keep


def summarize_modules(paths: list[str], lines: dict[str, str]) -> list[str]:
    detected = set()
    for path in paths:
        lower = path.lower()
        if path == "src/manifest.json":
            detected.add("扩展权限与元数据")
            continue
        if Path(path).suffix.lower() in ASSET_EXTS:
            detected.add("界面资源")
        matches = {name for name, rx in COMPILED_MODULES if rx.search(path)}
        if Path(path).suffix.lower() in SOURCE_EXTS:
            patch = lines.get(path, "")
            # A positive match means a changed source line mentions the feature.
            matches.update(name for name, rx in COMPILED_MODULES if rx.search(patch))
        detected.update(matches or {"其他源代码"})
    return [name for name in [*DESCRIPTIONS] if name in detected]


def meaningful_commit_subjects(previous: str) -> list[str]:
    logs = git("log", "--no-merges", "--pretty=format:%s\t%h", f"{previous}..HEAD", "--", "src/")
    selected = []
    seen = set()
    for entry in logs.splitlines():
        try:
            subject, short_hash = entry.rsplit("\t", 1)
        except ValueError:
            continue
        subject = subject.strip()
        normalized = re.sub(r"\s+", " ", subject.casefold())
        if not subject or len(subject) < 9 or NON_MEANINGFUL_SUBJECT.fullmatch(subject):
            continue
        if normalized in seen:
            continue
        seen.add(normalized)
        selected.append(f"- {subject} (`{short_hash}`)")
        if len(selected) >= 8:
            break
    return selected


def generate(version: str, output: Path) -> None:
    tag = f"v{version}"
    if parse_version(tag) is None:
        raise ValueError(f"Unsupported manifest version: {version}")
    previous = previous_tag(tag)
    notes = [f"# Astral New Tab {version}", ""]

    if previous is None:
        notes += ["## 更新内容", "", "- 首次发布（当前提交历史中未发现更早的可比较版本标签）。", ""]
    else:
        changed = meaningful_paths(previous)
        by_file = changed_lines_by_file(previous)
        modules = summarize_modules(changed, by_file)
        notes += ["## 更新内容", ""]
        if modules:
            notes.extend(f"- **{name}**：{DESCRIPTIONS[name]}。" for name in modules)
        else:
            notes.append("- 本次版本未检测到需要单独列出的源代码变化（可能仅更新了版本号）。")
        notes.append("")

        if modules:
            subjects = meaningful_commit_subjects(previous)
            if subjects:
                notes += ["## 开发记录", "", *subjects, ""]

        repository = os.environ.get("GITHUB_REPOSITORY", "")
        if re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
            notes += [f"[查看完整代码差异](https://github.com/{repository}/compare/{previous}...{tag})", ""]

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("\n".join(notes).rstrip() + "\n", encoding="utf-8")
    print(output.read_text(encoding="utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True)
    parser.add_argument("--output", type=Path, default=Path("release-notes.md"))
    args = parser.parse_args()
    generate(args.version, args.output)


if __name__ == "__main__":
    main()
