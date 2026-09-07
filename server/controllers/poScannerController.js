const { execFile } = require('child_process');
const path  = require('path');
const fs    = require('fs');
const multer = require('multer');
const { getPython } = require('../utils/pythonPath');

// ─── Multer setup (memory → temp file) ───────────────────────
const upload = multer({
  dest: path.join(process.cwd(), 'tmp', 'po-scans'),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|jpg|png|webp|tiff|bmp)$/.test(file.mimetype);
    cb(ok ? null : new Error('Only image files allowed'), ok);
  },
});
exports.upload = upload;

// ─── Python OCR script path ───────────────────────────────────
const OCR_SCRIPT = path.join(process.cwd(), 'server', 'ocr', 'parse_po.py');

// ─── Main scan handler ────────────────────────────────────────
exports.scan = async (req, res, next) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No image uploaded' });

  execFile(getPython(), [OCR_SCRIPT, file.path], { timeout: 60000 }, (err, stdout, stderr) => {
    // Always clean up temp file
    fs.unlink(file.path, () => {});

    if (err) {
      console.error('[PO Scanner] OCR error:', stderr);
      return res.status(500).json({ error: 'OCR processing failed', detail: stderr?.slice(0, 300) });
    }

    try {
      const result = JSON.parse(stdout);
      return res.json(result);
    } catch (parseErr) {
      console.error('[PO Scanner] JSON parse error:', stdout);
      return res.status(500).json({ error: 'Failed to parse OCR output' });
    }
  });
};
