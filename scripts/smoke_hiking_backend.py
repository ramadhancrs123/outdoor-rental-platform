#!/usr/bin/env python3
"""Hiking backend public-contract smoke tests. Requires SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any

BASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
API_KEY = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "")
CATALOG_DISABLED = os.environ.get("HIKING_EXPECT_CATALOG_DISABLED", "false").lower() == "true"
ALLOWED_ORIGIN = os.environ.get("HIKING_ALLOWED_ORIGIN", "https://akasha-outdoor.vercel.app")
BLOCKED_ORIGIN = "https://hiking-smoke-test.invalid"

if not BASE_URL or not API_KEY:
    print("FAIL: set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY", file=sys.stderr)
    sys.exit(2)

failures = 0
warnings = 0


def request(
    label: str,
    path: str,
    *,
    method: str = "GET",
    origin: str | None = None,
    body: dict[str, Any] | None = None,
) -> tuple[int, Any, dict[str, str]]:
    headers = {"apikey": API_KEY, "Accept": "application/json"}
    if origin:
        headers["Origin"] = origin
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(BASE_URL + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            status, response_headers, raw = resp.status, dict(resp.headers.items()), resp.read()
    except urllib.error.HTTPError as exc:
        status, response_headers, raw = exc.code, dict(exc.headers.items()), exc.read()
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        payload = {"_raw": raw[:200].decode("utf-8", "replace")}
    clean_headers = {k.lower(): v for k, v in response_headers.items()}
    return status, payload, clean_headers


def check(label: str, condition: bool, detail: str) -> None:
    global failures
    print(json.dumps({"test": label, "result": "PASS" if condition else "FAIL", "detail": detail}, ensure_ascii=False))
    if not condition:
        failures += 1


def warn(label: str, detail: str) -> None:
    global warnings
    warnings += 1
    print(json.dumps({"test": label, "result": "WARN", "detail": detail}, ensure_ascii=False))


status, payload, headers = request("catalog gate", "/functions/v1/hiking-catalog")
if CATALOG_DISABLED:
    check("catalog_fail_closed", status == 503 and isinstance(payload, dict) and payload.get("error") == "FEATURE_DISABLED"
          and payload.get("feature") == "public_hiking_catalog_enabled" and headers.get("cache-control") == "no-store",
          f"HTTP {status}; feature={payload.get('feature') if isinstance(payload, dict) else None}; cache={headers.get('cache-control')}")
else:
    check("catalog_enabled", status == 200 and isinstance(payload, dict) and isinstance(payload.get("items"), list),
          f"HTTP {status}")


status, payload, _ = request("public map marker feed", "/functions/v1/hiking-catalog?resource=map")
if CATALOG_DISABLED:
    check("public_map_fail_closed", status == 503 and isinstance(payload, dict) and payload.get("feature") == "public_hiking_catalog_enabled",
          f"HTTP {status}")
else:
    check("public_map_contract", status == 200 and isinstance(payload, dict) and payload.get("resource") == "map"
          and isinstance(payload.get("items"), list) and payload.get("map", {}).get("coordinateSystem") == "WGS84",
          f"HTTP {status}; markers={len(payload.get('items', [])) if isinstance(payload, dict) and isinstance(payload.get('items'), list) else 'n/a'}")

status, payload, headers = request("route download query validation", "/functions/v1/hiking-catalog?resource=route-download")
check("route_download_requires_slugs", status == 400 and isinstance(payload, dict) and payload.get("error") == "ROUTE_QUERY_REQUIRED"
      and headers.get("cache-control") == "no-store", f"HTTP {status}; error={payload.get('error') if isinstance(payload, dict) else None}")

status, payload, headers = request("route download missing record", "/functions/v1/hiking-catalog?resource=route-download&mountain_slug=missing-mountain&trail_slug=missing-trail")
check("route_download_missing_data_contract", status == 404 and isinstance(payload, dict)
      and payload.get("error") == "TRAIL_NOT_FOUND" and payload.get("message") == "Data jalur belum tersedia."
      and headers.get("cache-control") == "no-store", f"HTTP {status}; error={payload.get('error') if isinstance(payload, dict) else None}")

status, payload, _ = request("direct REST mountain view", "/rest/v1/v_public_hiking_mountains?select=mountain_id,slug")
check("direct_rest_public_mountains", status == 200 and isinstance(payload, list),
      f"HTTP {status}; rows={len(payload) if isinstance(payload, list) else 'n/a'}")

status, payload, _ = request("direct REST alert view", "/rest/v1/v_public_hiking_weather_alerts?select=alert_id,headline")
check("direct_rest_alert_view", status == 200 and isinstance(payload, list),
      f"HTTP {status}; rows={len(payload) if isinstance(payload, list) else 'n/a'}")

status, payload, headers = request("catalog trails gate", "/functions/v1/hiking-catalog?resource=trails")
if CATALOG_DISABLED:
    check("trails_fail_closed", status == 503 and isinstance(payload, dict) and payload.get("feature") == "public_hiking_catalog_enabled",
          f"HTTP {status}; feature={payload.get('feature') if isinstance(payload, dict) else None}")

status, payload, _ = request("catalog alerts", "/functions/v1/hiking-catalog?resource=alerts")
if status == 200 and isinstance(payload, dict) and isinstance(payload.get("items"), list):
    check("alerts_independent_rollout", True, f"HTTP 200; items={len(payload['items'])}")
elif status in (502, 503):
    warn("alerts_upstream_or_rollout", f"HTTP {status}; external feed or alert feature flag currently unavailable")
else:
    check("alerts_independent_rollout", False, f"Unexpected HTTP {status}")

status, payload, headers = request("forecast invalid query", "/functions/v1/hiking-weather-forecast")
check("forecast_query_validation", status == 400 and isinstance(payload, dict) and payload.get("error") == "INVALID_QUERY"
      and headers.get("cache-control") == "no-store",
      f"HTTP {status}; error={payload.get('error') if isinstance(payload, dict) else None}; cache={headers.get('cache-control')}")

status, payload, _ = request("admin without token", "/functions/v1/hiking-admin-api", method="POST", body={"action": "list_mountains"})
check("admin_requires_auth", status == 401 and isinstance(payload, dict) and payload.get("error") == "AUTHENTICATION_REQUIRED",
      f"HTTP {status}; error={payload.get('error') if isinstance(payload, dict) else None}")

status, payload, _ = request("route import without token", "/functions/v1/hiking-route-import", method="POST",
                             body={"action": "apply", "import_id": "00000000-0000-4000-8000-000000000000"})
check("route_import_requires_auth", status == 401 and isinstance(payload, dict) and payload.get("error") == "AUTHENTICATION_REQUIRED",
      f"HTTP {status}; error={payload.get('error') if isinstance(payload, dict) else None}")

status, payload, _ = request("media upload without token", "/functions/v1/hiking-media-upload", method="POST", body={})
check("media_upload_requires_auth", status == 401 and isinstance(payload, dict) and payload.get("error") == "AUTHENTICATION_REQUIRED",
      f"HTTP {status}; error={payload.get('error') if isinstance(payload, dict) else None}")

status, payload, headers = request("allowed origin preflight", "/functions/v1/hiking-admin-api", method="OPTIONS", origin=ALLOWED_ORIGIN)
check("cors_allowlisted_origin", status == 200 and headers.get("access-control-allow-origin") == ALLOWED_ORIGIN,
      f"HTTP {status}; ACAO={headers.get('access-control-allow-origin')}")

status, payload, headers = request("blocked origin preflight", "/functions/v1/hiking-admin-api", method="OPTIONS", origin=BLOCKED_ORIGIN)
check("cors_rejects_unknown_origin", status == 403 and headers.get("access-control-allow-origin") is None
      and isinstance(payload, dict) and payload.get("error") == "ORIGIN_NOT_ALLOWED",
      f"HTTP {status}; ACAO={headers.get('access-control-allow-origin')}")

if CATALOG_DISABLED:
    for label, path in [
        ("REST mountains view hidden", "/rest/v1/v_public_hiking_mountains?select=mountain_id,slug"),
        ("REST trails view hidden", "/rest/v1/v_public_hiking_trails?select=trail_id,slug"),
        ("REST base mountains hidden", "/rest/v1/hiking_mountains?select=mountain_id,publication_status"),
        ("REST feature flags hidden", "/rest/v1/hiking_feature_flags?select=flag_key,is_enabled"),
    ]:
        status, payload, _ = request(label, path)
        if label == "REST feature flags hidden":
            check("feature_flags_not_public", status in (401, 403), f"HTTP {status}")
        else:
            rows_hidden = status == 200 and isinstance(payload, list) and len(payload) == 0
            check(label.replace(" ", "_"), rows_hidden, f"HTTP {status}; rows={len(payload) if isinstance(payload, list) else 'n/a'}")

status, payload, headers = request("invalid alert province", "/functions/v1/hiking-weather-alerts?province=not-a-province")
check("alert_error_not_cached", status == 400 and isinstance(payload, dict) and payload.get("error") == "INVALID_PROVINCE"
      and headers.get("cache-control") == "no-store",
      f"HTTP {status}; error={payload.get('error') if isinstance(payload, dict) else None}; cache={headers.get('cache-control')}")

status, payload, headers = request("public alert feed", "/functions/v1/hiking-weather-alerts?province=Jawa%20Barat")
if status == 200 and isinstance(payload, dict) and isinstance(payload.get("alerts"), list):
    check("bmkg_alert_endpoint", True, f"HTTP 200; alerts={len(payload['alerts'])}; stale={payload.get('stale')}")
elif status in (502, 503):
    warn("bmkg_alert_endpoint", f"BMKG feed currently unavailable; HTTP {status}")
else:
    check("bmkg_alert_endpoint", False, f"Unexpected HTTP {status}")

print(json.dumps({"summary": "PASS" if failures == 0 else "FAIL", "failures": failures, "warnings": warnings}, ensure_ascii=False))
sys.exit(1 if failures else 0)
