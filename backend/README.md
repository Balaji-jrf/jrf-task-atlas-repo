# Atlas geocoding Lambda

`lambda_geocode.py` resolves a text location to up to five candidate coordinates
using Amazon Location Service. It does not update the OCR database. A researcher
chooses and confirms a candidate in the Atlas UI before its geotag is saved through
the existing records API.

## Local checks

```bash
python -m unittest test_lambda_geocode.py
```

The Lambda uses the AWS SDK available in the Lambda Python runtime. It expects
`ATLAS_PLACE_INDEX_NAME`, `JWT_SECRET` (the same protected secret used by the auth
Lambda), `AWS_REGION` (default `ap-southeast-2`), and optionally `ALLOWED_ORIGIN`.
The request must carry a valid, unexpired JWT with Atlas permission (or admin role).
The deployed Lambda is `jrf-task-atlas-geocode`, behind the
`jrf-task-atlas-api` endpoint:
`https://iz37e4zn02.execute-api.ap-southeast-2.amazonaws.com/api/atlas/geocode`.
Its current CORS origin is the local Atlas dev server; update it and API Gateway CORS
for the exact Amplify origin after deployment.

The associated map and place index are `jrf-task-atlas-map` and
`jrf-task-atlas-place-index`. The browser key is `jrf-task-atlas-browser-key` and is
restricted to map read actions and the localhost Atlas origin until Amplify is ready.

## Request and response

```json
{"place_name":"Bidar, Karnataka, India","place_type":"district"}
```

The response contains candidate `place_id`, `label`, `latitude`, `longitude`,
`relevance`, and `place_type` fields. Esri may omit its provider place ID; in that
case the Lambda creates a stable `esri:` ID from the candidate label and coordinates.
Search is restricted to India and returns a maximum of five results. Candidate
results are not persisted until a reviewer confirms one in the frontend.
