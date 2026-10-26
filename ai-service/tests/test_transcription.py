import io
import wave
import numpy as np
import pytest
from app.transcription import decode_wav, transcribe_wav


def wav_bytes(rate=16000, duration=1, channels=1):
    output = io.BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setnchannels(channels)
        audio.setsampwidth(2)
        audio.setframerate(rate)
        audio.writeframes(bytes(rate * duration * 2 * channels))
    return output.getvalue()


def test_decode_and_silence():
    assert decode_wav(wav_bytes()).shape == (16000,)
    assert transcribe_wav(wav_bytes()) == ""


@pytest.mark.parametrize("data", [b"not audio", wav_bytes(rate=48000), wav_bytes(duration=16), wav_bytes(channels=2)])
def test_invalid_audio_is_rejected(data):
    with pytest.raises(ValueError):
        decode_wav(data)
