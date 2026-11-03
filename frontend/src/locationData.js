const LOCATION_FIELDS = ['village', 'town', 'taluk', 'district', 'state', 'country'];

function locationNames(value) {
  if (Array.isArray(value)) return value.flatMap(locationNames);
  if (typeof value !== 'string') return [];
  return value.split(/[;\n]/).map((name) => name.trim()).filter(Boolean);
}

export function placeCandidates(record) {
  const spatial = record.spatial_units || {};
  const district = locationNames(spatial.district)[0] || '';
  return LOCATION_FIELDS.flatMap((field) => locationNames(spatial[field]).map((name) => ({
    name,
    type: field,
    context: field === 'district' ? '' : district,
  })));
}

export function confirmedPlaces(records) {
  const places = new Map();
  for (const record of records) {
    for (const geotag of Array.isArray(record.geotag) ? record.geotag : []) {
      const latitude = Number(geotag.latitude);
      const longitude = Number(geotag.longitude);
      if (
        geotag.status !== 'confirmed'
        || !Number.isFinite(latitude)
        || !Number.isFinite(longitude)
      ) continue;

      const key = geotag.place_id || `${geotag.place_name}:${latitude}:${longitude}`;
      const place = places.get(key) || {
        ...geotag,
        key,
        latitude,
        longitude,
        facts: [],
      };
      place.facts.push(record);
      places.set(key, place);
    }
  }
  return [...places.values()];
}
