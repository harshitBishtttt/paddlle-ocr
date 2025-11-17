const express = require('express');
const multer = require('multer');
const { createWorker } = require('tesseract.js');
const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;  // <-- Azure compatible

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads';
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }
});

// Simple OCR scan (images only)
async function performOCR(imagePath) {
  const worker = await createWorker('eng');
  const { data } = await worker.recognize(imagePath);

  const results = data.words.map(word => ({
    text: word.text,
    confidence: word.confidence,
    bbox: word.bbox
  }));

  await worker.terminate();
  return results;
}

// Highlight image
async function generateHighlightedImage(imagePath, ocrResults, outputPath) {
  const image = await loadImage(imagePath);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');

  ctx.drawImage(image, 0, 0);

  ocrResults.forEach(word => {
    const { x0, y0, x1, y1 } = word.bbox;

    ctx.strokeStyle = "lime";
    ctx.lineWidth = 2;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);

    ctx.fillStyle = "rgba(0,255,0,0.15)";
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  });

  fs.writeFileSync(outputPath, canvas.toBuffer("image/png"));
  return outputPath;
}

// API endpoint
app.post("/api/ocr", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  try {
    const filePath = req.file.path;

    const ocrResults = await performOCR(filePath);

    const outputPath = path.join(
      "uploads",
      "highlighted-" + Date.now() + ".png"
    );

    await generateHighlightedImage(filePath, ocrResults, outputPath);

    fs.unlinkSync(filePath); // cleanup original image

    res.json({
      success: true,
      totalWords: ocrResults.length,
      results: ocrResults,
      highlightedImage: `/uploads/${path.basename(outputPath)}`
    });
  } catch (e) {
    console.error("OCR Error:", e);
    res.status(500).json({ error: "OCR failed", details: e.message });
  }
});

// Serve image files
app.use("/uploads", express.static("uploads"));

app.listen(PORT, () =>
  console.log(`✔ OCR Backend running at http://localhost:${PORT}`)
);
