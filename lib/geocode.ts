/** Пошук місць в Україні: Photon + Nominatim (села, вулиці, адреси) */

export type GeoSearchResult = {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
};

/** Парсинг «50.45, 30.52» / «50.45 30.52» / «50.45;30.52» */
export function parseCoordinates(
  input: string
): { latitude: number; longitude: number } | null {
  const cleaned = input.trim().replace(/;/g, ",").replace(/\s+/g, " ");
  const match = cleaned.match(
    /^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/
  );
  if (!match) return null;

  const a = Number(match[1]);
  const b = Number(match[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

  if (Math.abs(a) <= 90 && Math.abs(b) <= 180) {
    return { latitude: a, longitude: b };
  }
  if (Math.abs(b) <= 90 && Math.abs(a) <= 180) {
    return { latitude: b, longitude: a };
  }
  return null;
}

type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    osm_id?: number | string;
    name?: string;
    street?: string;
    housenumber?: string;
    city?: string;
    town?: string;
    village?: string;
    hamlet?: string;
    county?: string;
    state?: string;
    district?: string;
    countrycode?: string;
    type?: string;
    osm_key?: string;
    osm_value?: string;
  };
};

function formatPhotonLabel(props: PhotonFeature["properties"]): string {
  if (!props) return "Місце";
  const parts: string[] = [];

  if (props.housenumber && props.street) {
    parts.push(`${props.street}, ${props.housenumber}`);
  } else if (props.street) {
    parts.push(props.street);
  } else if (props.name) {
    parts.push(props.name);
  }

  const settlement =
    props.city || props.town || props.village || props.hamlet || props.district;
  if (settlement && !parts.includes(settlement)) parts.push(settlement);
  if (props.county && !parts.includes(props.county)) parts.push(props.county);
  if (props.state && !parts.includes(props.state)) parts.push(props.state);

  return parts.filter(Boolean).join(", ") || props.name || "Місце в Україні";
}

/** Photon (Komoot) — добре для сіл і вулиць, без ключа */
async function searchPhoton(
  query: string,
  signal?: AbortSignal
): Promise<GeoSearchResult[]> {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", query);
  url.searchParams.set("lang", "uk");
  url.searchParams.set("limit", "12");
  // bbox України: minLon,minLat,maxLon,maxLat
  url.searchParams.set("bbox", "22.0,44.18,40.23,52.38");
  url.searchParams.set("lat", "49.0");
  url.searchParams.set("lon", "31.5");

  const response = await fetch(url.toString(), {
    signal,
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Photon HTTP ${response.status}`);

  const data = (await response.json()) as { features?: PhotonFeature[] };
  const results: GeoSearchResult[] = [];

  for (const feature of data.features ?? []) {
    const coords = feature.geometry?.coordinates;
    const props = feature.properties;
    if (!coords || !props) continue;

    const cc = (props.countrycode || "").toUpperCase();
    if (cc && cc !== "UA") continue;

    const [longitude, latitude] = coords;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;

    results.push({
      id: `photon-${props.osm_id ?? `${latitude}-${longitude}`}`,
      label: formatPhotonLabel(props),
      latitude,
      longitude,
    });
  }

  return results;
}

/** Nominatim через наш API (User-Agent + countrycodes=ua) */
async function searchNominatim(
  query: string,
  signal?: AbortSignal
): Promise<GeoSearchResult[]> {
  const response = await fetch(
    `/api/geocode?q=${encodeURIComponent(query)}`,
    { signal, cache: "no-store" }
  );
  if (!response.ok) throw new Error(`Nominatim HTTP ${response.status}`);

  const data = (await response.json()) as { results?: GeoSearchResult[] };
  return data.results ?? [];
}

/** Пошук адреси / села / вулиці в Україні */
export async function searchPlaces(
  query: string,
  signal?: AbortSignal
): Promise<GeoSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const coords = parseCoordinates(trimmed);
  if (coords) {
    return [
      {
        id: `coords-${coords.latitude}-${coords.longitude}`,
        label: `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`,
        latitude: coords.latitude,
        longitude: coords.longitude,
      },
    ];
  }

  try {
    const photon = await searchPhoton(trimmed, signal);
    if (photon.length > 0) return photon;
  } catch {
    // fallback нижче
  }

  return searchNominatim(trimmed, signal);
}
