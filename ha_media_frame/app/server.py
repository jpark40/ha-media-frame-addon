#!/usr/bin/env python3
"""Small dependency-free web server for HA Media Frame."""

from __future__ import annotations

import json
import mimetypes
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from email.utils import formatdate
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


APP_ROOT = Path(__file__).resolve().parent
STATIC_ROOT = APP_ROOT / "static"
DATA_ROOT = Path(os.environ.get("DATA_DIR", "/data"))
MEDIA_ROOT = Path(os.environ.get("MEDIA_ROOT", "/media")).resolve()
SETTINGS_PATH = DATA_ROOT / "settings.json"
PORT = int(os.environ.get("PORT", "8099"))
VERSION = "1.2.5"

IMAGE_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".avif"
}
VIDEO_EXTENSIONS = {".mp4", ".m4v", ".mov", ".webm", ".ogv"}
SKIPPED_DIRECTORIES = {"@eadir", ".thumbnails", "thumbs", "thumbnails"}

DEFAULT_SETTINGS: dict[str, Any] = {
    "media_path": "/media",
    "photo_seconds": 30,
    "video_seconds": 30,
    "video_repeats": 3,
    "shuffle": True,
    "fit": "contain",
    "transition_seconds": 1.2,
    "scan_seconds": 60,
    "show_clock": True,
    "show_weather": True,
    "weather_entity": "",
}

SETTINGS_LOCK = threading.RLock()
MEDIA_LOCK = threading.RLock()
WEATHER_LOCK = threading.RLock()
MEDIA_CACHE: dict[str, Any] = {"key": None, "at": 0.0, "items": [], "error": None}
WEATHER_CACHE: dict[str, Any] = {"key": None, "at": 0.0, "value": None}


def _bool(value: Any, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return default


def _number(value: Any, default: float, minimum: float, maximum: float) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        result = default
    return min(max(result, minimum), maximum)


def canonical_media_path(value: Any) -> str:
    raw = str(value or "/media").strip().replace("\\", "/")
    if raw == "/media":
        relative = ""
    elif raw.startswith("/media/"):
        relative = raw[len("/media/") :]
    elif raw.startswith("media/"):
        relative = raw[len("media/") :]
    else:
        relative = raw.lstrip("/")

    parts = [part for part in relative.split("/") if part not in {"", "."}]
    if any(part == ".." for part in parts):
        raise ValueError("Media folder cannot contain '..'.")
    return "/media" + ("/" + "/".join(parts) if parts else "")


def resolve_media_path(value: Any) -> Path:
    canonical = canonical_media_path(value)
    relative = canonical[len("/media") :].lstrip("/")
    candidate = (MEDIA_ROOT / relative).resolve()
    try:
        candidate.relative_to(MEDIA_ROOT)
    except ValueError as exc:
        raise ValueError("Media folder must stay inside /media.") from exc
    return candidate


def normalize_settings(raw: Any) -> dict[str, Any]:
    source = raw if isinstance(raw, dict) else {}
    settings = dict(DEFAULT_SETTINGS)
    settings["media_path"] = canonical_media_path(source.get("media_path", settings["media_path"]))
    settings["photo_seconds"] = int(_number(source.get("photo_seconds"), 30, 2, 86400))
    settings["video_seconds"] = int(_number(source.get("video_seconds"), 30, 0, 86400))
    settings["video_repeats"] = int(_number(source.get("video_repeats"), 3, 1, 100))
    settings["transition_seconds"] = round(
        _number(source.get("transition_seconds"), 1.2, 0, 10), 2
    )
    settings["scan_seconds"] = int(_number(source.get("scan_seconds"), 60, 10, 3600))
    settings["shuffle"] = _bool(source.get("shuffle"), True)
    settings["show_clock"] = _bool(source.get("show_clock"), True)
    settings["show_weather"] = _bool(source.get("show_weather"), True)
    settings["fit"] = source.get("fit") if source.get("fit") in {"contain", "cover"} else "contain"
    entity = str(source.get("weather_entity", "")).strip()
    settings["weather_entity"] = entity if entity.startswith("weather.") else ""
    resolve_media_path(settings["media_path"])
    return settings


def load_settings() -> dict[str, Any]:
    with SETTINGS_LOCK:
        try:
            payload = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            payload = {}
        return normalize_settings(payload)


def save_settings(payload: Any) -> dict[str, Any]:
    settings = normalize_settings(payload)
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    temp_path = SETTINGS_PATH.with_suffix(".tmp")
    with SETTINGS_LOCK:
        temp_path.write_text(json.dumps(settings, indent=2) + "\n", encoding="utf-8")
        os.replace(temp_path, SETTINGS_PATH)
    with MEDIA_LOCK:
        MEDIA_CACHE.update({"key": None, "at": 0.0, "items": [], "error": None})
    with WEATHER_LOCK:
        WEATHER_CACHE.update({"key": None, "at": 0.0, "value": None})
    return settings


def discover_folders() -> list[str]:
    folders = ["/media"]
    if not MEDIA_ROOT.is_dir():
        return folders

    for current, directory_names, _ in os.walk(MEDIA_ROOT, followlinks=False):
        directory_names[:] = sorted(
            name
            for name in directory_names
            if not name.startswith(".") and name.casefold() not in SKIPPED_DIRECTORIES
        )
        current_path = Path(current)
        if current_path != MEDIA_ROOT:
            try:
                relative = current_path.relative_to(MEDIA_ROOT).as_posix()
                folders.append(f"/media/{relative}")
            except ValueError:
                continue
        if len(folders) >= 1000:
            break
    return folders


def _media_url(path: Path) -> str:
    relative = path.relative_to(MEDIA_ROOT).as_posix()
    return "/media/" + urllib.parse.quote(relative, safe="/")


def scan_media(force: bool = False) -> tuple[list[dict[str, Any]], str | None]:
    settings = load_settings()
    cache_key = settings["media_path"]
    now = time.monotonic()
    with MEDIA_LOCK:
        fresh = (
            not force
            and MEDIA_CACHE["key"] == cache_key
            and now - MEDIA_CACHE["at"] < settings["scan_seconds"]
        )
        if fresh:
            return list(MEDIA_CACHE["items"]), MEDIA_CACHE["error"]

        selected = resolve_media_path(cache_key)
        items: list[dict[str, Any]] = []
        error: str | None = None
        if not selected.is_dir():
            error = f"Media folder is unavailable: {cache_key}"
        else:
            try:
                for current, directory_names, filenames in os.walk(selected, followlinks=False):
                    directory_names[:] = sorted(
                        name
                        for name in directory_names
                        if not name.startswith(".") and name.casefold() not in SKIPPED_DIRECTORIES
                    )
                    for filename in sorted(filenames, key=str.casefold):
                        if filename.startswith("."):
                            continue
                        path = Path(current) / filename
                        extension = path.suffix.casefold()
                        if extension not in IMAGE_EXTENSIONS and extension not in VIDEO_EXTENSIONS:
                            continue
                        try:
                            resolved = path.resolve()
                            resolved.relative_to(MEDIA_ROOT)
                            stat = resolved.stat()
                        except (OSError, ValueError):
                            continue
                        items.append(
                            {
                                "name": filename,
                                "type": "video" if extension in VIDEO_EXTENSIONS else "image",
                                "url": _media_url(path),
                                "size": stat.st_size,
                                "modified": int(stat.st_mtime),
                            }
                        )
            except OSError as exc:
                error = f"Could not scan {cache_key}: {exc.strerror or exc}"

        items.sort(key=lambda item: item["url"].casefold())
        MEDIA_CACHE.update({"key": cache_key, "at": now, "items": items, "error": error})
        return list(items), error


def ha_request(path: str, method: str = "GET", payload: Any = None) -> Any:
    token = os.environ.get("SUPERVISOR_TOKEN", "")
    if not token:
        raise RuntimeError("Home Assistant API is unavailable outside Supervisor.")
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        "http://supervisor/core/api" + path,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=8) as response:
        body = response.read()
    return json.loads(body) if body else None


def weather_entities() -> list[dict[str, str]]:
    states = ha_request("/states")
    entities = []
    for state in states if isinstance(states, list) else []:
        entity_id = state.get("entity_id", "")
        if not entity_id.startswith("weather."):
            continue
        attributes = state.get("attributes") or {}
        entities.append(
            {
                "entity_id": entity_id,
                "name": str(attributes.get("friendly_name") or entity_id),
            }
        )
    return sorted(entities, key=lambda item: item["name"].casefold())


def _forecast_from_service(result: Any, entity_id: str) -> list[dict[str, Any]]:
    if not isinstance(result, dict):
        return []
    container = result.get("service_response", result)
    if not isinstance(container, dict):
        return []
    entity_result = container.get(entity_id, container)
    if not isinstance(entity_result, dict):
        return []
    forecasts = entity_result.get("forecast", [])
    return forecasts if isinstance(forecasts, list) else []


def weather_payload() -> dict[str, Any]:
    settings = load_settings()
    entity_id = settings["weather_entity"]
    if not settings["show_weather"] or not entity_id:
        return {"enabled": False, "current": None, "forecast": []}

    now = time.monotonic()
    with WEATHER_LOCK:
        if WEATHER_CACHE["key"] == entity_id and now - WEATHER_CACHE["at"] < 120:
            return dict(WEATHER_CACHE["value"])

        state = ha_request("/states/" + urllib.parse.quote(entity_id, safe="."))
        attributes = state.get("attributes") or {}
        forecasts = attributes.get("forecast") if isinstance(attributes.get("forecast"), list) else []
        try:
            service_result = ha_request(
                "/services/weather/get_forecasts?return_response",
                method="POST",
                payload={"entity_id": entity_id, "type": "daily"},
            )
            service_forecasts = _forecast_from_service(service_result, entity_id)
            if service_forecasts:
                forecasts = service_forecasts
        except (RuntimeError, urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError):
            pass

        result = {
            "enabled": True,
            "current": {
                "condition": state.get("state", "unknown"),
                "temperature": attributes.get("temperature"),
                "temperature_unit": attributes.get("temperature_unit", "°"),
                "wind_speed": attributes.get("wind_speed"),
                "wind_speed_unit": attributes.get("wind_speed_unit", ""),
                "wind_bearing": attributes.get("wind_bearing"),
                "humidity": attributes.get("humidity"),
            },
            "forecast": forecasts[:4],
        }
        WEATHER_CACHE.update({"key": entity_id, "at": now, "value": result})
        return dict(result)


def parse_range(value: str | None, size: int) -> tuple[int, int] | None:
    if not value:
        return None
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", value.strip())
    if not match:
        raise ValueError("Invalid Range header")
    first, last = match.groups()
    if not first and not last:
        raise ValueError("Invalid Range header")
    if not first:
        suffix = int(last)
        if suffix <= 0:
            raise ValueError("Invalid suffix range")
        start = max(size - suffix, 0)
        end = size - 1
    else:
        start = int(first)
        end = int(last) if last else size - 1
    if start >= size or start < 0 or end < start:
        raise ValueError("Range is outside file")
    return start, min(end, size - 1)


class MediaFrameServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "HAMediaFrame/1.0"

    def _security_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")

    def send_json(self, payload: Any, status: int = HTTPStatus.OK) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self._security_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def read_json(self) -> Any:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("Invalid Content-Length") from exc
        if length < 1 or length > 65536:
            raise ValueError("Request body must be between 1 and 65536 bytes")
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def send_static(self, filename: str, content_type: str) -> None:
        path = STATIC_ROOT / filename
        try:
            body = path.read_bytes()
        except OSError:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        self.send_response(HTTPStatus.OK)
        self._security_headers()
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_media_file(self, request_path: str) -> None:
        relative = urllib.parse.unquote(request_path[len("/media/") :])
        candidate = (MEDIA_ROOT / relative).resolve()
        try:
            candidate.relative_to(MEDIA_ROOT)
        except ValueError:
            self.send_error(HTTPStatus.FORBIDDEN)
            return
        if not candidate.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        stat = candidate.stat()
        etag = f'"{stat.st_mtime_ns:x}-{stat.st_size:x}"'
        if self.headers.get("If-None-Match") == etag and not self.headers.get("Range"):
            self.send_response(HTTPStatus.NOT_MODIFIED)
            self._security_headers()
            self.send_header("ETag", etag)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        try:
            byte_range = parse_range(self.headers.get("Range"), stat.st_size)
        except ValueError:
            self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
            self._security_headers()
            self.send_header("Content-Range", f"bytes */{stat.st_size}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        mime_type = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        start, end = byte_range if byte_range else (0, stat.st_size - 1)
        length = max(0, end - start + 1)
        self.send_response(HTTPStatus.PARTIAL_CONTENT if byte_range else HTTPStatus.OK)
        self._security_headers()
        self.send_header("Content-Type", mime_type)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        self.send_header("Last-Modified", formatdate(stat.st_mtime, usegmt=True))
        self.send_header("ETag", etag)
        self.send_header("Cache-Control", "private, max-age=3600")
        if byte_range:
            self.send_header("Content-Range", f"bytes {start}-{end}/{stat.st_size}")
        self.end_headers()

        if self.command == "HEAD" or length == 0:
            return
        try:
            with candidate.open("rb") as source:
                source.seek(start)
                remaining = length
                while remaining:
                    chunk = source.read(min(1024 * 1024, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            return

    def route_get(self) -> None:
        parsed = urllib.parse.urlsplit(self.path)
        path = parsed.path
        static_routes = {
            "/": ("index.html", "text/html; charset=utf-8"),
            "/settings": ("settings.html", "text/html; charset=utf-8"),
            "/style.css": ("style.css", "text/css; charset=utf-8"),
            "/app.js": ("app.js", "text/javascript; charset=utf-8"),
            "/settings.css": ("settings.css", "text/css; charset=utf-8"),
            "/settings.js": ("settings.js", "text/javascript; charset=utf-8"),
        }
        if path in static_routes:
            self.send_static(*static_routes[path])
            return
        if path == "/favicon.ico":
            self.send_response(HTTPStatus.NO_CONTENT)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if path == "/health":
            self.send_json({"status": "ok", "version": VERSION})
            return
        if path == "/api/config":
            self.send_json({"version": VERSION, "settings": load_settings()})
            return
        if path == "/api/folders":
            self.send_json({"folders": discover_folders()})
            return
        if path == "/api/media":
            force = urllib.parse.parse_qs(parsed.query).get("rescan") == ["1"]
            items, error = scan_media(force=force)
            self.send_json({"items": items, "count": len(items), "error": error})
            return
        if path == "/api/weather/entities":
            try:
                self.send_json({"entities": weather_entities(), "error": None})
            except Exception as exc:  # API availability must never stop media playback.
                self.send_json({"entities": [], "error": str(exc)})
            return
        if path == "/api/weather":
            try:
                self.send_json({"weather": weather_payload(), "error": None})
            except Exception as exc:  # API availability must never stop media playback.
                self.send_json({"weather": None, "error": str(exc)})
            return
        if path.startswith("/media/"):
            self.send_media_file(path)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_GET(self) -> None:  # noqa: N802
        self.route_get()

    def do_HEAD(self) -> None:  # noqa: N802
        self.route_get()

    def do_POST(self) -> None:  # noqa: N802
        path = urllib.parse.urlsplit(self.path).path
        if path == "/api/config":
            try:
                settings = save_settings(self.read_json())
                self.send_json({"settings": settings, "saved": True})
            except (ValueError, json.JSONDecodeError, OSError) as exc:
                self.send_json({"saved": False, "error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return
        if path == "/api/rescan":
            items, error = scan_media(force=True)
            self.send_json({"count": len(items), "error": error})
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def log_message(self, message: str, *args: Any) -> None:
        print(f"[{self.log_date_time_string()}] {self.address_string()} {message % args}", flush=True)


def main() -> None:
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    mimetypes.add_type("image/avif", ".avif")
    mimetypes.add_type("video/mp4", ".m4v")
    server = MediaFrameServer(("0.0.0.0", PORT), Handler)
    print(f"HA Media Frame {VERSION} listening on 0.0.0.0:{PORT}", flush=True)
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
