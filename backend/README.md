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
Lambda), `USERS_TABLE` (default `jrf-task-BreatheUsers`), `AWS_REGION` (default
`ap-southeast-2`), and optionally `ALLOWED_ORIGIN`. Each request needs a valid,
unexpired JWT. The Lambda checks the current user's role and `atlas` permission in
DynamoDB, so permission revocations take effect without waiting for token expiry.
Grant its execution role only `dynamodb:GetItem` on the users table and
`geo:SearchPlaceIndexForText` on the Atlas place index.

The API Gateway route is `POST /api/atlas/geocode`; configure `OPTIONS` for browser
preflight and set `ALLOWED_ORIGIN` to the exact deployed Atlas origin. Use the
`jrf-task-atlas-*` prefix for the Lambda,
place index, API, IAM role, and related AWS resources. Do not deploy or create AWS
resources as part of local development.

Configure the Lambda handler as `lambda_geocode.lambda_handler` with a supported
Python runtime. Package the module and its dependencies if they are not available in
that runtime. Do not put `JWT_SECRET` in source or commit it to Git.

## Request and response

```json
{"place_name":"Bidar, Karnataka, India","place_type":"district"}
```

The response contains candidate `place_id`, `label`, `latitude`, `longitude`,
`relevance`, and `place_type` fields. Search is restricted to India and returns a
maximum of five results. Candidate results are not persisted until a reviewer
confirms one in the frontend.
