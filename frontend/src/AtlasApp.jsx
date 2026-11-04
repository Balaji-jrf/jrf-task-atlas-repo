import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AtlasMap from './AtlasMap.jsx';
import { fetchAtlasFacts, fetchDocumentLink, geocodePlace, saveRecordGeotags } from './api.js';
import { FACTS_PER_PAGE, filterFactsByCategory, paginate } from './browseFilters.js';
import { confirmedPlaces, placeCandidates } from './locationData.js';

function getParentOrigin() {
  const configuredOrigin = import.meta.env.VITE_PARENT_ORIGIN;
  if (configuredOrigin) return configuredOrigin;
  try {
    return document.referrer ? new URL(document.referrer).origin : '';
  } catch {
    return '';
  }
}

const PARENT_ORIGIN = getParentOrigin();
const PARENT_APP_URL = PARENT_ORIGIN
  || (window.location.hostname === 'localhost' ? 'http://localhost:3000' : '');

function factSummary(fact) {
  return fact.extracted_fact || fact.source_excerpt || fact.source_text_chunk || 'No fact text available.';
}

function locationQuery(candidate) {
  return [candidate.name, candidate.context, 'India'].filter(Boolean).join(', ');
}

export default function AtlasApp() {
  const iframeRef = useRef(null);
  const resizeRef = useRef(null);
  const isEmbedded = window.parent !== window;
  const [token, setToken] = useState('');
  const [username, setUsername] = useState('');
  const [facts, setFacts] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [failures, setFailures] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [selectedFact, setSelectedFact] = useState(null);
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [browseMode, setBrowseMode] = useState('facts');
  const [documentCategory, setDocumentCategory] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [matches, setMatches] = useState([]);
  const [geocoding, setGeocoding] = useState(false);
  const [documentUrl, setDocumentUrl] = useState('');
  const [query, setQuery] = useState('');
  const [leftWidth, setLeftWidth] = useState(310);
  const [rightWidth, setRightWidth] = useState(360);

  useEffect(() => {
    if (window.parent === window || !PARENT_ORIGIN) return undefined;
    const receiveAuth = (event) => {
      if (
        event.origin !== PARENT_ORIGIN
        || event.source !== window.parent
        || event.data?.type !== 'BREATHE_ATLAS_AUTH'
        || typeof event.data.token !== 'string'
      ) return;
      setToken(event.data.token);
      setUsername(event.data.username || '');
    };
    window.addEventListener('message', receiveAuth);
    window.parent.postMessage({ type: 'BREATHE_ATLAS_READY' }, PARENT_ORIGIN);
    return () => window.removeEventListener('message', receiveAuth);
  }, []);

  const loadFacts = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const result = await fetchAtlasFacts(token);
      setDocuments(result.documents);
      setFacts(result.facts);
      setFailures(result.failures);
      setSelectedPlace(null);
      setCurrentPage(1);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadFacts();
  }, [loadFacts]);

  const categoryFacts = useMemo(
    () => filterFactsByCategory(facts, documentCategory),
    [facts, documentCategory],
  );
  const places = useMemo(() => confirmedPlaces(categoryFacts), [categoryFacts]);
  const visiblePlaces = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return places;
    return places.filter((place) => (
      place.place_name.toLowerCase().includes(search)
      || place.facts.some((fact) => factSummary(fact).toLowerCase().includes(search))
    ));
  }, [places, query]);
  const visibleFacts = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return categoryFacts;
    return categoryFacts.filter((fact) => (
      factSummary(fact).toLowerCase().includes(search)
      || (fact.filename || fact.document_id || '').toLowerCase().includes(search)
      || (fact.theme || '').toLowerCase().includes(search)
    ));
  }, [categoryFacts, query]);
  const visibleItems = browseMode === 'facts' ? visibleFacts : visiblePlaces;
  const page = useMemo(
    () => paginate(visibleItems, currentPage, FACTS_PER_PAGE),
    [visibleItems, currentPage],
  );
  const candidates = useMemo(
    () => selectedFact ? placeCandidates(selectedFact) : [],
    [selectedFact],
  );

  const resizePanels = (event) => {
    const drag = resizeRef.current;
    if (!drag) return;
    const delta = event.clientX - drag.startX;
    if (drag.side === 'left') setLeftWidth(Math.max(250, Math.min(500, drag.startWidth + delta)));
    else setRightWidth(Math.max(290, Math.min(560, drag.startWidth - delta)));
  };
  const stopResize = () => { resizeRef.current = null; };

  const chooseFact = (fact) => {
    setSelectedFact(fact);
    setSelectedCandidate(null);
    setMatches([]);
    setDocumentUrl('');
    setSelectedPlace(null);
  };

  const searchPlace = async (candidate) => {
    setSelectedCandidate(candidate);
    setMatches([]);
    setError('');
    setNotice('');
    setGeocoding(true);
    try {
      const response = await geocodePlace(locationQuery(candidate), candidate.type, token);
      setMatches(response.matches || []);
      if (!response.matches?.length) setNotice(`No coordinate matches found for ${candidate.name}.`);
    } catch (lookupError) {
      setError(lookupError.message);
    } finally {
      setGeocoding(false);
    }
  };

  const confirmMatch = async (match) => {
    if (!selectedFact || !selectedCandidate) return;
    const existingGeotags = Array.isArray(selectedFact.geotag) ? selectedFact.geotag : [];
    if (existingGeotags.some((item) => item.place_id === match.place_id)) {
      setNotice(`${selectedCandidate.name} is already linked to this fact.`);
      setMatches([]);
      return;
    }
    const geotag = [...existingGeotags, {
      place_name: selectedCandidate.name,
      place_type: selectedCandidate.type,
      label: match.label,
      latitude: match.latitude,
      longitude: match.longitude,
      provider: 'Amazon Location Service',
      place_id: match.place_id,
      relevance: match.relevance,
      status: 'confirmed',
      updated_at: new Date().toISOString(),
    }];
    setError('');
    setNotice('');
    try {
      await saveRecordGeotags(
        selectedFact.document_id,
        selectedFact.theme_entity_id,
        geotag,
        token,
      );
      const updatedFact = { ...selectedFact, geotag };
      setFacts((current) => current.map((fact) => (
        fact.document_id === updatedFact.document_id
        && fact.theme_entity_id === updatedFact.theme_entity_id ? updatedFact : fact
      )));
      setSelectedFact(updatedFact);
      setMatches([]);
      setNotice(`Confirmed ${selectedCandidate.name} and added it to the Atlas.`);
    } catch (saveError) {
      setError(saveError.message);
    }
  };

  const openSource = async () => {
    if (!selectedFact) return;
    setError('');
    try {
      const url = await fetchDocumentLink(selectedFact.document_id, token);
      if (!url) throw new Error('The source PDF link is unavailable.');
      setDocumentUrl(url);
    } catch (sourceError) {
      setError(sourceError.message);
    }
  };

  const openPlace = useCallback((place) => {
    setSelectedPlace(place);
    setSelectedFact(null);
    setMatches([]);
    setDocumentUrl('');
  }, []);

  if (!token) {
    return (
      <main className="atlas-auth-wait">
        <div className="atlas-brand">A</div>
        <p className="section-kicker">BREATHE · RESEARCH ATLAS</p>
        <h1>{isEmbedded ? 'Connecting to Archive Lens…' : 'Open Atlas from Archive Lens'}</h1>
        <p>
          {isEmbedded
            ? PARENT_ORIGIN
              ? 'Atlas is waiting for your signed-in session. If this message stays here, confirm Archive Lens is signed in and its Atlas app URL matches this page.'
              : 'Atlas is embedded, but VITE_PARENT_ORIGIN is not configured. Set it to the exact Archive Lens origin and restart the Atlas dev server.'
            : 'A signed-in Archive Lens session is required to load approved document facts. Start Archive Lens, sign in, and open the Atlas tab.'}
        </p>
        {PARENT_APP_URL && !isEmbedded && (
          <a className="atlas-source-link" href={PARENT_APP_URL}>Open Archive Lens</a>
        )}
        <p className="atlas-auth-note">Your token is passed through a verified parent-frame message, never in the URL.</p>
      </main>
    );
  }

  const resizeHandle = (side) => (
    <div
      className={`atlas-resize atlas-resize-${side}`}
      role="separator"
      tabIndex={0}
      aria-label={`Resize ${side === 'left' ? 'location list' : 'details'} panel`}
      aria-orientation="vertical"
      aria-valuemin={side === 'left' ? 250 : 290}
      aria-valuemax={side === 'left' ? 500 : 560}
      aria-valuenow={side === 'left' ? leftWidth : rightWidth}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const change = event.key === 'ArrowRight' ? 20 : -20;
        if (side === 'left') setLeftWidth((width) => Math.max(250, Math.min(500, width + change)));
        else setRightWidth((width) => Math.max(290, Math.min(560, width - change)));
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        resizeRef.current = {
          side,
          startX: event.clientX,
          startWidth: side === 'left' ? leftWidth : rightWidth,
        };
      }}
      onPointerMove={resizePanels}
      onPointerUp={stopResize}
      onPointerCancel={stopResize}
      onLostPointerCapture={stopResize}
    />
  );

  return (
    <main className="atlas-shell" style={{ '--atlas-left-width': `${leftWidth}px`, '--atlas-right-width': `${rightWidth}px` }}>
      <header className="atlas-header">
        <div className="atlas-brand">A</div>
        <div className="atlas-title">
          <p className="section-kicker">BREATHE · HISTORICAL PLACE DATA</p>
          <h1>Research Atlas</h1>
        </div>
        <div className="atlas-header-meta">
          <span>{username || 'Archive Lens session'}</span>
          <span className="atlas-approved"><i />Approved facts</span>
          <button type="button" className="atlas-refresh" onClick={loadFacts} disabled={loading}>
            {loading ? 'Loading…' : '↻ Refresh data'}
          </button>
        </div>
      </header>

      {error && <div className="atlas-banner atlas-error" role="alert">{error}</div>}
      {notice && <div className="atlas-banner" role="status">{notice}</div>}

      <section className="atlas-workspace">
        <aside className="atlas-panel atlas-place-panel">
          <div className="atlas-panel-heading">
            <div>
              <p className="section-kicker">Browse</p>
              <h2>{browseMode === 'facts' ? 'Approved facts' : 'Places'}</h2>
            </div>
            <span className="atlas-count">{visibleItems.length}</span>
          </div>
          <div className="atlas-browse-switch" role="group" aria-label="Browse facts or places">
            <button type="button" className={browseMode === 'facts' ? 'active' : ''} onClick={() => { setBrowseMode('facts'); setCurrentPage(1); }}>Facts</button>
            <button type="button" className={browseMode === 'places' ? 'active' : ''} onClick={() => { setBrowseMode('places'); setCurrentPage(1); }}>Places</button>
          </div>
          {browseMode === 'facts' && (
            <label className="atlas-filter-label">
              Document type
              <select
                className="atlas-filter"
                value={documentCategory}
                aria-label="Filter facts by document type"
                onChange={(event) => {
                  setDocumentCategory(event.target.value);
                  setCurrentPage(1);
                  setSelectedFact(null);
                  setSelectedPlace(null);
                  setSelectedCandidate(null);
                  setMatches([]);
                  setDocumentUrl('');
                }}
              >
                <option value="all">All documents ({facts.length})</option>
                <option value="historical">Historical documents ({filterFactsByCategory(facts, 'historical').length})</option>
                <option value="policy">Policy documents ({filterFactsByCategory(facts, 'policy').length})</option>
                <option value="other">Other ({filterFactsByCategory(facts, 'other').length})</option>
              </select>
            </label>
          )}
          <input
            className="atlas-search"
            type="search"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setCurrentPage(1); }}
            placeholder={browseMode === 'facts' ? 'Search facts or documents…' : 'Search places or facts…'}
            aria-label="Search places or facts"
          />
          <p className="atlas-panel-help">
            {browseMode === 'facts'
              ? 'Select an approved fact to review and map its locations.'
              : 'Confirmed locations from approved document facts.'}
          </p>
          <div className="atlas-place-list">
            {loading && <p className="atlas-empty">Loading approved facts…</p>}
            {!loading && browseMode === 'facts' && !visibleFacts.length && (
              <p className="atlas-empty">No approved facts found for this search.</p>
            )}
            {!loading && browseMode === 'facts' && page.items.map((fact) => (
              <button
                type="button"
                key={`${fact.document_id}:${fact.theme_entity_id}`}
                className={`atlas-place-item${selectedFact?.theme_entity_id === fact.theme_entity_id && selectedFact?.document_id === fact.document_id ? ' active' : ''}`}
                onClick={() => chooseFact(fact)}
              >
                <span className="atlas-place-pin">▤</span>
                <span className="atlas-place-item-copy">
                  <strong>{factSummary(fact)}</strong>
                  <small>{fact.filename || fact.document_id} · p.{fact.pdf_page_num || '—'}</small>
                </span>
              </button>
            ))}
            {!loading && browseMode === 'places' && !visiblePlaces.length && (
              <p className="atlas-empty">No confirmed locations yet. Select an approved fact in Facts to geocode and review its places.</p>
            )}
            {!loading && browseMode === 'places' && page.items.map((place) => (
              <button
                type="button"
                key={place.key}
                className={`atlas-place-item${selectedPlace?.key === place.key ? ' active' : ''}`}
                onClick={() => openPlace(place)}
              >
                <span className="atlas-place-pin">⌖</span>
                <span className="atlas-place-item-copy">
                  <strong>{place.place_name}</strong>
                  <small>{place.place_type || 'Place'} · {place.facts.length} fact{place.facts.length === 1 ? '' : 's'}</small>
                </span>
              </button>
            ))}
          </div>
          <nav className="atlas-pagination" aria-label={`${browseMode === 'facts' ? 'Facts' : 'Places'} pagination`}>
            <span>Showing {page.start}–{page.end} of {visibleItems.length}</span>
            <div>
              <button
                type="button"
                onClick={() => setCurrentPage((value) => Math.max(1, value - 1))}
                disabled={page.page <= 1 || loading}
                aria-label="Previous page"
              >
                Previous
              </button>
              <span>Page {page.page} of {page.pageCount}</span>
              <button
                type="button"
                onClick={() => setCurrentPage((value) => Math.min(page.pageCount, value + 1))}
                disabled={page.page >= page.pageCount || loading}
                aria-label="Next page"
              >
                Next
              </button>
            </div>
          </nav>
          <div className="atlas-layer-note">
            <span>Current layer</span><strong>Historical records</strong>
            <small>IMD, LST and satellite layers are planned extensions.</small>
          </div>
        </aside>

        {resizeHandle('left')}
        <section className="atlas-map-panel" aria-label="Map of confirmed historical places">
          <div className="atlas-map-toolbar">
            <span>India · Historical locations</span>
            <span>{places.length} mapped place{places.length === 1 ? '' : 's'}</span>
          </div>
          <AtlasMap places={places} selectedPlace={selectedPlace} onSelectPlace={openPlace} />
          <div className="atlas-map-legend"><i /> Confirmed historical place</div>
        </section>
        {resizeHandle('right')}

        <aside className="atlas-panel atlas-detail-panel">
          {selectedPlace ? (
            <>
              <div className="atlas-panel-heading">
                <div><p className="section-kicker">Mapped location</p><h2>{selectedPlace.place_name}</h2></div>
              </div>
              <p className="atlas-coordinate">{selectedPlace.latitude.toFixed(5)}, {selectedPlace.longitude.toFixed(5)}</p>
              <p className="atlas-provider">Amazon Location Service · confirmed after review</p>
              <h3 className="atlas-section-title">Related facts</h3>
              <div className="atlas-fact-list">
                {selectedPlace.facts.map((fact) => (
                  <article className="atlas-fact-card" key={`${fact.document_id}:${fact.theme_entity_id}`}>
                    <p>{factSummary(fact)}</p>
                    <button type="button" onClick={() => chooseFact(fact)}>
                      {fact.filename || fact.document_id} · p.{fact.pdf_page_num || '—'} ↗
                    </button>
                  </article>
                ))}
              </div>
            </>
          ) : selectedFact ? (
            <>
              <div className="atlas-panel-heading">
                <div><p className="section-kicker">Approved fact · p.{selectedFact.pdf_page_num || '—'}</p><h2>Place review</h2></div>
              </div>
              <p className="atlas-selected-fact">{factSummary(selectedFact)}</p>
              <p className="atlas-source-name">{selectedFact.filename || selectedFact.document_id}</p>
              <div className="atlas-source-actions">
                <button className="atlas-source-link" type="button" onClick={openSource}>Load source PDF</button>
                {documentUrl && (
                  <button className="atlas-source-link atlas-source-close" type="button" onClick={() => setDocumentUrl('')}>Close viewer</button>
                )}
              </div>
              {documentUrl && (
                <div className="atlas-source-viewer">
                  <div className="atlas-source-viewer-header">
                    <span>Source document · p.{selectedFact.pdf_page_num || 1}</span>
                    <button type="button" className="atlas-viewer-close" onClick={() => setDocumentUrl('')} aria-label="Close PDF viewer">✕</button>
                  </div>
                  <iframe
                    title={`Source PDF for ${selectedFact.filename || selectedFact.document_id}`}
                    src={documentUrl}
                    className="atlas-source-frame"
                    loading="lazy"
                  />
                </div>
              )}
              <h3 className="atlas-section-title">Places in this fact</h3>
              {!candidates.length && <p className="atlas-empty">This fact has no structured place values to geocode yet.</p>}
              {candidates.map((candidate) => (
                <div className="atlas-candidate" key={`${candidate.type}:${candidate.name}`}>
                  <span><strong>{candidate.name}</strong><small>{candidate.type}{candidate.context ? ` · ${candidate.context}` : ''}</small></span>
                  <button type="button" disabled={geocoding} onClick={() => searchPlace(candidate)}>
                    {geocoding && selectedCandidate?.name === candidate.name ? 'Searching…' : 'Find match'}
                  </button>
                </div>
              ))}
              {matches.map((match, index) => (
                <article className="atlas-match-card" key={match.place_id || `${match.label}:${index}`}>
                  <strong>{match.label}</strong>
                  <small>{match.latitude.toFixed(5)}, {match.longitude.toFixed(5)} · match {Math.round(match.relevance * 100)}%</small>
                  <button type="button" onClick={() => confirmMatch(match)}>Review &amp; add to map</button>
                </article>
              ))}
            </>
          ) : (
            <div className="atlas-detail-empty">
              <span className="atlas-detail-icon">⌖</span>
              <p className="section-kicker">Location details</p>
              <h2>Select a place or fact</h2>
              <p>Choose a mapped place to see its source facts, or review an approved fact and geocode its locations.</p>
            </div>
          )}
          {failures.length > 0 && (
            <details className="atlas-warning">
              <summary>{failures.length} document record list(s) could not be loaded</summary>
              <ul>
                {failures.map((failure) => (
                  <li key={failure.document_id}>{failure.document_id}: {failure.error}</li>
                ))}
              </ul>
            </details>
          )}
          <div className="atlas-source-legend"><strong>{documents.length}</strong> documents checked · approved facts only</div>
        </aside>
      </section>
    </main>
  );
}
