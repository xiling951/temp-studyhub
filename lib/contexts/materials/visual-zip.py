"""Streaming ZIP64 transport with bounded, verified, non-traversing restoration."""
import hashlib
import json
import pathlib
import re
import stat
import sys
import zipfile

CHUNK = 262144
MAX_EXPANDED = 4 * 1024**3
MAX_FILE = 800 * 1024**2
MAX_META = 64 * 1024**2

def safe(name):
    return bool(re.fullmatch(r"[A-Za-z0-9_.\-/]+", name)) and not name.startswith("/") and all(p not in ("", ".", "..") for p in name.split("/"))

def file_hash(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()

mode, source, target = sys.argv[1:4]
if mode == "pack":
    plan = json.loads(pathlib.Path(source).read_text(encoding="utf-8"))
    records = []
    total = 0
    seen = set()
    for entry in plan["entries"]:
        name = entry["name"]
        if not safe(name) or name == "manifest.json" or name in seen:
            raise ValueError("Invalid archive entry")
        seen.add(name)
        path = pathlib.Path(entry["path"])
        size = path.stat().st_size
        total += size
        if size > MAX_FILE or total > MAX_EXPANDED or len(seen) > 10000:
            raise ValueError("Archive exceeds resource budget")
        records.append({"name": name, "bytes": size, "sha256": file_hash(path)})
    manifest = {"format": plan["format"], "schema": 1, "files": records, "metadata": plan.get("metadata", {})}
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=3, allowZip64=True) as archive:
        for entry in plan["entries"]:
            archive.write(entry["path"], entry["name"])
        archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False))
    print(json.dumps({"bytes": pathlib.Path(target).stat().st_size, "sha256": file_hash(target), "expandedBytes": total, "entries": len(records)}))
elif mode == "unpack":
    target = pathlib.Path(target).resolve()
    target.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(source) as archive:
        entries = archive.infolist()
        names = [entry.filename for entry in entries]
        if len(entries) > 10001 or len(set(names)) != len(names) or "manifest.json" not in names:
            raise ValueError("Duplicate or missing archive entries")
        total = 0
        for entry in entries:
            total += entry.file_size
            if not safe(entry.filename) or entry.is_dir() or stat.S_ISLNK(entry.external_attr >> 16) or entry.flag_bits & 1:
                raise ValueError("Unsafe archive entry")
            if entry.file_size > MAX_FILE or total > MAX_EXPANDED:
                raise ValueError("Expanded archive exceeds budget")
        if archive.getinfo("manifest.json").file_size > MAX_META:
            raise ValueError("Manifest exceeds budget")
        manifest = json.loads(archive.read("manifest.json"))
        if manifest.get("schema") != 1 or manifest.get("format") != "studyhub-library-backup/v1":
            raise ValueError("Not a supported full-library archive")
        expected = {entry["name"]: entry for entry in manifest["files"]}
        if len(expected) != len(manifest["files"]) or set(expected) != set(names) - {"manifest.json"}:
            raise ValueError("Archive manifest does not exactly cover its files")
        for name, record in expected.items():
            if not safe(name) or record["bytes"] != archive.getinfo(name).file_size or not re.fullmatch(r"[a-f0-9]{64}", record["sha256"]):
                raise ValueError("Invalid manifest resource")
            destination = target.joinpath(*name.split("/"))
            destination.parent.mkdir(parents=True, exist_ok=True)
            digest = hashlib.sha256()
            written = 0
            with archive.open(name) as item, open(destination, "xb") as output:
                for chunk in iter(lambda: item.read(CHUNK), b""):
                    written += len(chunk)
                    if written > record["bytes"]:
                        raise ValueError("Entry expanded beyond declared bytes")
                    digest.update(chunk)
                    output.write(chunk)
            if written != record["bytes"] or digest.hexdigest() != record["sha256"]:
                raise ValueError("Archive resource hash mismatch")
        pathlib.Path(target, "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        print(json.dumps({"format": manifest["format"], "entries": len(expected), "expandedBytes": total}))
else:
    raise ValueError("Unsupported archive operation")
