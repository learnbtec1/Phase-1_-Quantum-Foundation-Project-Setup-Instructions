#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
cleanup.py — تنظيف آمن لمجلدات الكاش والملفات المؤقتة داخل المشروع.

الاستخدام:
  python cleanup.py              وضع تفاعلي: يعرض الملخص ثم يطلب التأكيد قبل الحذف
  python cleanup.py --dry-run    يعرض ما سيُحذف دون حذف فعلي (موصى به أولاً)
  python cleanup.py --force      يحذف تلقائياً دون أسئلة (خطر — راجع القائمة أولاً)

خيارات إضافية:
  python cleanup.py --include-node-modules   يتضمن حذف frontend/node_modules (إعادة: npm install)
  python cleanup.py --include-ide            يحذف .vscode / .idea / .vs تحت جذر المشروع
  python cleanup.py --include-tests          يحذف اختبارات بايثون/TS المعرّفة (انظر TEST_GLOBS)
  python cleanup.py --large-mb 30            عتبة الملفات الكبيرة للمراجعة التفاعلية (افتراضي 50)
  python cleanup.py --force --skip-large   حذف تلقائي للكاش مع تخطّي الملفات الكبيرة

قواعد أمان (لا تُحذف أبداً):
  - .git/ ، ملف .env (يُحتفظ بـ .env.example)
  - backend/app/api/ ، frontend/src/app/ ، backend/app/archive/ (حزمة أرشيف مرتبطة بالاستيرادات)
  - مجلد frontend/public/ بالكامل (أصول VRM/نماذج)
  - لا حذف عشوائي لكل المشروع — فقط أنماط ومجلدات كاش/مؤقتة معروفة.

ملاحظة: المسارات مثل archive في الجذر قد تُحذف إذا وُجدت ضمن أهداف صريحة؛
         backend/app/archive لا يُمس.

كاش npm/pip/yarn العام (مثل ~/.npm) خارج نطاق المشروع ولا يُمس هنا.
يُمسح تحت الجذر فقط: node_modules (اختياري)، .yarn/cache إن وُجد.
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
from dataclasses import dataclass, field
from pathlib import Path


# ─── جذر المشروع (حيث يقع cleanup.py) ─────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parent


# ─── بادئات محمية: لا حذف داخلها (مسارات نسبية من جذر المشروع) ─────────────
PROTECTED_PREFIXES: tuple[str, ...] = (
    ".git",
    "frontend/public",
    "frontend/src/app",
    "backend/app/api",
    "backend/app/archive",  # حزمة Python نشطة (imports من app.archive)
)


# ─── ملفات محمية بالاسم في الجذر أو أي مكان ─────────────────────────────────
PROTECTED_NAMES: frozenset[str] = frozenset({".env"})


def _norm_rel(path: Path) -> str:
    try:
        rel = path.resolve().relative_to(PROJECT_ROOT.resolve())
    except ValueError:
        return ""
    return rel.as_posix().replace("\\", "/")


def is_protected(path: Path) -> bool:
    """True إذا كان المسار تحت شجرة محمية أو اسمه محظور."""
    rp = path.resolve()
    root = PROJECT_ROOT.resolve()
    try:
        rel = rp.relative_to(root)
    except ValueError:
        return True
    parts = rel.parts
    if parts and parts[0] in PROTECTED_NAMES:
        return True
    rel_posix = rel.as_posix()
    for pfx in PROTECTED_PREFIXES:
        if rel_posix == pfx or rel_posix.startswith(pfx + "/"):
            return True
    return False


# ─── مجلدات كاش شائعة (نسبية من الجذر) ─────────────────────────────────────
# أسماء كاش تُطابق أثناء المشي — لا تضمّن build/dist/out هنا (توجد داخل node_modules وsite-packages)
CACHE_DIR_NAMES: frozenset[str] = frozenset({
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".tox",
    ".turbo",
    ".parcel-cache",
    "coverage",
    "htmlcov",
    ".nyc_output",
    "node_modules",  # يُجمع كجذر فقط عبر --include-node-modules + لا ندخل داخل الشجرة
})

# أسماء مجلدات «أرشيف/قديم» في الجذر أو تحت backend/frontend فقط (لا backend/app/archive)
ROOT_JUNK_DIR_NAMES: frozenset[str] = frozenset({
    "old",
    "deprecated",
    "temp",
    "scratch",
    "tmp",
})

# ملاحظة: مجلد اسمه "archive" في جذر المشروع قد يُحذف؛ backend/app/archive محمي.


# ─── امتدادات ملفات مؤقتة / نظام ──────────────────────────────────────────
JUNK_EXTENSIONS: frozenset[str] = frozenset({
    ".pyc", ".pyo", ".log", ".tmp", ".bak", ".old", ".swp", ".swo",
})

JUNK_FILENAMES: frozenset[str] = frozenset({
    ".DS_Store",
    "Thumbs.db",
    "Desktop.ini",
})

# ─── أنماط اختبار (اختيارية مع --include-tests) ──────────────────────────
TEST_GLOBS_PY = ("test_*.py", "*_test.py")
TEST_GLOBS_TS = ("*.test.ts", "*.test.tsx", "*.spec.ts", "*.spec.tsx")


@dataclass
class CleanupReport:
    files_removed: int = 0
    dirs_removed: int = 0
    bytes_freed: int = 0
    paths: list[str] = field(default_factory=list)

    def add_file(self, p: Path, size: int) -> None:
        self.files_removed += 1
        self.bytes_freed += size
        self.paths.append(_norm_rel(p))

    def add_dir(self, p: Path, size: int) -> None:
        self.dirs_removed += 1
        self.bytes_freed += size
        self.paths.append(_norm_rel(p) + "/")


def dir_size(path: Path) -> int:
    total = 0
    try:
        for dirpath, _dirnames, filenames in os.walk(path):
            for fn in filenames:
                fp = Path(dirpath) / fn
                try:
                    total += fp.stat().st_size
                except OSError:
                    pass
    except OSError:
        pass
    return total


def file_size(path: Path) -> int:
    try:
        return path.stat().st_size
    except OSError:
        return 0


def collect_explicit_build_artifacts() -> list[Path]:
    """build / dist / out / .next فقط عند الجذر أو frontend/ أو backend/ (لا داخل node_modules)."""
    found: list[Path] = []
    names = ("build", "dist", "out")
    bases = [PROJECT_ROOT, PROJECT_ROOT / "frontend", PROJECT_ROOT / "backend"]
    for base in bases:
        if not base.is_dir():
            continue
        for name in names:
            p = base / name
            if p.is_dir() and not is_protected(p):
                found.append(p)
        nxt = base / ".next"
        if nxt.is_dir() and not is_protected(nxt):
            found.append(nxt)
    return found


def collect_cache_dirs(include_node_modules: bool) -> list[Path]:
    found: list[Path] = []
    root = PROJECT_ROOT.resolve()

    for dirpath, dirnames, _filenames in os.walk(root, topdown=True):
        dp = Path(dirpath)
        if is_protected(dp):
            dirnames[:] = []
            continue
        # لا ندخل .git أبداً
        if ".git" in dirnames:
            dirnames.remove(".git")
        # لا نمشي داخل node_modules (تجنّب لمس dist/build داخل الحزم)
        if "node_modules" in dirnames:
            nm = dp / "node_modules"
            allowed_nm_roots = {
                root.resolve(),
                (root / "frontend").resolve(),
                (root / "backend").resolve(),
            }
            if (
                include_node_modules
                and dp.resolve() in allowed_nm_roots
                and nm.is_dir()
                and not is_protected(nm)
            ):
                found.append(nm)
            dirnames.remove("node_modules")

        for d in list(dirnames):
            child = dp / d
            if is_protected(child):
                continue
            if d in CACHE_DIR_NAMES:
                found.append(child)
            elif d.endswith(".egg-info") and "site-packages" not in child.parts:
                found.append(child)

    found.extend(collect_explicit_build_artifacts())
    return sorted(set(found), key=lambda p: len(p.parts), reverse=True)


def collect_root_junk_dirs() -> list[Path]:
    """مجلدات old/temp/... في الجذر أو مباشرة تحت frontend/backend فقط."""
    cands: list[Path] = []
    for base in (PROJECT_ROOT, PROJECT_ROOT / "frontend", PROJECT_ROOT / "backend"):
        if not base.is_dir():
            continue
        for child in base.iterdir():
            if not child.is_dir():
                continue
            if is_protected(child):
                continue
            name = child.name.lower()
            if name in ROOT_JUNK_DIR_NAMES or name == "archive":
                cands.append(child)
    return cands


def collect_junk_files() -> list[Path]:
    out: list[Path] = []
    root = PROJECT_ROOT.resolve()
    for dirpath, _dirnames, filenames in os.walk(root):
        dp = Path(dirpath)
        if is_protected(dp):
            continue
        if ".git" in Path(dirpath).parts:
            continue
        for fn in filenames:
            p = dp / fn
            if is_protected(p):
                continue
            if fn in JUNK_FILENAMES:
                out.append(p)
                continue
            suf = p.suffix.lower()
            if suf in JUNK_EXTENSIONS:
                out.append(p)
    return out


def collect_yarn_cache_dirs() -> list[Path]:
    """Yarn Berry: .yarn/cache تحت جذر المشروع فقط."""
    out: list[Path] = []
    for base in (PROJECT_ROOT / ".yarn", PROJECT_ROOT / "frontend" / ".yarn"):
        c = base / "cache"
        if c.is_dir() and not is_protected(c):
            out.append(c)
    return out


def collect_egg_info_dirs() -> list[Path]:
    root = PROJECT_ROOT.resolve()
    found: list[Path] = []
    for dirpath, dirnames, _filenames in os.walk(root):
        dp = Path(dirpath)
        if is_protected(dp):
            dirnames[:] = []
            continue
        if ".git" in dp.parts:
            dirnames[:] = []
            continue
        for d in list(dirnames):
            if d.endswith(".egg-info"):
                found.append(dp / d)
    return sorted(found, key=lambda p: len(p.parts), reverse=True)


def collect_test_files() -> list[Path]:
    root = PROJECT_ROOT.resolve()
    out: list[Path] = []
    for pattern in TEST_GLOBS_PY:
        for p in root.rglob(pattern):
            if p.is_file() and not is_protected(p) and ".git" not in p.parts:
                # تخطّي site-packages إن وُجد
                if "node_modules" in p.parts:
                    continue
                out.append(p)
    for pattern in TEST_GLOBS_TS:
        for p in root.rglob(pattern):
            if p.is_file() and not is_protected(p) and ".git" not in p.parts:
                if "node_modules" in p.parts:
                    continue
                out.append(p)
    # مجلدات __tests__ فارغة أو بملفات قليلة — نحذف الملفات داخلها فقط خارج المحمي
    for p in root.rglob("__tests__"):
        if not p.is_dir() or is_protected(p):
            continue
        for f in p.rglob("*"):
            if f.is_file() and not is_protected(f):
                out.append(f)
    return sorted(set(out))


def collect_large_media(
    large_mb: float,
) -> list[Path]:
    """
    ملفات وسائط كبيرة خارج المناطق المحمية.
    لا نمسح تحت frontend/public (محمي). نركز على uploads/media/temp و الجذر.
    """
    exts = {".mp4", ".webm", ".mov", ".mkv", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".glb", ".gltf", ".vrm", ".zip"}
    threshold = int(large_mb * 1024 * 1024)
    root = PROJECT_ROOT.resolve()
    found: list[Path] = []
    priority_roots = [
        root / "uploads",
        root / "media",
        root / "tmp",
        root / "temp",
        root / "frontend" / "uploads",
        root / "backend" / "uploads",
    ]
    scanned: set[Path] = set()

    def scan_tree(base: Path) -> None:
        if not base.is_dir() or is_protected(base):
            return
        for dirpath, _dirnames, filenames in os.walk(base):
            dp = Path(dirpath)
            if is_protected(dp) or ".git" in dp.parts:
                continue
            for fn in filenames:
                p = dp / fn
                if is_protected(p):
                    continue
                if p.suffix.lower() in exts:
                    sz = file_size(p)
                    if sz >= threshold:
                        found.append(p)

    for pr in priority_roots:
        if pr.exists():
            scan_tree(pr)
            scanned.add(pr.resolve())

    # بقية المشروع عدا المحمي و public
    for dirpath, _dirnames, filenames in os.walk(root):
        dp = Path(dirpath)
        if is_protected(dp) or ".git" in dp.parts:
            continue
        if "node_modules" in dp.parts:
            continue
        rel = _norm_rel(dp)
        if rel.startswith("frontend/public"):
            continue
        for fn in filenames:
            p = dp / fn
            if is_protected(p):
                continue
            if p.suffix.lower() not in exts:
                continue
            sz = file_size(p)
            if sz >= threshold:
                found.append(p)

    return sorted(set(found))


def remove_path(path: Path, report: CleanupReport, *, is_dir: bool | None = None) -> bool:
    if is_protected(path):
        return False
    try:
        if is_dir is None:
            is_dir = path.is_dir()
        if is_dir:
            sz = dir_size(path)
            shutil.rmtree(path, ignore_errors=False)
            report.add_dir(path, sz)
        else:
            sz = file_size(path)
            path.unlink(missing_ok=True)
            report.add_file(path, sz)
        return True
    except OSError as e:
        print(f"  [خطأ] تعذر حذف {_norm_rel(path)}: {e}", file=sys.stderr)
        return False


def human_bytes(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024.0:
            return f"{n:.1f} {unit}"
        n /= 1024.0
    return f"{n:.1f} TB"


def confirm(message: str) -> bool:
    try:
        ans = input(f"{message} [y/N]: ").strip().lower()
    except EOFError:
        return False
    return ans in ("y", "yes", "نعم")


def run_cleanup(
    *,
    dry_run: bool,
    force: bool,
    include_node_modules: bool,
    include_ide: bool,
    include_tests: bool,
    large_mb: float,
    skip_large: bool,
) -> int:
    report = CleanupReport()
    planned_dirs: list[Path] = []
    planned_files: list[Path] = []

    # 1) مجلدات كاش
    planned_dirs.extend(collect_cache_dirs(include_node_modules))
    planned_dirs.extend(collect_egg_info_dirs())
    planned_dirs.extend(collect_yarn_cache_dirs())
    planned_dirs.extend(collect_root_junk_dirs())

    # 2) ملفات مؤقتة
    planned_files.extend(collect_junk_files())

    # 3) IDE (اختياري)
    if include_ide:
        for name in (".vscode", ".idea", ".vs"):
            p = PROJECT_ROOT / name
            if p.is_dir() and not is_protected(p):
                planned_dirs.append(p)

    # 4) اختبارات (اختياري)
    if include_tests:
        planned_files.extend(collect_test_files())

    # إزالة تكرار المسارات؛ المجلدات الأعمق أولاً للحذف
    uniq_dirs = []
    seen_d = set()
    for p in sorted(set(planned_dirs), key=lambda x: len(x.parts), reverse=True):
        rp = p.resolve()
        if rp in seen_d or is_protected(p):
            continue
        seen_d.add(rp)
        uniq_dirs.append(p)

    uniq_files = []
    seen_f = set()
    for p in sorted(set(planned_files)):
        rp = p.resolve()
        if rp in seen_f or is_protected(p):
            continue
        # تخطّي الملف إذا كان داخل مجلد مُخطط لحذفه
        under_removed = any(
            str(rp).startswith(str(d.resolve()) + os.sep) for d in uniq_dirs
        )
        if under_removed:
            continue
        seen_f.add(rp)
        uniq_files.append(p)

    print("=== cleanup.py — ملخص ما سيُحذف ===\n")
    print(f"مجلدات: {len(uniq_dirs)}")
    for d in uniq_dirs[:80]:
        print(f"  [dir] {_norm_rel(d)}")
    if len(uniq_dirs) > 80:
        print(f"  ... و {len(uniq_dirs) - 80} مجلدات أخرى")

    print(f"\nملفات صغيرة/مؤقتة: {len(uniq_files)}")
    for f in uniq_files[:80]:
        print(f"  [file] {_norm_rel(f)}")
    if len(uniq_files) > 80:
        print(f"  ... و {len(uniq_files) - 80} ملفات أخرى")

    # 5) ملفات وسائط كبيرة
    large = collect_large_media(large_mb)
    if large:
        print(f"\nملفات وسائط كبيرة (≥ {large_mb} MB) للمراجعة: {len(large)}")
        for f in large[:50]:
            print(f"  [large {human_bytes(file_size(f))}] {_norm_rel(f)}")
        if len(large) > 50:
            print(f"  ... و {len(large) - 50} أخرى")

    if dry_run:
        print("\n[--dry-run] لم يُحذف شيء.")
        return 0

    if not force:
        if not confirm("\nتنفيذ الحذف للمجلدات والملفات أعلاه (بدون الملفات الكبيرة بعد)؟"):
            print("أُلغي.")
            return 1

    # التنفيذ — الكاش والمؤقتات
    for d in uniq_dirs:
        if d.exists():
            remove_path(d, report, is_dir=True)

    for f in uniq_files:
        if f.is_file():
            remove_path(f, report, is_dir=False)

    # ملفات وسائط كبيرة: --force يحذفها جميعاً ما لم يُمرّر --skip-large؛ وإلا تأكيد لكل ملف
    if not skip_large:
        for f in large:
            if not f.is_file():
                continue
            if force:
                remove_path(f, report, is_dir=False)
            elif confirm(f"حذف ملف كبير {_norm_rel(f)} ({human_bytes(file_size(f))})؟"):
                remove_path(f, report, is_dir=False)

    print("\n=== تقرير ===")
    print(f"مجلدات حُذفت: {report.dirs_removed}")
    print(f"ملفات حُذفت: {report.files_removed}")
    print(f"الحجم المُسترد (تقريبي): {human_bytes(report.bytes_freed)}")
    return 0


def main() -> int:
    if sys.platform == "win32":
        try:
            sys.stdout.reconfigure(encoding="utf-8")
            sys.stderr.reconfigure(encoding="utf-8")
        except (AttributeError, OSError):
            pass

    parser = argparse.ArgumentParser(
        description="تنظيف كاش ومؤقتات المشروع مع حماية المسارات الحرجة.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="عرض ما سيُحذف دون حذف",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="حذف تلقائي دون تأكيد (يشمل الملفات الكبيرة إن وُجدت)",
    )
    parser.add_argument(
        "--include-node-modules",
        action="store_true",
        help="حذف مجلدات node_modules (إعادة التثبيت: npm install)",
    )
    parser.add_argument(
        "--include-ide",
        action="store_true",
        help="حذف .vscode / .idea / .vs في جذر المشروع",
    )
    parser.add_argument(
        "--include-tests",
        action="store_true",
        help="حذف test_*.py و *_test.py و *.test.ts ومحتوى __tests__ (خطر)",
    )
    parser.add_argument(
        "--large-mb",
        type=float,
        default=50.0,
        metavar="N",
        help="عتبة حجم الملفات الكبيرة بالميجابايت (افتراضي 50)",
    )
    parser.add_argument(
        "--skip-large",
        action="store_true",
        help="لا تحذف الملفات الوسائطية الكبيرة (حتى مع --force)",
    )

    args = parser.parse_args()
    if args.force and not args.dry_run:
        print("تحذير: --force — حذف تلقائي دون تأكيد للدفعة الرئيسية.", file=sys.stderr)

    return run_cleanup(
        dry_run=args.dry_run,
        force=args.force,
        include_node_modules=args.include_node_modules,
        include_ide=args.include_ide,
        include_tests=args.include_tests,
        large_mb=args.large_mb,
        skip_large=args.skip_large,
    )


if __name__ == "__main__":
    sys.exit(main())
