const sharp = require("sharp");
const path = require("path");

const svg = path.join(__dirname, "icon.svg");
const sizes = [16, 48, 128];

(async () => {
  for (const size of sizes) {
    await sharp(svg)
      .resize(size, size)
      .png()
      .toFile(path.join(__dirname, `icon${size}.png`));
    console.log(`✓ icon${size}.png`);
  }
  console.log("Done.");
})();
