import { NextResponse } from "next/server";

export const runtime = "nodejs";

type NominatimItem = {
  place_id: number;
  lat: string;
  lon: string;
  display_name: string;
  address?: Record<string, string>;
};

/** Proxy Nominatim — села/вулиці України (потрібен User-Agent) */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();

  if (!q || q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", q);
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "12");
  url.searchParams.set("countrycodes", "ua");
  url.searchParams.set("accept-language", "uk");

  try {
    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent": "AgroSystem/1.0 (agrosystem-local-dev)",
      },
      next: { revalidate: 0 },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Nominatim ${response.status}`, results: [] },
        { status: 502 }
      );
    }

    const data = (await response.json()) as NominatimItem[];
    const results = data.map((item) => ({
      id: `nom-${item.place_id}`,
      label: item.display_name,
      latitude: Number(item.lat),
      longitude: Number(item.lon),
    }));

    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Geocode failed",
        results: [],
      },
      { status: 500 }
    );
  }
}
