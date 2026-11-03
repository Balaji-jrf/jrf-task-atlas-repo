const DATABASE_API = (import.meta.env.VITE_DATABASE_API_URL || '').replace(/\/$/, '');
const ATLAS_API = (import.meta.env.VITE_ATLAS_API_URL || '').replace(/\/$/, '');

async function request(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.detail || data.message || `Request failed (${response.status})`);
  }
  return data;
}

async function fetchRecords(documentId, token) {
  const records = [];
  let cursor = '';
  do {
    const params = new URLSearchParams({ status: 'approved', limit: '100' });
    if (cursor) params.set('cursor', cursor);
    const data = await request(
      `${DATABASE_API}/api/documents/${encodeURIComponent(documentId)}/records?${params}`,
      token,
    );
    records.push(...(data.records || []));
    cursor = data.next_token || '';
  } while (cursor);
  return records;
}

export async function fetchAtlasFacts(token) {
  if (!DATABASE_API) throw new Error('VITE_DATABASE_API_URL is not configured.');
  const response = await request(`${DATABASE_API}/documents`, token);
  const documents = response.documents || [];
  const facts = [];
  const failures = [];
  const queue = documents
    .filter((document) => document.status === 'completed')
    .map((document) => async () => {
      try {
        facts.push(...await fetchRecords(document.document_id, token));
      } catch (error) {
        failures.push({ document_id: document.document_id, error: error.message });
      }
    });

  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length) await queue.shift()();
  }));
  return { documents, facts, failures };
}

export async function fetchDocumentLink(documentId, token) {
  const data = await request(
    `${DATABASE_API}/document/${encodeURIComponent(documentId)}`,
    token,
  );
  return data.s3_presigned_url || '';
}

export async function geocodePlace(placeName, placeType, token) {
  if (!ATLAS_API) throw new Error('Atlas geocoding API is not configured yet.');
  return request(`${ATLAS_API}/api/atlas/geocode`, token, {
    method: 'POST',
    body: JSON.stringify({ place_name: placeName, place_type: placeType }),
  });
}

export async function saveRecordGeotags(documentId, recordId, geotag, token) {
  return request(
    `${DATABASE_API}/api/documents/${encodeURIComponent(documentId)}/records/${encodeURIComponent(recordId)}`,
    token,
    {
      method: 'PUT',
      body: JSON.stringify({ attributes: { geotag } }),
    },
  );
}
