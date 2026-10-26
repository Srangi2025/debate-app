"""Bounded public-source retrieval. Model-generated URLs are never fetched."""
import asyncio
from collections import OrderedDict
from datetime import datetime, timezone
import os
import json
import shutil
import time
from urllib.parse import quote, urlencode
import httpx

API = "https://en.wikipedia.org/w/api.php"
SUMMARY = "https://en.wikipedia.org/api/rest_v1/page/summary/"
USER_AGENT = os.getenv("FACT_CHECK_USER_AGENT", "RankedDebatePrototype/0.1 (local development)")
cache: OrderedDict[str, tuple[float, list[dict]]] = OrderedDict()
TRANSPORT = os.getenv("EVIDENCE_TRANSPORT", "curl" if shutil.which("curl") else "httpx")


async def read_json(client: httpx.AsyncClient, url: str, params=None):
    # curl is also a documented MediaWiki API client. Choose the configured
    # transport up front; never change identity or retry a denied response.
    if TRANSPORT == "curl":
        if params:
            url += "?" + urlencode(params)
        process = await asyncio.create_subprocess_exec(
            "curl", "--silent", "--show-error", "--fail", "--proto", "=https",
            "--connect-timeout", "3", "--max-time", "6", "--max-filesize", "200000",
            "--user-agent", USER_AGENT, url,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        try:
            output, _ = await asyncio.wait_for(process.communicate(), timeout=7)
        except asyncio.TimeoutError:
            process.kill(); await process.communicate()
            raise ValueError("Evidence API timeout")
        if process.returncode != 0 or len(output) > 200000:
            raise ValueError("Evidence API unavailable")
        return json.loads(output)
    response = await client.get(url, params=params)
    response.raise_for_status()
    return response.json()


async def retrieve_sources(query: str) -> tuple[list[dict], str]:
    query = " ".join(query.split())[:160]
    if not query:
        return [], "no_results"
    cached = cache.get(query.casefold())
    if cached and cached[0] > time.time():
        return cached[1], "ok" if cached[1] else "no_results"
    try:
        async with httpx.AsyncClient(timeout=5, http2=True, headers={"User-Agent": USER_AGENT}, follow_redirects=False) as client:
            response = await read_json(client, API, params={
                "action": "query", "list": "search", "srsearch": query,
                "format": "json", "srlimit": 3, "srnamespace": 0,
            })
            pages = response.get("query", {}).get("search", [])[:3]

            async def read_page(page):
                title = page.get("title")
                if not isinstance(title, str) or not title or len(title) > 300:
                    return None
                data = await read_json(client, SUMMARY + quote(title.replace(" ", "_"), safe=""))
                text = data.get("extract", "")
                if data.get("type") == "disambiguation" or not isinstance(text, str) or not text.strip():
                    return None
                return {
                    "title": title,
                    "url": "https://en.wikipedia.org/wiki/" + quote(title.replace(" ", "_"), safe=""),
                    "text": text[:1800], "provider": "Wikipedia",
                    "retrievedAt": datetime.now(timezone.utc).isoformat(),
                }

            results = await asyncio.gather(*(read_page(page) for page in pages), return_exceptions=True)
            sources = [result for result in results if isinstance(result, dict)]
            if pages and not sources and any(isinstance(result, Exception) for result in results):
                return [], "unavailable"
        cache[query.casefold()] = (time.time() + (3600 if sources else 300), sources)
        cache.move_to_end(query.casefold())
        while len(cache) > 128:
            cache.popitem(last=False)
        return sources, "ok" if sources else "no_results"
    except (httpx.HTTPError, ValueError, TypeError, KeyError, OSError):
        return [], "unavailable"
