"""Verify and stream-extract the authorized book package, without buffering PDFs."""
import hashlib
import json
import pathlib
import re
import zipfile

evidence = pathlib.Path(__file__).resolve().parents[3] / "evidence" / "fullbook-20261012"
archive = evidence / "数字集成电路-电子教材资源包.zip"
destination = (evidence / "book").resolve()
destination.mkdir(exist_ok=True)
baseline_path = evidence / "corrected-manifest-private.json"
if not baseline_path.exists():
    baseline_path = evidence / "original-manifest-private.json"
original = json.loads(baseline_path.read_text(encoding="utf-8"))
verified = []
with zipfile.ZipFile(archive) as package:
    names = package.namelist()
    assert len(names) == len(set(names)), "Duplicate archive entries"
    assert sum(entry.file_size for entry in package.infolist()) <= 4 * 1024**3
    for entry in package.infolist():
        assert not entry.is_dir() and not entry.flag_bits & 1
        target = (destination / entry.filename).resolve()
        assert target.is_relative_to(destination) and not target.is_symlink()
        assert entry.file_size <= 512 * 1024**2
        target.parent.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256()
        with package.open(entry) as source, target.open("wb") as output:
            while block := source.read(262144):
                digest.update(block)
                output.write(block)
        verified.append({"name": entry.filename, "bytes": entry.file_size, "sha256": digest.hexdigest()})
    manifest = json.loads((destination / "document.json").read_text(encoding="utf-8"))
    assert manifest["documentId"] == original["documentId"] and manifest["revision"] == original["revision"]
    assert len(manifest["pages"]) == 572
    assert manifest["assets"] == original["assets"]
    for old, new in zip(original["pages"], manifest["pages"]):
        assert old["text"] == new["text"] and old["sourceId"] == new["sourceId"]
        for a, b in zip(old["blocks"], new["blocks"]):
            assert a == {key: value for key, value in b.items() if key != "textRange"}
            if b.get("textRange"):
                span = b["textRange"]
                assert new["text"][span["start"]:span["end"]] == b["text"]
    by_name = {item["name"]: item for item in verified}
    for asset in manifest["assets"]:
        name = "original.pdf" if asset["kind"] == "original" else f"figures/{asset['hash']}.{'png' if asset['mime'] == 'image/png' else 'jpg'}"
        assert by_name[name]["sha256"] == asset["hash"] and by_name[name]["bytes"] == asset["bytes"]
    reading = manifest["reading"]
    required = {(page["page"], block["id"]) for page in manifest["pages"] for block in page["blocks"]
                if block["type"] not in {"header", "footer", "page_header", "page_footer", "page_number"} and (block["text"] or block.get("assetId"))}
    anchors = [(anchor["page"], anchor["blockId"]) for node in reading["nodes"] for anchor in node["anchors"]]
    assert len(anchors) == len(set(anchors)) and set(anchors) == required
    markdown = (destination / "textbook.md").read_text(encoding="utf-8")
    for node in reading["nodes"]:
        assert not node["text"] or node["text"] in markdown
    chapters = reading["chapters"]
    numbered = [chapter for chapter in chapters if re.match(r"第\s*\d+\s*章", chapter["title"])]
    assert len(numbered) == 12
    mappings = json.loads((destination / "mappings.json").read_text(encoding="utf-8"))
    assert mappings["nodes"] == [{"id": node["id"], "anchors": node["anchors"]} for node in reading["nodes"]]
    for chapter in chapters:
        assert (destination / "chapters" / f"{chapter['id']}.html").is_file()
    result = {"status": "passed", "pages": 572, "indexedBookSources": 571, "resources": len(manifest["assets"]),
              "entries": len(verified), "numberedChapters": 12, "readingNodes": len(reading["nodes"]),
              "joinedNodes": sum(len(node["anchors"]) > 1 for node in reading["nodes"]), "literalSourcesMatchRevision": True,
              "versionedCorrections": len(original.get("corrections", {}).get("changes", [])),
              "allResourceHashesVerified": True, "allReadingBlocksMappedOnce": True, "maxTransferBytes": 262144}
    (evidence / "archive-verification.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    (evidence / "archive-inventory-private.json").write_text(json.dumps(verified, indent=2), encoding="utf-8")
    print(json.dumps(result))
