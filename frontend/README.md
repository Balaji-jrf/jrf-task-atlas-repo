# Atlas frontend

Standalone React/Vite app hosted independently from Archive Lens and embedded as an
iframe. The Atlas tab requires an existing signed-in session; when opened by itself
without a parent session it shows a sign-in instruction instead of a misleading empty
fact list.

## Local development

```bash
npm ci
cp .env.example .env.local
npm run dev
```

The parent app is expected on `http://localhost:3000` for local work. Atlas derives
the exact parent origin from the iframe referrer by default; set `VITE_PARENT_ORIGIN`
only when the parent suppresses that referrer. The production Atlas app is
`https://main.d1g1u8rtpgjn48.amplifyapp.com`; the parent Archive Lens app embeds that
origin and contains the Atlas iframe authentication bridge.

## Environment

| Variable | Purpose |
|---|---|
| `VITE_DATABASE_API_URL` | Existing BREATHE OCR/retrieval API base URL (`https://o0dqnexpsg.execute-api.ap-southeast-2.amazonaws.com/prod`). |
| `VITE_ATLAS_API_URL` | Atlas API Gateway base URL (`https://iz37e4zn02.execute-api.ap-southeast-2.amazonaws.com`). |
| `VITE_ATLAS_REGION` | Amazon Location region; default `ap-southeast-2`. |
| `VITE_ATLAS_MAP_NAME` | Amazon Location map resource name. |
| `VITE_ATLAS_MAP_API_KEY` | Browser map key. Restrict its allowed origin and map operations. |
| `VITE_PARENT_ORIGIN` | Optional exact Archive Lens origin override. |

Set these in Amplify's environment configuration for the relevant deployment branch.
Vite embeds `VITE_*` variables in public browser assets. Never place server secrets,
JWT signing secrets, or AWS credentials in frontend variables. The map API key is
public by design and must have strict Amazon Location key restrictions.
The map key and backend CORS allow the local origin and the deployed Atlas origin
`https://main.d1g1u8rtpgjn48.amplifyapp.com`. The geocoder Lambda uses an explicit
`ALLOWED_ORIGINS` list for those origins.

## Build

Use Node.js 22 for local production builds and Amplify. The app builds on older
Node versions in local checks, but a transitive MapLibre dependency declares Node 22
as its supported engine.

```bash
npm ci
npm run build
```

For Amplify, use `frontend` as the application root directory, `npm ci` as the install
command, and `npm run build` as the build command. Publish `frontend/dist` as the
artifact directory. If Amplify is configured at repository root, the equivalent
build settings are:

```yaml
version: 1
applications:
  - appRoot: frontend
    frontend:
      phases:
        preBuild:
          commands:
            - npm ci
        build:
          commands:
            - npm run build
      artifacts:
        baseDirectory: dist
        files:
          - '**/*'
      cache:
        paths:
          - node_modules/**/*
```

Keep the deployed Atlas hostname aligned with the Archive Lens iframe URL and API
Gateway CORS allowlist. HTTPS should be used for all deployed origins.
