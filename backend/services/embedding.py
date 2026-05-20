import json
import hashlib
import numpy as np

_MODEL = None
_MODEL_FAILED = False

def _get_model():
    global _MODEL, _MODEL_FAILED
    if _MODEL is None and not _MODEL_FAILED:
        from sentence_transformers import SentenceTransformer
        _MODEL = SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2')
    return _MODEL

def _fallback_embedding(text, dimensions=384):
    vec = np.zeros(dimensions, dtype=np.float32)
    tokens = [token for token in text.lower().split() if token]
    for token in tokens or [text.lower()]:
        digest = hashlib.sha256(token.encode('utf-8')).digest()
        index = int.from_bytes(digest[:4], 'big') % dimensions
        sign = 1.0 if digest[4] % 2 == 0 else -1.0
        vec[index] += sign
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec = vec / norm
    return vec

def get_embedding(text):
    global _MODEL_FAILED
    try:
        model = _get_model()
        emb = model.encode(text, convert_to_numpy=True, normalize_embeddings=True)
    except Exception:
        _MODEL_FAILED = True
        emb = _fallback_embedding(text)
    return emb.tolist()

def embedding_from_json(json_str):
    if not json_str:
        return None
    return np.array(json.loads(json_str), dtype=np.float32)

def cosine_similarity(a, b):
    return float(np.dot(a, b))
