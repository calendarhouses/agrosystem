import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const sourceJpg = path.join(root, "public/icons/levadius-avatar.source.jpg");

if (!fs.existsSync(sourceJpg)) {
  console.error("Missing source:", sourceJpg);
  process.exit(1);
}

const py = `
from io import BytesIO
from pathlib import Path
import struct

from PIL import Image

root = Path(${JSON.stringify(root)})
src_rgb = Image.open(root / "public/icons/levadius-avatar.source.jpg").convert("RGB")
src_rgba = src_rgb.convert("RGBA")
bg = (9, 9, 11)

w, h = src_rgb.size
bottom = int(h * 0.92)
side = bottom
left = (w - side) // 2
avatar = src_rgb.crop((left, 0, left + side, bottom)).resize(
    (1024, 1024), Image.Resampling.LANCZOS
)
avatar.save(root / "public/icons/levadius-avatar.jpg", "JPEG", quality=92, optimize=True)

def cover_rgb(size):
    return src_rgb.resize((size, size), Image.Resampling.LANCZOS)

def cover_rgba(size):
    return src_rgba.resize((size, size), Image.Resampling.LANCZOS)

def maskable(size, scale=0.78):
    canvas = Image.new("RGB", (size, size), bg)
    inner = int(size * scale)
    face = src_rgb.resize((inner, inner), Image.Resampling.LANCZOS)
    off = (size - inner) // 2
    canvas.paste(face, (off, off))
    return canvas

outputs = [
    (180, "public/apple-touch-icon.png", False),
    (180, "public/apple-touch-icon-precomposed.png", False),
    (180, "public/apple-touch-icon-180x180.png", False),
    (192, "public/icons/icon-192.png", False),
    (512, "public/icons/icon-512.png", False),
    (512, "public/icons/icon-maskable-512.png", True),
    (192, "public/icons/levadius-192.png", False),
    (512, "public/icons/levadius-512.png", False),
    (180, "public/icons/levadius-apple-touch.png", False),
]

for size, rel, is_maskable in outputs:
    out = maskable(size) if is_maskable else cover_rgb(size)
    path = root / rel
    out.save(path, "PNG", optimize=True)
    print("wrote", path)

# Next.js / Turbopack: app/icon.png + favicon.ico with RGBA PNG frames
icon32 = cover_rgba(32)
icon32.save(root / "app/icon.png", "PNG", optimize=True)
print("wrote", root / "app/icon.png")

def png_rgba_bytes(im: Image.Image) -> bytes:
    buf = BytesIO()
    im.convert("RGBA").save(buf, format="PNG")
    data = buf.getvalue()
    # IHDR color type must be 6 (RGBA) for Next image pipeline
    if data[25] != 6:
        raise SystemExit(f"expected RGBA PNG, got color_type={data[25]}")
    return data

sizes = [16, 32, 48]
pngs = [(s, png_rgba_bytes(cover_rgba(s))) for s in sizes]
count = len(pngs)
header = struct.pack("<HHH", 0, 1, count)
entries = []
offset = 6 + 16 * count
blobs = b""
for s, data in pngs:
    w = 0 if s >= 256 else s
    h = 0 if s >= 256 else s
    entries.append(struct.pack("<BBBBHHII", w, h, 0, 0, 1, 32, len(data), offset))
    offset += len(data)
    blobs += data

ico_path = root / "app/favicon.ico"
ico_path.write_bytes(header + b"".join(entries) + blobs)
print("wrote", ico_path)
`;

const result = spawnSync("python3", ["-c", py], { encoding: "utf8" });
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.status !== 0) process.exit(result.status ?? 1);
