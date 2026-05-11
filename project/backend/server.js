require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = 3000;
const API_KEY = process.env.API_KEY;
if (!API_KEY) {
  console.error("❌ Missing Gemini API KEY in .env");
  process.exit(1);
}

app.use(cors());
app.use(express.json({
  limit: "50mb"
}));

const FRONTEND_DIR = path.join(__dirname, "../frontend");
const ANNOTATE_DIR = path.join(__dirname, "../annotate");
const DATASET_PATH = path.join(
  ANNOTATE_DIR,
  "dataset.json"
);
const IMAGES_DIR = path.join(
  ANNOTATE_DIR,
  "images"
);

console.log("=================================");
console.log("FRONTEND_DIR :", FRONTEND_DIR);
console.log("ANNOTATE_DIR :", ANNOTATE_DIR);
console.log("DATASET_PATH :", DATASET_PATH);
console.log("IMAGES_DIR   :", IMAGES_DIR);
console.log("=================================");

app.use(express.static(FRONTEND_DIR));
app.use(
  "/images",
  express.static(IMAGES_DIR)
);

app.get("/", (req, res) => {
  res.sendFile(
    path.join(FRONTEND_DIR, "index.html")
  );
});

app.get("/dataset", (req, res) => {
  try {
    if (!fs.existsSync(DATASET_PATH)) {
      return res.status(404).json({
        error: "dataset.json not found"
      });
    }
    const raw = fs.readFileSync(
      DATASET_PATH,
      "utf8"
    );
    const data = JSON.parse(raw);
    console.log(
      "✅ Dataset served:",
      data.length,
      "entries"
    );
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err.message
    });
  }
});

app.get("/debug", (req, res) => {
  try {
    let imageFiles = [];
    if (fs.existsSync(IMAGES_DIR)) {
      imageFiles = fs.readdirSync(IMAGES_DIR);
    }
    let dataset = [];
    if (fs.existsSync(DATASET_PATH)) {
      dataset = JSON.parse(
        fs.readFileSync(DATASET_PATH, "utf8")
      );
    }
    res.json({
      backend_dir: __dirname,
      frontend_dir: FRONTEND_DIR,
      annotate_dir: ANNOTATE_DIR,
      images_exists: fs.existsSync(IMAGES_DIR),
      dataset_exists: fs.existsSync(DATASET_PATH),
      total_images: imageFiles.length,
      first_10_images: imageFiles.slice(0, 10),
      dataset_entries: dataset.slice(0, 5)
    });
  } catch (err) {

    res.json({
      error: err.message
    });
  }
});


app.post("/evaluate", async (req, res) => {
  try {
    const { question, image } = req.body;
    console.log("=================================");
    console.log("📥 EVALUATION REQUEST");
    console.log("Question:", question);
    console.log("Image received:", !!image);
    console.log("=================================");

    if (!question || !image) {
      return res.status(400).json({
        predicted: "Missing image or question"
      });
    }
    const base64Image = image.split(",")[1];
    if (!base64Image) {
      return res.status(400).json({
        predicted: "Invalid image format"
      });
    }
    const mimeType =
      image.includes("png")
        ? "image/png"
        : "image/jpeg";
    const requestBody = {
      contents: [
        {
          parts: [
            {
              text:
`You are a visual reasoning AI.
Answer the question in ONE SHORT SENTENCE only.
Do NOT explain.
Do NOT provide reasoning.
Do NOT add extra information.
Question:
${question}`
            },
            {
              inline_data: {
                mime_type: mimeType,
                data: base64Image
              }
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 80
      }
    };

    // CALL GEMINI API
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent?key=${API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
      }
    );
    console.log("Gemini HTTP Status:", response.status);
    const data = await response.json();
    console.log(
      "Gemini Raw Response:",
      JSON.stringify(data, null, 2)
    );

    // HANDLE QUOTA ERRORS
    if (data.error?.code === 429) {
      return res.status(429).json({
        predicted: "Gemini quota exceeded"
      });
    }

    // HANDLE OTHER ERRORS
    if (data.error) {
      console.error("Gemini Error:", data.error);
      return res.status(500).json({
        predicted:
          "Gemini Error: " +
          data.error.message
      });
    }
    let predicted = "No response";
    try {
      predicted =
        data.candidates[0]
          .content.parts
          .map(p => p.text || "")
          .join(" ")
          .trim();
    } catch {
      predicted = "No valid response";
    }
    console.log("=================================");
    console.log("✅ FINAL PREDICTION");
    console.log(predicted);
    console.log("=================================");
    res.json({
      predicted
    });
  } catch (err) {
    console.error("❌ SERVER ERROR");
    console.error(err);
    res.status(500).json({
      predicted:
        "Server crashed: " +
        err.message
    });
  }
});

app.listen(PORT, () => {
  console.log("=================================");
  console.log("✅ WEBVQA Backend Running");
  console.log(`http://localhost:${PORT}`);
  console.log(`http://localhost:${PORT}/debug`);
  console.log("=================================");

});