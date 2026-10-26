import os
import httpx
from fastapi import FastAPI, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool
from pydantic import ValidationError
from .schemas import DebateRequest, DebateResult, EloPreview, EloPreviewRequest
from .judge import evaluate_debate, JUDGE_VERSION, RUBRIC_VERSION, MODEL
from .elo import calculate_preview
from .transcription import transcribe_wav, speech_model, MAX_AUDIO_BYTES, MODEL as SPEECH_MODEL
from .live_schemas import LiveRequest
from .live_feedback import analyze_live

app = FastAPI(title="Debate AI Judge", version="0.2.0")

@app.post("/live-feedback")
async def live_feedback(request: LiveRequest):
    try:
        return await analyze_live(request)
    except (httpx.HTTPError, ValidationError, ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=503, detail="Live feedback is temporarily unavailable") from exc

@app.get("/transcription/health")
def transcription_health():
    return {"status": "ok", "model": SPEECH_MODEL, "ready": speech_model.cache_info().currsize > 0}

@app.post("/transcribe")
async def transcribe(audio: UploadFile):
    data = await audio.read(MAX_AUDIO_BYTES + 1)
    await audio.close()
    try:
        text = await run_in_threadpool(transcribe_wav, data)
        return {"text": text, "language": "en", "model": SPEECH_MODEL}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Speech transcription is temporarily unavailable") from exc

@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL, "judge_version": JUDGE_VERSION,
            "rubric_version": RUBRIC_VERSION, "elo_updates_enabled": False}

@app.post("/judge", response_model=DebateResult)
async def judge(request: DebateRequest):
    try:
        return await evaluate_debate(request)
    except (httpx.HTTPError, ValidationError, ValueError, KeyError, TypeError) as exc:
        # Never expose raw model output or sensitive debate text in errors.
        raise HTTPException(status_code=502, detail="Judge inference or validation failed; check the server logs") from exc

@app.post("/elo/preview", response_model=EloPreview)
def elo_preview(request: EloPreviewRequest):
    return calculate_preview(request)
