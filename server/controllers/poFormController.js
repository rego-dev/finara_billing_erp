const { execFile } = require('child_process');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');
const prisma = require('../config/database');
const { getPython } = require('../utils/pythonPath');

const SCRIPT = path.join(process.cwd(), 'server', 'ocr', 'generate_po_form.py');

const DEFAULTS = {
  companyName:    'My Company Inc.',
  companyAddress: '',
  companyCity:    '',
  companyProvince:'',
  companyPhone:   '',
  companyEmail:   '',
  companyWebsite: '',
  companyTin:     '',
  companyLogo:    '',
};

exports.generateBlankForm = async (req, res, next) => {
  let tmpFile = null;
  try {
    // Load company settings
    const rows = await prisma.systemSetting.findMany({ where: { businessId: req.businessId } });
    const smap = rows.reduce((acc, r) => { acc[r.key] = r.value; return acc; }, {});
    const s    = { ...DEFAULTS, ...smap };

    const address = [s.companyAddress, s.companyCity, s.companyProvince]
      .filter(Boolean).join(', ');

    const payload = {
      name:    s.companyName,
      address: address,
      phone:   s.companyPhone,
      email:   s.companyEmail,
      website: s.companyWebsite,
      tin:     s.companyTin,
      logo:    s.companyLogo || '',
    };

    // Write payload to a temp file — avoids Windows ENAMETOOLONG on CLI args
    // (logo base64 can be hundreds of KB)
    tmpFile = path.join(os.tmpdir(), `po_form_${Date.now()}.json`);
    fs.writeFileSync(tmpFile, JSON.stringify(payload), 'utf8');

    const python = getPython();
    execFile(python, [SCRIPT, '--file', tmpFile],
      { timeout: 30000, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        // Clean up temp file
        try { fs.unlinkSync(tmpFile); } catch {}

        if (err) {
          console.error('[PO Form] PDF generation error:', stderr);
          return res.status(500).json({ error: 'PDF generation failed', detail: stderr?.slice(0, 300) });
        }
        const trimmed = stdout.trim();
        if (!trimmed) {
          console.error('[PO Form] Empty stdout from Python script');
          return res.status(500).json({ error: 'PDF generation produced no output' });
        }
        try {
          const buf = Buffer.from(trimmed, 'base64');
          res.set({
            'Content-Type':        'application/pdf',
            'Content-Disposition': 'attachment; filename="PO_BlankForm.pdf"',
            'Content-Length':      buf.length,
          });
          res.end(buf);
        } catch (e) {
          res.status(500).json({ error: 'PDF encode failed' });
        }
      }
    );
  } catch (err) {
    if (tmpFile) try { fs.unlinkSync(tmpFile); } catch {}
    next(err);
  }
};
