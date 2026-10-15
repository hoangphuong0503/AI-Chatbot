"""Download the pinned public model without Xet; weights remain outside Git."""
from pathlib import Path
import hashlib
import requests
from huggingface_hub import snapshot_download

REPO = 'BAAI/bge-reranker-v2-m3'
REVISION = '953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e'
SHA256 = 'd9e3e081faff1eefb84019509b2f5558fd74c1a05a2c7db22f74174fcedb5286'
target = Path(__file__).resolve().parents[1] / 'data/models/bge-reranker-v2-m3'
target.mkdir(parents=True, exist_ok=True)
snapshot_download(REPO, revision=REVISION, local_dir=target, allow_patterns=['*.json', '*.model'])
output = target / 'model.safetensors'
if not output.exists():
    partial = target / 'model.safetensors.partial'
    with requests.get(f'https://huggingface.co/{REPO}/resolve/{REVISION}/model.safetensors', stream=True, timeout=(20, 60)) as response:
        response.raise_for_status()
        expected = int(response.headers.get('Content-Length', 0))
        size = 0
        digest = hashlib.sha256()
        with partial.open('wb') as stream:
            for chunk in response.iter_content(1024 * 1024 * 8):
                stream.write(chunk)
                digest.update(chunk)
                size += len(chunk)
                if size // (256 * 1024 * 1024) != (size - len(chunk)) // (256 * 1024 * 1024):
                    print(f'Downloaded {size // 1024 // 1024} MiB', flush=True)
        if expected and size != expected:
            raise ValueError('Incomplete model download')
        if digest.hexdigest() != SHA256:
            raise ValueError('Downloaded model checksum mismatch; rerun this script')
    partial.replace(output)
with output.open('rb') as stream:
    if hashlib.file_digest(stream, 'sha256').hexdigest() != SHA256:
        raise ValueError('Model checksum mismatch')
print(f'Model ready: {target}', flush=True)
