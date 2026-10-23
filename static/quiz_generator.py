"""Source extraction and multiple-choice quiz generation."""
import ipaddress
import json
import re
import socket
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from urllib.parse import parse_qs, urlsplit

import requests
import ollama


class _TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "noscript", "svg"}:
            self.skip += 1

    def handle_endtag(self, tag):
        if tag in {"script", "style", "noscript", "svg"} and self.skip:
            self.skip -= 1

    def handle_data(self, data):
        if not self.skip and data.strip():
            self.parts.append(data.strip())


def _safe_url(url):
    parsed = urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Enter a valid HTTPS website or YouTube link.")
    host = parsed.hostname.lower()
    if host in {"localhost", "localhost.localdomain"}:
        raise ValueError("That website address is not supported.")
    try:
        if not ipaddress.ip_address(host).is_global:
            raise ValueError("That website address is not supported.")
    except ValueError as error:
        if "not supported" in str(error):
            raise
        try:
            resolved = {entry[4][0] for entry in socket.getaddrinfo(host, parsed.port or 443, type=socket.SOCK_STREAM)}
        except OSError as dns_error:
            raise ValueError("Could not find that website. Check the URL and try again.") from dns_error
        if not resolved or any(not ipaddress.ip_address(address).is_global for address in resolved):
            raise ValueError("That website address is not supported.")
    return parsed


def extract_url_text(url):
    parsed = _safe_url(url)
    host = (parsed.hostname or "").lower()
    video_id = ""
    if host in {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"}:
        video_id = (parsed.path.strip("/").split("/")[0] if host == "youtu.be" else parse_qs(parsed.query).get("v", [""])[0])
        if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id or ""):
            raise ValueError("Enter a valid YouTube video link.")
        tracks_response = requests.get("https://www.youtube.com/api/timedtext", params={"v": video_id, "type": "list"}, timeout=15)
        tracks_response.raise_for_status()
        try:
            tracks = ET.fromstring(tracks_response.text).findall("track")
        except ET.ParseError:
            tracks = []
        if not tracks:
            raise ValueError("No captions were available for this YouTube video.")
        track = next((track for track in tracks if track.get("lang_code", "").startswith("en")), tracks[0])
        response = requests.get("https://www.youtube.com/api/timedtext", params={"v": video_id, "lang": track.get("lang_code", "en"), "name": track.get("name", "")}, timeout=15)
        response.raise_for_status()
        try:
            text = " ".join((element.text or "") for element in ET.fromstring(response.text).iter("text"))
        except ET.ParseError:
            text = re.sub(r"<[^>]+>", " ", response.text)
        if not text.strip():
            raise ValueError("Could not read captions for this YouTube video.")
        return text[:24000]

    response = requests.get(url, timeout=15, allow_redirects=False, headers={"User-Agent": "Mozilla/5.0 StudyTool/1.0"})
    response.raise_for_status()
    if "text/html" not in response.headers.get("Content-Type", "").lower():
        raise ValueError("That link does not point to a readable website page.")
    parser = _TextExtractor()
    parser.feed(response.text[:2_000_000])
    text = " ".join(parser.parts)
    if len(text.strip()) < 80:
        raise ValueError("Not enough readable text was found on that website.")
    return text[:24000]


def generate_quiz(text, count):
    cards = []
    seen = set()
    attempts = 0
    while len(cards) < count and attempts < count + 4:
        attempts += 1
        amount = min(5, count - len(cards))
        prior = "\n".join(f"- {item['question']}" for item in cards)
        response = ollama.chat(
            model="qwen3.5:2b",
            messages=[
                {"role": "system", "content": "Write accurate student multiple-choice questions using only the source. Return JSON with a questions array. Every item has question, options (exactly four strings), and answer (exactly one option string)."},
                {"role": "user", "content": f"Create exactly {amount} distinct MCQ questions. Do not repeat these questions:\n{prior or '(none)'}\nReturn JSON only. Source:\n{text[:24000]}"},
            ],
            format="json", think=False, stream=False,
            options={"temperature": 0.1, "num_predict": 1800, "num_ctx": 12288},
        )
        try:
            raw = json.loads(response["message"]["content"])
        except (KeyError, TypeError, json.JSONDecodeError):
            continue
        for item in raw.get("questions", []) if isinstance(raw, dict) else []:
            if not isinstance(item, dict):
                continue
            question, options, answer = item.get("question"), item.get("options"), item.get("answer")
            if not isinstance(question, str) or not isinstance(options, list) or len(options) != 4 or not all(isinstance(x, str) for x in options) or not isinstance(answer, str):
                continue
            options = [x.strip() for x in options]
            question, answer = question.strip(), answer.strip()
            key = question.casefold()
            if question and len(set(options)) == 4 and answer in options and key not in seen:
                seen.add(key)
                cards.append({"question": question[:1000], "options": options, "answer": answer})
                if len(cards) == count:
                    break
    if len(cards) != count:
        raise ValueError(f"The source supported {len(cards)} of the {count} questions requested. Try a longer source or choose a smaller number.")
    return cards
