import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(
  path.join(root, "public/icons/levada-icon.source.svg"),
  "utf8"
);

function maskableSvg() {
  return source.replace("scale(13.5)", "scale(10)");
}

function renderPng(svg, size) {
  const resvg = new Resvg(Buffer.from(svg, "utf8"), {
    fitTo: { mode: "width", value: size },
    background: "#276749",
  });
  return resvg.render().asPng();
}

const outputs = [
  [180, path.join(root, "public/apple-touch-icon.png")],
  [180, path.join(root, "public/apple-touch-icon-precomposed.png")],
  [180, path.join(root, "public/apple-touch-icon-180x180.png")],
  [192, path.join(root, "public/icons/icon-192.png")],
  [512, path.join(root, "public/icons/icon-512.png")],
  [512, path.join(root, "public/icons/icon-maskable-512.png"), maskableSvg()],
];

for (const [size, file, svgOverride] of outputs) {
  const svg = svgOverride ?? source;
  fs.writeFileSync(file, renderPng(svg, size));
  console.log("wrote", file);
}
