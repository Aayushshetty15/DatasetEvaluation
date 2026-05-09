'use strict';

/* ============================================================
   DOM References
============================================================ */
const uploadZone         = document.getElementById('upload-zone');
const fileInput          = document.getElementById('file-input');
const previewImg         = document.getElementById('preview-img');
const previewPlaceholder = document.getElementById('preview-placeholder');
const previewOverlay     = document.getElementById('preview-overlay');
const filenameLabel      = document.getElementById('filename-label');

const evalBtn            = document.getElementById('eval-btn');
const questionDisplay    = document.getElementById('question-display');
const groundTruthDisplay = document.getElementById('ground-truth-display');
const predictedDisplay   = document.getElementById('predicted-display');
const resultIndicator    = document.getElementById('result-indicator');
const resultIcon         = document.getElementById('result-icon');
const resultText         = document.getElementById('result-text');

const metricTotal        = document.getElementById('metric-total');
const metricCorrect      = document.getElementById('metric-correct');
const metricIncorrect    = document.getElementById('metric-incorrect');
const metricAccLabel     = document.getElementById('metric-accuracy-label');
const accuracyBar        = document.getElementById('accuracy-bar');

/* ============================================================
   DATASET — loaded as a Promise so we always wait for it
============================================================ */
let DATASET = [];
let datasetReady = false;

const datasetLoaded = fetch('/dataset')
  .then(res => {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  })
  .then(data => {
    DATASET = data;
    datasetReady = true;
    console.log('✅ Dataset loaded:', DATASET.length, 'entries');
    // Show first few entries so we know what filenames look like
    console.log('Sample entries:');
    DATASET.slice(0, 3).forEach(d => {
      console.log(' ', d.image_id, '→', bare(d.source_file));
    });
  })
  .catch(err => {
    console.error('❌ Dataset load error:', err);
    alert('Failed to load dataset.json — is the server running?\n\n' + err.message);
  });

/* ============================================================
   Helpers
============================================================ */
function bare(fullPath) {
  return fullPath
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .toLowerCase()
    .trim();
}

function norm(s) {
  return s.toLowerCase().replace(/\s+/g, '').trim();
}

function extractNum(filename) {
  const m = filename.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

/* ============================================================
   3-Pass Dataset Lookup
============================================================ */
function findMatch(uploadedName) {
  const uploadedBare = bare(uploadedName);
  const uploadedNorm = norm(uploadedName);

  console.log('🔍 Looking for:', uploadedBare, '| norm:', uploadedNorm);
  console.log('📦 Dataset size:', DATASET.length);

  // Pass 1: exact bare filename (case-insensitive)
  let match = DATASET.find(item => bare(item.source_file) === uploadedBare);
  if (match) { console.log('✅ Pass 1 hit:', match.image_id); return match; }

  // Pass 2: strip spaces
  match = DATASET.find(item => norm(bare(item.source_file)) === uploadedNorm);
  if (match) { console.log('✅ Pass 2 hit:', match.image_id); return match; }

  // Pass 3: number → TRF_XXX
  const num = extractNum(uploadedName);
  if (num !== null) {
    const id = 'TRF_' + String(num).padStart(3, '0');
    match = DATASET.find(item => item.image_id === id);
    if (match) { console.log('✅ Pass 3 hit:', match.image_id); return match; }
  }

  // Debug: show what the first few dataset bare names look like
  console.warn('❌ No match. First 5 dataset bare names:');
  DATASET.slice(0, 5).forEach(d => console.warn('  "' + bare(d.source_file) + '"'));

  return null;
}

/* ============================================================
   State
============================================================ */
let state = {
  totalEvaluated:  0,
  correctCount:    0,
  incorrectCount:  0,
  hasImage:        false,
  isLoading:       false,
  currentData:     null,
  currentImageSrc: null
};

/* ============================================================
   Upload Handlers
============================================================ */
uploadZone.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) handleFileUpload(file);
  fileInput.value = '';
});

uploadZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadZone.classList.add('dragover');
});

uploadZone.addEventListener('dragleave', () => {
  uploadZone.classList.remove('dragover');
});

uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) handleFileUpload(file);
});

/* ============================================================
   File Upload — WAIT for dataset before matching
============================================================ */
function handleFileUpload(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    // Always wait for dataset to finish loading first
    await datasetLoaded;
    showImagePreview(e.target.result, file.name);
  };
  reader.readAsDataURL(file);
}

/* ============================================================
   Show Preview + Match Dataset
============================================================ */
function showImagePreview(src, filename) {
  previewImg.src                   = src;
  previewImg.style.display         = 'block';
  previewPlaceholder.style.display = 'none';
  previewOverlay.style.display     = 'block';
  filenameLabel.textContent        = 'File: ' + filename;
  state.hasImage                   = true;
  state.currentImageSrc            = src;

  const matched = findMatch(filename);

  if (!matched) {
    alert(
      'No match found for "' + filename + '".\n\n' +
      'Tried: "' + bare(filename) + '"\n\n' +
      'Open DevTools (F12) Console for details.\n' +
      'Make sure your image number matches a dataset entry.\n' +
      'Example: "image (1).jpg" → TRF_001'
    );
    state.currentData              = null;
    questionDisplay.textContent    = 'No match found';
    groundTruthDisplay.textContent = '—';
    predictedDisplay.textContent   = '—';
    resetResultIndicator();
    return;
  }

  state.currentData              = matched;
  questionDisplay.textContent    = matched.question;
  groundTruthDisplay.textContent = matched.answer;
  predictedDisplay.textContent   = '—';
  resetResultIndicator();
}

/* ============================================================
   Evaluate Button
============================================================ */
evalBtn.addEventListener('click', () => {
  if (!state.isLoading) runEvaluation();
});

/* ============================================================
   Call Backend /evaluate → Gemini
============================================================ */
async function runEvaluation() {
  if (!state.currentData) {
    alert('Please upload a valid image first.');
    return;
  }

  state.isLoading               = true;
  evalBtn.classList.add('loading');
  evalBtn.disabled              = true;
  predictedDisplay.textContent  = 'Evaluating…';

  try {
    const response = await fetch('/evaluate', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: state.currentData.question,
        image:    state.currentImageSrc
      })
    });

    if (!response.ok) throw new Error('Server returned HTTP ' + response.status);

    const data      = await response.json();
    const predicted = data.predicted || 'No response';
    finishEvaluation(predicted);

  } catch (err) {
    console.error('Evaluation error:', err);
    predictedDisplay.textContent = 'Error';
    alert('Evaluation failed: ' + err.message);
  }

  state.isLoading = false;
  evalBtn.classList.remove('loading');
  evalBtn.disabled = false;
}

/* ============================================================
   Compare Answers
============================================================ */
function finishEvaluation(predictedAnswer) {
  predictedDisplay.textContent = predictedAnswer;

  const gt        = state.currentData.answer.toLowerCase().trim();
  const pred      = predictedAnswer.toLowerCase().trim();
  const isCorrect = pred === gt || pred.includes(gt) || gt.includes(pred);

  if (isCorrect) { showCorrect();   state.correctCount++;   }
  else           { showIncorrect(); state.incorrectCount++; }

  state.totalEvaluated++;
  updateMetrics();
}

/* ============================================================
   Result UI
============================================================ */
function showCorrect() {
  resultIndicator.className = 'result-indicator correct';
  resultIcon.textContent    = 'check_circle';
  resultIcon.className      = 'material-symbols-outlined result-icon correct filled';
  resultText.textContent    = 'Predictable';
  resultText.className      = 'text-headline-sm result-text correct';
}

function showIncorrect() {
  resultIndicator.className = 'result-indicator incorrect';
  resultIcon.textContent    = 'cancel';
  resultIcon.className      = 'material-symbols-outlined result-icon incorrect filled';
  resultText.textContent    = 'Challenging';
  resultText.className      = 'text-headline-sm result-text incorrect';
}

function resetResultIndicator() {
  resultIndicator.className = 'result-indicator';
  resultIcon.textContent    = 'hourglass_empty';
  resultIcon.className      = 'material-symbols-outlined result-icon';
  resultText.textContent    = 'Awaiting Eval';
  resultText.className      = 'text-headline-sm result-text';
}

/* ============================================================
   Metrics
============================================================ */
function updateMetrics() {
  const accuracy = Math.round((state.correctCount / state.totalEvaluated) * 100);
  metricTotal.textContent     = state.totalEvaluated;
  metricCorrect.textContent   = state.correctCount;
  metricIncorrect.textContent = state.incorrectCount;
  metricAccLabel.textContent  = accuracy + '%';
  accuracyBar.style.width     = accuracy + '%';
}

/* ============================================================
   Init
============================================================ */
(function init() {
  accuracyBar.style.width     = '0%';
  metricTotal.textContent     = '0';
  metricCorrect.textContent   = '0';
  metricIncorrect.textContent = '0';
  metricAccLabel.textContent  = '0%';
})();