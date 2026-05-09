require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

/* ============================================================
   GEMINI API KEY
============================================================ */
const API_KEY = process.env.API_KEY;

/* ============================================================
   PATHS
   server.js lives at: C:\Users\ASUS\Desktop\project\server.js
============================================================ */
const FRONTEND_DIR = path.join(__dirname, "../frontend");
const ANNOTATE_DIR = path.join(__dirname, "../annotate");
const DATASET_PATH = path.join(ANNOTATE_DIR, "dataset.json");
const IMAGES_DIR   = path.join(ANNOTATE_DIR, "images");

/* ============================================================
   SERVE STATIC FILES
   - frontend/  → serves index.html, script.js, style.css
   - annotate/images/ → serves images directly at /images/...
============================================================ */
app.use(express.static(FRONTEND_DIR));
app.use("/images", express.static(IMAGES_DIR));

/* ============================================================
   ROOT ROUTE
============================================================ */
app.get("/", (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, "index.html"));
});

/* ============================================================
   DATASET ROUTE
   GET /dataset  →  returns parsed dataset.json array
============================================================ */
app.get("/dataset", (req, res) => {
  if (!fs.existsSync(DATASET_PATH)) {
    console.error("dataset.json NOT FOUND at:", DATASET_PATH);
    return res.status(404).json({ error: "dataset.json not found at " + DATASET_PATH });
  }
  try {
    const data = JSON.parse(fs.readFileSync(DATASET_PATH, "utf8"));
    console.log("Serving dataset:", data.length, "entries");
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: "Failed to parse dataset.json: " + e.message });
  }
});

/* ============================================================
   DEBUG ROUTE
   GET /debug  →  shows actual filenames in annotate/images/
   Open http://localhost:3000/debug in browser to verify
============================================================ */
app.get("/debug", (req, res) => {
  let imageFiles = [];
  let datasetEntries = [];

  // Read actual image files from disk
  if (fs.existsSync(IMAGES_DIR)) {
    imageFiles = fs.readdirSync(IMAGES_DIR);
  } else {
    imageFiles = ["ERROR: images folder not found at " + IMAGES_DIR];
  }

  // Read dataset source_file values
  if (fs.existsSync(DATASET_PATH)) {
    const data = JSON.parse(fs.readFileSync(DATASET_PATH, "utf8"));
    datasetEntries = data.slice(0, 10).map(d => ({
      image_id: d.image_id,
      source_file: d.source_file,
      extracted_name: d.source_file.replace(/\\/g, "/").split("/").pop()
    }));
  }

  res.json({
    server_cwd: __dirname,
    images_dir: IMAGES_DIR,
    images_dir_exists: fs.existsSync(IMAGES_DIR),
    actual_image_files: imageFiles.slice(0, 20),
    total_images: imageFiles.length,
    dataset_first_10_entries: datasetEntries
  });
});

/* ============================================================
   AI EVALUATION ROUTE
============================================================ */
app.post("/evaluate", async (req, res) => {
  try {
    const { question, image } = req.body;

    console.log("=================================");
    console.log("QUESTION :", question);
    console.log("IMAGE    :", !!image);
    console.log("=================================");

    if (!question || !image) {
      return res.json({ predicted: "Missing image or question" });
    }

    const base64Image = image.split(",")[1];
    const mimeType    = image.includes("png") ? "image/png" : "image/jpeg";

    const requestBody = {
      contents: [
        {
          parts: [
            {
              text: `You are a visual reasoning assistant evaluating traffic and urban images.
Answer the following question briefly and accurately.

Question: ${question}`
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
        temperature:     0.1,
        maxOutputTokens: 150
      }
    };

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`,
      {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(requestBody)
      }
    );

    console.log("HTTP STATUS:", response.status);
    const data = await response.json();
    console.log("GEMINI RESPONSE:", JSON.stringify(data, null, 2));

    if (data.error) {
      return res.json({ predicted: "Gemini Error: " + data.error.message });
    }

    let predicted = "No response";
    if (data.candidates?.length > 0 && data.candidates[0].content?.parts) {
      predicted = data.candidates[0].content.parts
        .map(p => p.text || "")
        .join(" ")
        .trim();
    }

    console.log("PREDICTED:", predicted);
    res.json({ predicted });

  } catch (error) {
    console.error("SERVER ERROR:", error);
    res.json({ predicted: "Server crashed: " + error.message });
  }
});

/* ============================================================
   START SERVER
============================================================ */
app.listen(3000, () => {
  console.log("=================================");
  console.log("WEBVQA Backend Running");
  console.log("http://localhost:3000");
  console.log("Debug info: http://localhost:3000/debug");
  console.log("=================================");
});