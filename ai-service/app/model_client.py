"""Bound every final-judge call before sending it to the local Qwen tokenizer.

For Qwen's byte-level tokenizer, UTF-8 bytes are a conservative token bound.
Include schema bytes, generation allowance, and chat-template headroom; do not
estimate tokens by dividing character count by four. This is not an exact count.
"""
import json
import os

import httpx

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
MODEL = os.getenv("JUDGE_MODEL", "qwen3.5:4b")
CONTEXT_TOKENS = int(os.getenv("JUDGE_CONTEXT_TOKENS", "16384"))
if not 8192 <= CONTEXT_TOKENS <= 65536:
    raise ValueError("JUDGE_CONTEXT_TOKENS must be between 8192 and 65536")
FINAL_TIMEOUT_SECONDS = 600


def prompt_bound(messages, schema, output_tokens=1200):
    serialized = json.dumps({"messages": messages, "format": schema.model_json_schema()}, ensure_ascii=False)
    return len(serialized.encode("utf-8")) + output_tokens + 1024


def fits(messages, schema, output_tokens=1200):
    return prompt_bound(messages, schema, output_tokens) <= CONTEXT_TOKENS


async def structured(messages, schema, *, output_tokens=1200):
    if not fits(messages, schema, output_tokens):
        raise ValueError("Final judge prompt exceeds the configured safe context budget")
    async with httpx.AsyncClient(timeout=90) as client:
        response = await client.post(f"{OLLAMA_URL}/api/chat", json={
            "model": MODEL, "messages": messages, "format": schema.model_json_schema(),
            "think": False, "stream": False,
            "options": {"temperature": 0, "num_predict": output_tokens, "num_ctx": CONTEXT_TOKENS},
        })
        response.raise_for_status()
    data = response.json()
    if not data.get("done") or data.get("done_reason") != "stop":
        raise ValueError("Model output did not finish normally")
    return schema.model_validate_json(data["message"]["content"])
