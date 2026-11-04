import { useEffect, useRef, useState } from 'react';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import Overlay from 'ol/Overlay.js';
import { defaults as defaultControls } from 'ol/control/defaults.js';
import { fromLonLat } from 'ol/proj.js';
import { apply } from 'ol-mapbox-style';
import 'ol/ol.css';

const region = import.meta.env.VITE_ATLAS_REGION || 'ap-southeast-2';
const mapName = import.meta.env.VITE_ATLAS_MAP_NAME || '';
const mapApiKey = import.meta.env.VITE_ATLAS_MAP_API_KEY || '';

function mapStyleUrl() {
  return `https://maps.geo.${region}.amazonaws.com/maps/v0/maps/${encodeURIComponent(mapName)}/style-descriptor`;
}

function withMapKey(url) {
  const requestUrl = new URL(url);
  if (requestUrl.hostname === `maps.geo.${region}.amazonaws.com`) {
    requestUrl.searchParams.set('key', mapApiKey);
  }
  return requestUrl.toString();
}

export default function AtlasMap({ places, selectedPlace, onSelectPlace }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const overlaysRef = useRef([]);
  const [mapError, setMapError] = useState('');
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current || !mapName || !mapApiKey) return undefined;
    let cancelled = false;
    const map = new Map({
      target: containerRef.current,
      layers: [],
      view: new View({
        center: fromLonLat([78.9629, 20.5937]),
        zoom: 4,
        minZoom: 2,
        maxZoom: 18,
      }),
      controls: defaultControls({ attribution: true, zoom: true, rotate: false }),
    });
    const resizeObserver = new ResizeObserver(() => map.updateSize());

    mapRef.current = map;
    setMapError('');
    setMapReady(false);
    resizeObserver.observe(containerRef.current);

    const styleUrl = withMapKey(mapStyleUrl());
    fetch(styleUrl)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Amazon Location style request failed (${response.status}). Check the map name and browser-key permissions.`);
        }
        return response.json();
      })
      .then((style) => apply(map, style, {
        styleUrl,
        transformRequest: (url) => withMapKey(url),
      }))
      .then(() => {
        if (!cancelled) {
          map.getAllLayers().forEach((layer) => {
            layer.getSource()?.on('tileloaderror', () => {
              if (!cancelled) {
                setMapError('Amazon Location could not load one or more map tiles. Check browser-key permissions, allowed origin, and network access.');
              }
            });
          });
          map.updateSize();
          setMapReady(true);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setMapError(error?.message || 'Amazon Location map style could not be loaded.');
        }
      });

    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      overlaysRef.current.forEach((overlay) => map.removeOverlay(overlay));
      overlaysRef.current = [];
      map.setTarget(undefined);
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    overlaysRef.current.forEach((overlay) => map.removeOverlay(overlay));
    overlaysRef.current = places.map((place) => {
      const markerElement = document.createElement('button');
      markerElement.className = `atlas-map-marker${selectedPlace?.key === place.key ? ' is-selected' : ''}`;
      markerElement.type = 'button';
      markerElement.setAttribute('aria-label', place.place_name);
      markerElement.title = place.place_name;
      markerElement.addEventListener('click', () => onSelectPlace(place));

      const overlay = new Overlay({
        element: markerElement,
        position: fromLonLat([place.longitude, place.latitude]),
        positioning: 'center-center',
        stopEvent: true,
      });
      map.addOverlay(overlay);
      return overlay;
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
      {mapError && <p className="atlas-map-error" role="alert">Map service: {mapError}</p>}
      {!places.length && (
        <div className="atlas-map-empty">Confirmed geotags will appear here as you review locations.</div>
      )}
    </div>
  );
}
