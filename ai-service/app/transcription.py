"""Local, bounded speech clips. Speaker identity is assigned by the web backend."""
import io
import os
from pathlib import Path
from functools import lru_cache
from threading import Lock
import wave
import numpy as np

MODEL = os.getenv("WHISPER_MODEL", "base.en")
MAX_AUDIO_BYTES = 1_000_000
inference_lock = Lock()


@lru_cache(maxsize=1)
def speech_model():
    from faster_whisper import WhisperModel
    return WhisperModel(
        MODEL, device="cpu", compute_type="int8", cpu_threads=4, num_workers=1,
        download_root=os.getenv("WHISPER_MODEL_DIR", str(Path(__file__).resolve().parents[1] / ".models")),
    )


def decode_wav(data: bytes) -> np.ndarray:
    if not data or len(data) > MAX_AUDIO_BYTES:
        raise ValueError("Provide a WAV clip under 1 MB")
    try:
        with wave.open(io.BytesIO(data), "rb") as audio:
            if audio.getnchannels() != 1 or audio.getsampwidth() != 2 or audio.getframerate() != 16000:
                raise ValueError("Audio must be mono, 16 kHz, 16-bit PCM WAV")
            if not 0 < audio.getnframes() <= 16000 * 15:
                raise ValueError("Audio clips must be between 0 and 15 seconds")
            samples = np.frombuffer(audio.readframes(audio.getnframes()), dtype="<i2").astype(np.float32) / 32768.0
    except (wave.Error, EOFError) as exc:
        raise ValueError("Invalid WAV audio") from exc
    if not samples.size:
        raise ValueError("Audio clip is empty")
    return samples


def transcribe_wav(data: bytes) -> str:
    samples = decode_wav(data)
    if float(np.sqrt(np.mean(samples * samples))) < 0.003:
        return ""
    with inference_lock:
        segments, _ = speech_model().transcribe(
            samples, language="en", beam_size=3, condition_on_previous_text=False,
            vad_filter=True, vad_parameters={"min_silence_duration_ms": 300},
            no_speech_threshold=0.6,
        )
        return " ".join(segment.text.strip() for segment in segments if segment.text.strip()).strip()
