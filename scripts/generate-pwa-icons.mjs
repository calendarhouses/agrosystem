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
from PIL import Image
from pathlib import Path

root = Path(${JSON.stringify(root)})
src = Image.open(root / "public/icons/levadius-avatar.source.jpg").convert("RGB")
bg = (9, 9, 11)

w, h = src.size
bottom = int(h * 0.92)
side = bottom
left = (w - side) // 2
avatar = src.crop((left, 0, left + side, bottom)).resize((1024, 1024), Image.Resampling.LANCZOS)
avatar.save(root / "public/icons/levadius-avatar.jpg", "JPEG", quality=92, optimize=True)

def cover(size):
    return src.resize((size, size), Image.Resampling.LANCZOS)

def maskable(size, scale=0.78):
    canvas = Image.new("RGB", (size, size), bg)
    inner = int(size * scale)
    face = src.resize((inner, inner), Image.Resampling.LANCZOS)
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
    out = maskable(size) if is_maskable else cover(size)
    path = root / rel
    out.save(path, "PNG", optimize=True)
    print("wrote", path)

ico = [cover(s) for s in (16, 32, 48)]
ico[0].save(
    root / "app/favicon.ico",
    format="ICO",
    sizes=[(16, 16), (32, 32), (48, 48)],
    append_images=ico[1:],
)
print("wrote", root / "app/favicon.ico")
`;

const result = spawnSync("python3", ["-c", py], { encoding: "utf8" });
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.status !== 0) process.exit(result.status ?? 1);
