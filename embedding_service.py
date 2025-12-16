from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List
from sentence_transformers import SentenceTransformer, util
import torch

app = FastAPI(title="EchoFinder Embedding Service")

class EmbedRequest(BaseModel):
    text: str

class CompareRequest(BaseModel):
    new_text: str
    old_texts: List[str]

# Load model once
try:
    model = SentenceTransformer('all-MiniLM-L6-v2')
    print("✓ Model loaded successfully.")
except Exception as e:
    print(f"✗ Failed to load model: {e}")
    model = None

@app.post("/embed")
def embed(req: EmbedRequest):
    if not model:
        raise HTTPException(status_code=500, detail="Model not loaded")
    text = req.text or ""
    vec = model.encode([text])[0].tolist()
    return {"embedding": vec}

@app.post("/compare")
def compare_issues(req: CompareRequest):
    if not model:
        raise HTTPException(status_code=500, detail="Model not loaded")
    if not req.new_text or not req.old_texts:
        raise HTTPException(status_code=400, detail="new_text and old_texts required")

    new_embedding = model.encode(req.new_text, convert_to_tensor=True)
    old_embeddings = model.encode(req.old_texts, convert_to_tensor=True)
    scores = util.cos_sim(new_embedding, old_embeddings)
    best_idx = int(torch.argmax(scores[0]).item())
    best_score = float(scores[0][best_idx])
    all_scores = [float(s) for s in scores[0]]

    return {
        "new_text": req.new_text,
        "scores": all_scores,
        "best_match_index": best_idx,
        "best_score": best_score,
        "threshold_met": best_score > 0.70
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8001)