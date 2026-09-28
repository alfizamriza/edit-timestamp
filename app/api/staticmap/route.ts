import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";

export const runtime = "nodejs";

const TILE_SIZE = 256;
// OSM tile usage policy meminta User-Agent yang jelas + pemakaian wajar (bukan skala tinggi).
const USER_AGENT = "stempel-waktu-app/1.0 (+https://example.com/contact)";

function lonToTileX(lon: number, zoom: number) {
  return ((lon + 180) / 360) * 2 ** zoom;
}
function latToTileY(lat: number, zoom: number) {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** zoom;
}

async function fetchTile(z: number, x: number, y: number): Promise<Buffer | null> {
  const n = 2 ** z;
  if (y < 0 || y >= n) return null;
  const xw = ((x % n) + n) % n;
  try {
    const res = await fetch(`https://tile.openstreetmap.org/${z}/${xw}/${y}.png`, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lat = parseFloat(searchParams.get("lat") || "");
  const lng = parseFloat(searchParams.get("lng") || "");
  const zoom = Math.min(19, Math.max(2, parseInt(searchParams.get("zoom") || "16", 10)));
  const size = Math.min(500, Math.max(80, parseInt(searchParams.get("size") || "220", 10)));

  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return NextResponse.json({ error: "lat/lng wajib diisi" }, { status: 400 });
  }

  const centerXf = lonToTileX(lng, zoom);
  const centerYf = latToTileY(lat, zoom);
  const centerTileX = Math.floor(centerXf);
  const centerTileY = Math.floor(centerYf);
  const offsetPxX = (centerXf - centerTileX) * TILE_SIZE;
  const offsetPxY = (centerYf - centerTileY) * TILE_SIZE;

  const half = Math.ceil(size / TILE_SIZE / 2) + 1;
  const composites: sharp.OverlayOptions[] = [];
  for (let dx = -half; dx <= half; dx++) {
    for (let dy = -half; dy <= half; dy++) {
      const buf = await fetchTile(zoom, centerTileX + dx, centerTileY + dy);
      if (!buf) continue;
      composites.push({ input: buf, left: (dx + half) * TILE_SIZE, top: (dy + half) * TILE_SIZE });
    }
  }

  const fullSize = (half * 2 + 1) * TILE_SIZE;
  const stitched = sharp({
    create: { width: fullSize, height: fullSize, channels: 4, background: { r: 225, g: 225, b: 220, alpha: 1 } },
  }).composite(composites);

  const centerPx = half * TILE_SIZE + offsetPxX;
  const centerPy = half * TILE_SIZE + offsetPxY;
  const left = Math.max(0, Math.min(fullSize - size, Math.round(centerPx - size / 2)));
  const top = Math.max(0, Math.min(fullSize - size, Math.round(centerPy - size / 2)));

  const pinSvg = Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${size / 2}" cy="${size / 2}" r="8" fill="#e2604f" stroke="#ffffff" stroke-width="3"/>
    </svg>`
  );

  const png = await stitched
    .extract({ left, top, width: size, height: size })
    .composite([{ input: pinSvg, left: 0, top: 0 }])
    .png()
    .toBuffer();

  return new NextResponse(png, {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600" },
  });
}