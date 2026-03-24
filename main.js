import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

// Elements
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const fileInfo = document.getElementById('file-info');
const filenameEl = document.getElementById('filename');
const filesizeEl = document.getElementById('filesize');
const convertBtn = document.getElementById('convert-btn');
const changeBtn = document.getElementById('change-btn');
const progressSection = document.getElementById('progress-section');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const statusText = document.getElementById('status-text');
const doneSection = document.getElementById('done-section');
const sizeCompare = document.getElementById('size-compare');
const preview = document.getElementById('preview');
const downloadBtn = document.getElementById('download-btn');
const resetBtn = document.getElementById('reset-btn');
const cancelBtn = document.getElementById('cancel-btn');
const confirmDialog = document.getElementById('confirm-dialog');
const confirmCancelBtn = document.getElementById('confirm-cancel-btn');
const resumeBtn = document.getElementById('resume-btn');
const errorEl = document.getElementById('error');

let selectedFile = null;
let ffmpeg = null;
let outputUrl = null;
let converting = false;

// State machine
const sections = [dropzone, fileInfo, progressSection, doneSection];

function setState(el) {
  sections.forEach(s => s.hidden = true);
  el.hidden = false;
  errorEl.hidden = true;
  confirmDialog.hidden = true;
}

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.hidden = false;
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// File handling
function handleFile(file) {
  if (!file) return;
  if (!file.type.includes('mp4') && !file.name.toLowerCase().endsWith('.mp4')) {
    showError('Please select an MP4 file.');
    return;
  }
  if (file.size > 500 * 1024 * 1024) {
    showError('Files over 500 MB may cause browser memory issues.');
  }
  selectedFile = file;
  filenameEl.textContent = file.name;
  filesizeEl.textContent = formatSize(file.size);
  setState(fileInfo);
}

// Drag and drop
dropzone.addEventListener('click', () => fileInput.click());

dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('dragover');
});

dropzone.addEventListener('dragleave', () => {
  dropzone.classList.remove('dragover');
});

dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  handleFile(e.dataTransfer.files[0]);
});

fileInput.addEventListener('change', () => {
  handleFile(fileInput.files[0]);
  fileInput.value = '';
});

changeBtn.addEventListener('click', () => {
  selectedFile = null;
  setState(dropzone);
});

// FFmpeg
async function loadFFmpeg() {
  if (ffmpeg) return;
  ffmpeg = new FFmpeg();

  ffmpeg.on('progress', ({ progress }) => {
    const pct = Math.min(100, Math.max(0, Math.round(progress * 100)));
    progressBar.value = pct;
    progressText.textContent = `${pct}%`;
    statusText.textContent = 'Converting...';
  });

  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';

  statusText.textContent = 'Loading converter...';
  progressBar.removeAttribute('value'); // indeterminate

  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  });
}

async function convert() {
  if (!selectedFile) return;

  setState(progressSection);
  progressBar.value = 0;
  progressText.textContent = '';

  try {
    await loadFFmpeg();

    converting = true;
    statusText.textContent = 'Converting...';
    progressBar.value = 0;

    await ffmpeg.writeFile('input.mp4', await fetchFile(selectedFile));

    await ffmpeg.exec([
      '-i', 'input.mp4',
      '-c:v', 'libvpx',
      '-b:v', '1M',
      '-deadline', 'realtime',
      '-cpu-used', '8',
      '-c:a', 'libvorbis',
      '-q:a', '4',
      'output.webm',
    ]);

    const data = await ffmpeg.readFile('output.webm');
    const blob = new Blob([data.buffer], { type: 'video/webm' });

    if (outputUrl) URL.revokeObjectURL(outputUrl);
    outputUrl = URL.createObjectURL(blob);

    preview.src = outputUrl;
    sizeCompare.textContent = `${formatSize(selectedFile.size)} → ${formatSize(blob.size)}`;

    downloadBtn.onclick = () => {
      const a = document.createElement('a');
      a.href = outputUrl;
      a.download = selectedFile.name.replace(/\.mp4$/i, '.webm');
      a.click();
    };

    // Clean up FFmpeg virtual filesystem
    await ffmpeg.deleteFile('input.mp4');
    await ffmpeg.deleteFile('output.webm');

    converting = false;
    setState(doneSection);
  } catch (err) {
    converting = false;
    // If terminated via cancel, don't show error
    if (!ffmpeg) return;
    console.error('Conversion failed:', err);
    setState(dropzone);
    showError('Conversion failed. Please try again or use a different file.');
  }
}

convertBtn.addEventListener('click', convert);

// Cancel flow
cancelBtn.addEventListener('click', () => {
  confirmDialog.hidden = false;
});

resumeBtn.addEventListener('click', () => {
  confirmDialog.hidden = true;
});

confirmCancelBtn.addEventListener('click', async () => {
  confirmDialog.hidden = true;
  if (ffmpeg && converting) {
    ffmpeg.terminate();
    ffmpeg = null;
    converting = false;
  }
  selectedFile = null;
  setState(dropzone);
});

resetBtn.addEventListener('click', () => {
  selectedFile = null;
  if (outputUrl) {
    URL.revokeObjectURL(outputUrl);
    outputUrl = null;
  }
  preview.src = '';
  setState(dropzone);
});
