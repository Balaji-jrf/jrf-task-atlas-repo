# Archive Lens iframe integration

The Atlas app is hosted separately. Archive Lens must embed its URL and send its
already-authenticated session to the iframe only after a same-origin readiness
handshake.

1. Copy `AtlasTab.js` into the Archive Lens `src/components/` directory.
2. Pass the current auth result to it:

   ```jsx
   <AtlasTab auth={auth} />
   ```

3. Configure `REACT_APP_ATLAS_APP_URL` to the Atlas HTTPS URL (for local development,
   `http://localhost:5173`).
4. Ensure the parent tab's permission gate checks `atlas`.
5. Give the iframe enough viewport height; a minimal style is:

   ```css
   .atlas-app-frame {
     display: block;
     flex: 1;
     width: 100%;
     min-height: 0;
     border: 0;
     background: #f5f4ee;
   }
   ```

The included component checks both `event.origin` and `event.source` before sending
the token. It sends the token in the message body, not the iframe URL. The Atlas app
derives its exact parent origin from the iframe referrer unless `VITE_PARENT_ORIGIN`
is explicitly set. Keep both origins HTTPS in production.

The parent app is a separate project and must be deployed through its own repository
and pipeline; publishing this Atlas repository alone does not update Archive Lens.
