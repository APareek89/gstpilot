# PDF extractor for GSTPilot (Phase 2, step 1). Run: .venv/bin/python extract.py
# Reads corpus/manifest.json, opens every downloaded PDF with pdfplumber, and produces one
# clean per-page JSON per document in corpus-text/ (locally AND in the Supabase Storage
# bucket "corpus-text"). Documents flagged needs_ocr get a stub JSON so the pipeline knows
# they exist but have no text yet. This is a batch tool: it runs when the corpus changes,
# never while a user is asking questions.
#
# Cleaning applied (and nothing more — law text is never edited, only de-noised):
#   - remove zero-width/invisible characters PDF exporters sprinkle around
#   - fix hyphenated line-breaks ("provi-\nsion" -> "provision")
#   - drop repeating page headers/footers (lines identical on >40% of pages) and bare page numbers

import json
import re
import sys
import urllib.request
from collections import Counter
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "corpus-text"
BUCKET = "corpus-text"


def load_env() -> dict:
    """Minimal .env parser so this script needs no extra dependencies."""
    env = {}
    for line in (ROOT / ".env").read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


def clean_page(text: str) -> str:
    text = re.sub(r"[​‌‍﻿]", "", text)          # invisible chars
    text = re.sub(r"([a-z])-\n([a-z])", r"\1\2", text)              # de-hyphenate line breaks
    text = re.sub(r"[ \t]+", " ", text)                              # collapse runs of spaces
    return text.strip()


def strip_repeating_lines(pages: list[str]) -> list[str]:
    """Headers/footers repeat verbatim page after page; real law text never does.
    Count each page's first and last lines; any line seen on >40% of pages is furniture."""
    if len(pages) < 5:
        return pages
    edge_lines = Counter()
    for p in pages:
        lines = [l for l in p.splitlines() if l.strip()]
        if lines:
            edge_lines[lines[0].strip()] += 1
            edge_lines[lines[-1].strip()] += 1
    furniture = {l for l, n in edge_lines.items() if n > 0.4 * len(pages)}
    out = []
    for p in pages:
        kept = [
            l for l in p.splitlines()
            if l.strip() and l.strip() not in furniture
            and not re.fullmatch(r"\d{1,4}", l.strip())
            and not re.fullmatch(r"Page \d+ of \d+", l.strip())  # per-page counter, unique text each page
        ]
        out.append("\n".join(kept))
    return out


def upload(env: dict, path: str, body: bytes) -> None:
    """PUT the JSON into Supabase Storage (x-upsert makes re-runs idempotent)."""
    req = urllib.request.Request(
        f"{env['SUPABASE_URL']}/storage/v1/object/{BUCKET}/{path}",
        data=body,
        method="POST",
        headers={
            "apikey": env["SUPABASE_SERVICE_ROLE_KEY"],
            "Content-Type": "application/json",
            "x-upsert": "true",
        },
    )
    urllib.request.urlopen(req, timeout=60).read()


def ensure_bucket(env: dict) -> None:
    req = urllib.request.Request(
        f"{env['SUPABASE_URL']}/storage/v1/bucket",
        data=json.dumps({"id": BUCKET, "name": BUCKET, "public": False}).encode(),
        method="POST",
        headers={
            "apikey": env["SUPABASE_SERVICE_ROLE_KEY"],
            "Content-Type": "application/json",
        },
    )
    try:
        urllib.request.urlopen(req, timeout=30).read()
    except urllib.error.HTTPError as e:
        # "bucket already exists" is fine — the API says Duplicate in the body but,
        # confusingly, sends it under HTTP 400, so check the body not just the code.
        body = e.read().decode(errors="replace")
        if e.code != 409 and "exists" not in body:
            raise


def main() -> None:
    env = load_env()
    skip_upload = "--no-upload" in sys.argv
    if not skip_upload:
        ensure_bucket(env)
    OUT_DIR.mkdir(exist_ok=True)

    manifest = json.loads((ROOT / "corpus" / "manifest.json").read_text())
    done = ocr_stubs = failed = 0

    for doc in manifest:
        if doc["status"] != "downloaded":
            continue
        out_path = OUT_DIR / f"{doc['doc_id']}.json"

        if doc.get("needs_ocr"):
            payload = {"doc_id": doc["doc_id"], "source_sha256": doc["sha256"],
                       "needs_ocr": True, "pages": []}
            ocr_stubs += 1
        else:
            try:
                with pdfplumber.open(ROOT / doc["local_path"]) as pdf:
                    raw = [clean_page(p.extract_text() or "") for p in pdf.pages]
                pages = strip_repeating_lines(raw)
                payload = {
                    "doc_id": doc["doc_id"], "source_sha256": doc["sha256"],
                    "needs_ocr": False,
                    "pages": [{"page": i + 1, "text": t} for i, t in enumerate(pages)],
                }
                done += 1
            except Exception as e:  # one bad PDF must not kill the batch
                print(f"  ✗ {doc['doc_id']}: {e}")
                failed += 1
                continue

        body = json.dumps(payload, ensure_ascii=False).encode()
        out_path.write_bytes(body)
        if not skip_upload:
            upload(env, f"{doc['doc_id']}.json", body)
        if done % 50 == 0 and done:
            print(f"  …{done} extracted")

    print(f"\nextracted={done}  ocr_stubs={ocr_stubs}  failed={failed}")
    print(f"outputs: {OUT_DIR}/  +  storage bucket '{BUCKET}'" + (" (upload skipped)" if skip_upload else ""))


if __name__ == "__main__":
    main()
