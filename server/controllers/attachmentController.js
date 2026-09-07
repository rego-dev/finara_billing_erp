const fs = require('fs');
const path = require('path');
const multer = require('multer');
const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { recordAudit } = require('../utils/audit');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Entities allowed to carry attachments
const ALLOWED_ENTITIES = ['Bill', 'Invoice', 'ExpenseVoucher', 'JournalEntry', 'PurchaseOrder', 'FixedAsset', 'BankReconciliation'];

const ALLOWED_MIME = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/csv', 'text/plain',
];

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, unique);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Unsupported file type'));
  },
}).single('file');

// Middleware wrapper that turns multer errors into clean API errors
exports.uploadMiddleware = (req, res, next) => {
  upload(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File exceeds 10 MB limit' : err.message;
      return res.status(400).json({ error: msg });
    }
    next();
  });
};

const validateEntity = (entity) => {
  if (!ALLOWED_ENTITIES.includes(entity)) throw createError(`Attachments not supported for "${entity}"`, 400);
};

exports.create = async (req, res, next) => {
  try {
    const { entity, entityId } = req.params;
    validateEntity(entity);
    if (!req.file) throw createError('No file uploaded', 400);

    const att = await prisma.attachment.create({
      data: {
        entity,
        entityId: Number(entityId),
        fileName: req.file.filename,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        uploadedBy: req.user?.id ?? null,
      },
    });
    await recordAudit({ req, action: 'ATTACH', entity, entityId, summary: `Uploaded file "${att.originalName}"` });
    res.status(201).json(att);
  } catch (err) { next(err); }
};

exports.list = async (req, res, next) => {
  try {
    const { entity, entityId } = req.params;
    validateEntity(entity);
    const items = await prisma.attachment.findMany({
      where: { entity, entityId: Number(entityId) },
      orderBy: { id: 'desc' },
    });
    res.json(items);
  } catch (err) { next(err); }
};

exports.download = async (req, res, next) => {
  try {
    const att = await prisma.attachment.findUnique({ where: { id: Number(req.params.id) } });
    if (!att) throw createError('Attachment not found', 404);
    const filePath = path.join(UPLOAD_DIR, att.fileName);
    if (!fs.existsSync(filePath)) throw createError('File missing from storage', 404);
    res.setHeader('Content-Type', att.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(att.originalName)}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) { next(err); }
};

exports.remove = async (req, res, next) => {
  try {
    const att = await prisma.attachment.findUnique({ where: { id: Number(req.params.id) } });
    if (!att) throw createError('Attachment not found', 404);
    const filePath = path.join(UPLOAD_DIR, att.fileName);
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) { /* ignore disk errors */ }
    await prisma.attachment.delete({ where: { id: att.id } });
    await recordAudit({ req, action: 'DETACH', entity: att.entity, entityId: att.entityId, summary: `Deleted file "${att.originalName}"` });
    res.json({ message: 'Attachment deleted' });
  } catch (err) { next(err); }
};
