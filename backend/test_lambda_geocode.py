import json
import unittest
import base64
import hashlib
import hmac
import time
from unittest.mock import patch

import lambda_geocode


class GeocodeHandlerTests(unittest.TestCase):
    @staticmethod
    def token(secret="test-secret", permissions=None):
        header = base64.urlsafe_b64encode(b'{"alg":"HS256","typ":"JWT"}').rstrip(b"=").decode()
        payload = base64.urlsafe_b64encode(json.dumps({
            "username": "researcher",
            "permissions": permissions or ["atlas"],
            "exp": int(time.time()) + 600,
        }).encode()).rstrip(b"=").decode()
        signature = base64.urlsafe_b64encode(
            hmac.new(secret.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest(),
        ).rstrip(b"=").decode()
        return f"{header}.{payload}.{signature}"

    def test_returns_candidates_without_writing_them(self):
        result = {
            "Results": [{
                "Relevance": 0.94,
                "Place": {
                    "Label": "Bidar, Karnataka, India",
                    "Geometry": {"Point": [77.5, 17.9]},
                },
            }, {
                "PlaceId": "place-without-coordinate",
                "Relevance": 0.8,
                "Place": {"Label": "Incomplete result"},
            }],
        }
        with (
            patch.object(lambda_geocode, "JWT_SECRET", "test-secret"),
            patch.object(lambda_geocode.users_table, "get_item", return_value={"Item": {
                "username": "researcher",
                "role": "user",
                "permissions": ["atlas"],
            }}),
            patch.object(lambda_geocode.location, "search_place_index_for_text", return_value=result) as search,
        ):
            response = lambda_geocode.lambda_handler({
                "httpMethod": "POST",
                "body": json.dumps({"place_name": "Bidar, Karnataka, India", "place_type": "district"}),
                "headers": {"Authorization": f"Bearer {self.token()}"},
            }, None)

        self.assertEqual(response["statusCode"], 200)
        matches = json.loads(response["body"])["matches"]
        self.assertEqual(len(matches), 1)
        self.assertRegex(matches[0]["place_id"], r"^esri:[a-f0-9]{24}$")
        self.assertEqual(matches[0], {
            "place_id": matches[0]["place_id"],
            "label": "Bidar, Karnataka, India",
            "longitude": 77.5,
            "latitude": 17.9,
            "relevance": 0.94,
            "place_type": "district",
        })
        search.assert_called_once_with(
            IndexName="jrf-task-atlas-place-index",
            Text="Bidar, Karnataka, India",
            FilterCountries=["IND"],
            MaxResults=5,
        )

    def test_rejects_invalid_place_name_before_search(self):
        with (
            patch.object(lambda_geocode, "JWT_SECRET", "test-secret"),
            patch.object(lambda_geocode.users_table, "get_item", return_value={"Item": {
                "username": "researcher",
                "role": "user",
                "permissions": ["atlas"],
            }}),
            patch.object(lambda_geocode.location, "search_place_index_for_text") as search,
        ):
            response = lambda_geocode.lambda_handler({
                "httpMethod": "POST",
                "body": json.dumps({"place_name": " ", "place_type": "district"}),
                "headers": {"Authorization": f"Bearer {self.token()}"},
            }, None)
        self.assertEqual(response["statusCode"], 400)
        search.assert_not_called()

    def test_handles_preflight(self):
        with patch.object(lambda_geocode, "ALLOWED_ORIGINS", {
            "http://localhost:5173",
            "https://main.d1g1u8rtpgjn48.amplifyapp.com",
        }):
            response = lambda_geocode.lambda_handler({
                "httpMethod": "OPTIONS",
                "headers": {"origin": "https://main.d1g1u8rtpgjn48.amplifyapp.com"},
            }, None)
        self.assertEqual(response["statusCode"], 204)
        self.assertIn("OPTIONS", response["headers"]["Access-Control-Allow-Methods"])
        self.assertEqual(
            response["headers"]["Access-Control-Allow-Origin"],
            "https://main.d1g1u8rtpgjn48.amplifyapp.com",
        )

    def test_does_not_allow_unconfigured_origins(self):
        with patch.object(lambda_geocode, "ALLOWED_ORIGINS", {"http://localhost:5173"}):
            response = lambda_geocode.lambda_handler({
                "httpMethod": "OPTIONS",
                "headers": {"origin": "https://untrusted.example"},
            }, None)
        self.assertNotIn("Access-Control-Allow-Origin", response["headers"])

    def test_requires_an_atlas_authorized_token(self):
        with (
            patch.object(lambda_geocode, "JWT_SECRET", "test-secret"),
            patch.object(lambda_geocode.users_table, "get_item", return_value={"Item": {
                "username": "researcher",
                "role": "user",
                "permissions": ["history"],
            }}),
            patch.object(lambda_geocode.location, "search_place_index_for_text") as search,
        ):
            response = lambda_geocode.lambda_handler({
                "httpMethod": "POST",
                "body": json.dumps({"place_name": "Bidar", "place_type": "district"}),
                "headers": {"Authorization": f"Bearer {self.token(permissions=['history'])}"},
            }, None)
        self.assertEqual(response["statusCode"], 403)
        search.assert_not_called()

    def test_denies_access_after_live_permission_is_revoked(self):
        with (
            patch.object(lambda_geocode, "JWT_SECRET", "test-secret"),
            patch.object(lambda_geocode.users_table, "get_item", return_value={"Item": {
                "username": "researcher",
                "role": "user",
                "permissions": [],
            }}),
            patch.object(lambda_geocode.location, "search_place_index_for_text") as search,
        ):
            response = lambda_geocode.lambda_handler({
                "httpMethod": "POST",
                "body": json.dumps({"place_name": "Bidar", "place_type": "district"}),
                "headers": {"Authorization": f"Bearer {self.token()}"},
            }, None)
        self.assertEqual(response["statusCode"], 403)
        search.assert_not_called()


if __name__ == "__main__":
    unittest.main()
