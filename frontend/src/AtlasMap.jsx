import { useEffect, useRef, useState } from 'react';

const region = import.meta.env.VITE_ATLAS_REGION || 'ap-southeast-2';
const mapName = import.meta.env.VITE_ATLAS_MAP_NAME || '';
const mapApiKey = import.meta.env.VITE_ATLAS_MAP_API_KEY || '';

function mapStyleUrl() {
  return `https://maps.geo.${region}.amazonaws.com/maps/v0/maps/${encodeURIComponent(mapName)}/style-descriptor`;
}

export default function AtlasMap({ places, selectedPlace, onSelectPlace }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const [mapError, setMapError] = useState('');
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current || !mapName || !mapApiKey) return undefined;
    let cancelled = false;
    let map;
    Promise.all([
      import('maplibre-gl'),
      import('maplibre-gl/dist/maplibre-gl.css'),
    ]).then(([{ default: maplibregl }]) => {
      if (cancelled || !containerRef.current) return;
      map = new maplibregl.Map({
        container: containerRef.current,
        style: mapStyleUrl(),
        center: [78.9629, 20.5937],
        zoom: 4,
        attributionControl: true,
        transformRequest: (url) => {
          if (!url.startsWith(`https://maps.geo.${region}.amazonaws.com/`)) {
            return { url };
          }
          const requestUrl = new URL(url);
          requestUrl.searchParams.set('key', mapApiKey);
          return { url: requestUrl.toString() };
        },
      });
      map.addControl(new maplibregl.NavigationControl(), 'top-right');
      map.on('error', () => {
        setMapError('Map tiles could not be loaded. Check the configured map name and restricted API key.');
      });
      mapRef.current = map;
      setMapReady(true);
    }).catch(() => {
      if (!cancelled) setMapError('The map viewer could not be loaded.');
    });
    return () => {
      cancelled = true;
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = places.map((place) => {
      const markerElement = document.createElement('button');
      markerElement.className = `atlas-map-marker${selectedPlace?.key === place.key ? ' is-selected' : ''}`;
      markerElement.type = 'button';
      markerElement.setAttribute('aria-label', place.place_name);
      markerElement.title = place.place_name;
      markerElement.addEventListener('click', () => onSelectPlace(place));
      return new maplibregl.Marker({ element: markerElement })
        .setLngLat([place.longitude, place.latitude])
        .addTo(map);
    });
  }, [mapReady, places, selectedPlace, onSelectPlace]);

  if (!mapName || !mapApiKey) {
    return (
      <div className="atlas-map-placeholder">
        <div className="map-placeholder-grid" aria-hidden="true" />
        <div className="map-placeholder-message">
          <span className="section-kicker">Map configuration needed</span>
          <h3>Atlas map is ready for its AWS map resources</h3>
          <p>Set the Amazon Location map name and restricted map API key to load the map. No key is required for this app shell.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="atlas-map-wrap">
      <div className="atlas-map" ref={containerRef} />
      {mapError && <p className="atlas-map-error" role="status">Map service: {mapError}</p>}
      {!places.length && (
        <div className="atlas-map-empty">Confirmed geotags will appear here as you review locations.</div>
      )}
    </div>
  );
}
