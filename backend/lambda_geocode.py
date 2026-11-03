"""Atlas place-search Lambda.

Receives a place name and returns up to five coordinate candidates from the
configured Amazon Location place index. It never writes to the records database.
"""

import base64
import binascii
import hashlib
import hmac
import json
import logging
import math
import os
import re
import time

import boto3
from botocore.exceptions import BotoCoreError, ClientError

LOGGER = logging.getLogger(__name__)
LOGGER.setLevel(logging.INFO)

AWS_REGION = os.environ.get("AWS_REGION", "ap-southeast-2")
PLACE_INDEX_NAME = os.environ.get("ATLAS_PLACE_INDEX_NAME", "jrf-task-atlas-place-index")
JWT_SECRET = os.environ.get("JWT_SECRET", "")
USERS_TABLE_NAME = os.environ.get("USERS_TABLE", "jrf-task-BreatheUsers")
location = boto3.client("location", region_name=AWS_REGION)
users_table = boto3.resource("dynamodb", region_name=AWS_REGION).Table(USERS_TABLE_NAME)


def _response(status_code, body=None):
    return {
        "statusCode": status_code,
        "headers": {
            "Access-Control-Allow-Origin": os.environ.get("ALLOWED_ORIGIN", "*"),
            "Access-Control-Allow-Methods": "POST,OPTIONS",
            "Access-Control-Allow-Headers": "content-type,authorization",
            "Content-Type": "application/json",
        },
        "body": json.dumps(body or {}),
    }


def _request_body(event):
    body = event.get("body") or {}
    if isinstance(body, str):
        if event.get("isBase64Encoded"):
            body = base64.b64decode(body).decode("utf-8")
        body = json.loads(body)
    if not isinstance(body, dict):
        raise ValueError("Request body must be a JSON object")
    return body


def _authorized(event):
    if not JWT_SECRET:
        LOGGER.error("JWT_SECRET is not configured")
        return False, "Atlas authentication is not configured"
    headers = event.get("headers") or {}
    authorization = next(
        (value for key, value in headers.items() if isinstance(key, str) and key.lower() == "authorization"),
        "",
    )
    if not isinstance(authorization, str) or len(authorization) > 8192:
        return False, "Invalid authentication token"
    if not authorization.lower().startswith("bearer "):
        return False, "Authentication required"
    parts = authorization[7:].strip().split(".")
    if len(parts) != 3:
        return False, "Invalid authentication token"
    header, body, signature = parts
    if not re.fullmatch(r"[A-Za-z0-9_-]+", signature):
        return False, "Invalid authentication token"
    expected = base64.urlsafe_b64encode(
        hmac.new(JWT_SECRET.encode(), f"{header}.{body}".encode(), hashlib.sha256).digest(),
    ).rstrip(b"=").decode()
    if not hmac.compare_digest(signature, expected):
        return False, "Invalid authentication token"
    try:
        jwt_header = json.loads(base64.urlsafe_b64decode(header + "=" * (-len(header) % 4)))
        payload = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    except (TypeError, ValueError, json.JSONDecodeError):
        return False, "Invalid authentication token"
    if (
        not isinstance(jwt_header, dict)
        or jwt_header.get("alg") != "HS256"
        or not isinstance(payload, dict)
        or not isinstance(payload.get("exp"), (int, float))
        or payload["exp"] < int(time.time())
    ):
        return False, "Invalid or expired authentication token"
    username = payload.get("username")
    if not isinstance(username, str) or not username.strip():
        return False, "Invalid authentication token"
    try:
        user = users_table.get_item(Key={"username": username.strip().lower()}).get("Item")
    except (BotoCoreError, ClientError):
        LOGGER.exception("Could not verify the current Atlas permission")
        return False, "Atlas permission check is temporarily unavailable"
    if not user:
        return False, "User account is unavailable"
    permissions = user.get("permissions")
    if not isinstance(permissions, list):
        permissions = []
    if user.get("role") != "admin" and "atlas" not in permissions:
        return False, "Atlas access required"
    return True, ""


def lambda_handler(event, _context):
    """Validate an Atlas place query and return geocoding candidates."""
    method = (
        event.get("requestContext", {}).get("http", {}).get("method")
        or event.get("httpMethod", "POST")
    ).upper()
    if method == "OPTIONS":
        return _response(204)
    if method != "POST":
        return _response(405, {"detail": "Method not allowed"})
    authorized, auth_error = _authorized(event)
    if not authorized:
        status_by_error = {
            "Atlas authentication is not configured": 500,
            "Atlas permission check is temporarily unavailable": 503,
            "User account is unavailable": 401,
            "Atlas access required": 403,
        }
        status = status_by_error.get(auth_error, 401)
        return _response(status, {"detail": auth_error})
    if not PLACE_INDEX_NAME:
        LOGGER.error("ATLAS_PLACE_INDEX_NAME is not configured")
        return _response(500, {"detail": "Atlas place search is not configured"})
    try:
        body = _request_body(event)
    except (ValueError, json.JSONDecodeError, UnicodeDecodeError, binascii.Error) as error:
        return _response(400, {"detail": str(error)})

    place_name = body.get("place_name")
    place_type = body.get("place_type")
    if not isinstance(place_name, str) or not 2 <= len(place_name.strip()) <= 200:
        return _response(400, {"detail": "place_name must contain 2 to 200 characters"})
    if not isinstance(place_type, str) or not 1 <= len(place_type.strip()) <= 60:
        return _response(400, {"detail": "place_type must contain 1 to 60 characters"})

    try:
        result = location.search_place_index_for_text(
            IndexName=PLACE_INDEX_NAME,
            Text=place_name.strip(),
            FilterCountries=["IND"],
            MaxResults=5,
        )
    except (BotoCoreError, ClientError):
        LOGGER.exception("Amazon Location place search failed")
        return _response(502, {"detail": "Atlas place search is temporarily unavailable"})

    matches = []
    for candidate in result.get("Results", []):
        place = candidate.get("Place") or {}
        point = (place.get("Geometry") or {}).get("Point")
        place_id = candidate.get("PlaceId")
        label = place.get("Label")
        relevance = candidate.get("Relevance")
        if (
            (place_id is not None and (not isinstance(place_id, str) or not place_id))
            or not isinstance(label, str)
            or not label
            or not isinstance(point, list)
            or len(point) != 2
            or any(isinstance(value, bool) or not isinstance(value, (int, float)) for value in point)
            or not math.isfinite(point[0])
            or not math.isfinite(point[1])
            or not -180 <= point[0] <= 180
            or not -90 <= point[1] <= 90
            or isinstance(relevance, bool)
            or not isinstance(relevance, (int, float))
            or not math.isfinite(relevance)
            or not 0 <= relevance <= 1
        ):
            continue
        if not place_id:
            identity = f"{label}|{point[0]:.7f}|{point[1]:.7f}".encode("utf-8")
            place_id = f"esri:{hashlib.sha256(identity).hexdigest()[:24]}"
        matches.append({
            "place_id": place_id,
            "label": label,
            "longitude": point[0],
            "latitude": point[1],
            "relevance": relevance,
            "place_type": place_type.strip(),
        })
    return _response(200, {"matches": matches})
