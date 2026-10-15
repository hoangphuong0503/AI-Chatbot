"""Persistent, private JSONL cross-encoder worker. Never opens a network listener."""
import json
import os
import sys
import time
from pathlib import Path
from reranker_device import select_device

os.environ.setdefault('HF_HUB_DISABLE_PROGRESS_BARS', '1')
os.environ.setdefault('TOKENIZERS_PARALLELISM', 'false')


def send(value):
    print(json.dumps(value), flush=True)


def main():
    import torch
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    name = os.environ.get('LOCAL_RERANKER_MODEL', 'BAAI/bge-reranker-v2-m3')
    device = select_device(torch, os.environ.get('LOCAL_RERANKER_DEVICE', 'auto'))
    torch.set_num_threads(4)
    pinned = '953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e'
    revision = os.environ.get('LOCAL_RERANKER_REVISION', pinned if name == 'BAAI/bge-reranker-v2-m3' else 'main')
    local = Path(__file__).resolve().parents[1] / 'data/models/bge-reranker-v2-m3'
    source = str(local) if name == 'BAAI/bge-reranker-v2-m3' and revision == pinned and (local / 'model.safetensors').exists() else name
    tokenizer = AutoTokenizer.from_pretrained(source, revision=revision, trust_remote_code=False)
    model = AutoModelForSequenceClassification.from_pretrained(source, revision=revision, trust_remote_code=False, use_safetensors=True)
    model.to(device).eval()
    if device == 'cuda':
        model.half()

    def score(query, documents):
        # Preserve evidence at the end of long chunks instead of silently dropping
        # it. Score overlapping passage windows and retain each chunk's maximum.
        query_ids = tokenizer.encode(query, add_special_tokens=False, truncation=True, max_length=256)
        query = tokenizer.decode(query_ids, skip_special_tokens=True)
        encoded = tokenizer([query] * len(documents), documents, padding=True, truncation='only_second',
                            max_length=512, stride=64, return_overflowing_tokens=True, return_tensors='pt')
        mapping = encoded.pop('overflow_to_sample_mapping').tolist()
        scores = [float('-inf')] * len(documents)
        with torch.inference_mode():
            for offset in range(0, len(mapping), 4):
                inputs = {key: value[offset:offset + 4].to(device) for key, value in encoded.items()}
                batch = model(**inputs).logits.view(-1).float().cpu().tolist()
                for index, value in enumerate(batch, offset):
                    scores[mapping[index]] = max(scores[mapping[index]], value)
        return scores

    # Include kernel initialization in startup, not the first user's request.
    score('course fees', ['The course tuition is listed on the official website.'])
    send({'type': 'ready', 'model': name, 'device': device, 'max_length': 512})
    for line in sys.stdin:
        request = json.loads(line)
        try:
            query, documents = request['query'], request['documents']
            if not isinstance(query, str) or len(query) > 10000 or not isinstance(documents, list) or len(documents) > 100:
                raise ValueError('Invalid input')
            if any(not isinstance(d, str) or len(d) > 50000 for d in documents):
                raise ValueError('Invalid document')
            start = time.perf_counter()
            scores = score(query, documents) if documents else []
            send({'id': request['id'], 'scores': scores, 'inference_ms': round((time.perf_counter() - start) * 1000)})
        except Exception:
            send({'id': request.get('id'), 'error': 'Local reranker inference failed'})


if __name__ == '__main__':
    main()
