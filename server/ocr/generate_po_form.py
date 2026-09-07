"""
Generate blank PO form PDF with company details.
Usage:
  python3 generate_po_form.py --file <json_file_path>
  python3 generate_po_form.py '<json_string>'   (legacy, for small payloads)
Output: base64-encoded PDF on stdout
"""
import sys, json, base64, os
from io import BytesIO
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

W, H = A4

BLUE_DARK  = colors.HexColor('#1d4ed8')
BLUE_LIGHT = colors.HexColor('#dbeafe')
GRAY_DARK  = colors.HexColor('#374151')
GRAY_MID   = colors.HexColor('#9ca3af')
GRAY_LIGHT = colors.HexColor('#f9fafb')
BLACK      = colors.HexColor('#111827')

def load_logo(logo_str):
    if not logo_str:
        return None
    try:
        if logo_str.startswith('data:'):
            _, b64 = logo_str.split(',', 1)
        else:
            b64 = logo_str
        img_bytes = base64.b64decode(b64)
        from PIL import Image as PILImage
        pil = PILImage.open(BytesIO(img_bytes))
        fmt = pil.format or 'PNG'
        buf = BytesIO()
        pil.save(buf, format=fmt)
        buf.seek(0)
        return ImageReader(buf)
    except Exception as e:
        return None

def truncate(text, n):
    if not text: return ''
    return text[:n] + ('...' if len(text) > n else '')

def draw_logo_placeholder(c, ML, H):
    c.setStrokeColor(colors.white); c.setLineWidth(1)
    c.roundRect(ML, H-36*mm, 28*mm, 28*mm, 3*mm, fill=0, stroke=1)
    c.setFont('Helvetica', 7); c.setFillColor(colors.white)
    c.drawCentredString(ML+14*mm, H-19*mm, 'COMPANY')
    c.drawCentredString(ML+14*mm, H-24*mm, 'LOGO')

def draw_form(company):
    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.setTitle('Purchase Order Form')

    ML = 20*mm; MR = 20*mm; UW = W - ML - MR

    name    = company.get('name', '')
    address = company.get('address', '')
    phone   = company.get('phone', '')
    email   = company.get('email', '')
    website = company.get('website', '')
    tin     = company.get('tin', '')
    logo_ir = company.get('_logo_ir')

    # ── HEADER BAND ──────────────────────────────────────────────
    c.setFillColor(BLUE_DARK)
    c.rect(0, H-38*mm, W, 38*mm, fill=1, stroke=0)

    if logo_ir:
        try:
            c.drawImage(logo_ir, ML, H-36*mm, width=28*mm, height=28*mm,
                        preserveAspectRatio=True, anchor='c', mask='auto')
        except:
            draw_logo_placeholder(c, ML, H)
    else:
        draw_logo_placeholder(c, ML, H)

    xco = ML + 32*mm
    c.setFont('Helvetica-Bold', 12); c.setFillColor(colors.white)
    c.drawString(xco, H-13*mm, truncate(name, 45))
    c.setFont('Helvetica', 7.5)
    if address:
        c.drawString(xco, H-19.5*mm, truncate(address, 60))
    row3 = []
    if phone:   row3.append(f'Tel: {phone}')
    if tin:     row3.append(f'TIN: {tin}')
    if row3:    c.drawString(xco, H-25*mm, '  ·  '.join(row3))
    row4 = []
    if email:   row4.append(email)
    if website: row4.append(website)
    if row4:    c.drawString(xco, H-30.5*mm, truncate('  ·  '.join(row4), 65))

    c.setFont('Helvetica-Bold', 15); c.setFillColor(colors.white)
    c.drawRightString(W-MR, H-13.5*mm, 'PURCHASE ORDER')
    c.setFont('Helvetica', 8)
    c.drawRightString(W-MR, H-20.5*mm, 'PO No: ______________________')
    c.drawRightString(W-MR, H-26.5*mm, 'Date:    ______________________')
    c.drawRightString(W-MR, H-32.5*mm, 'Page:   ______________________')

    # ── META FIELDS ──────────────────────────────────────────────
    ym = H - 50*mm

    def frow(label, x, y, w=60*mm):
        c.setFont('Helvetica-Bold', 7.5); c.setFillColor(GRAY_DARK)
        c.drawString(x, y, label)
        c.setStrokeColor(GRAY_MID); c.setLineWidth(0.4)
        c.line(x + len(label)*4.3 + 1, y-1, x+w, y-1)

    c.setFont('Helvetica-Bold', 8.5); c.setFillColor(BLUE_DARK)
    c.drawString(ML, ym, 'VENDOR INFORMATION')
    c.setStrokeColor(BLUE_DARK); c.setLineWidth(1.2)
    c.line(ML, ym-2, ML+82*mm, ym-2)

    frow('Vendor Name:',  ML,        ym-10*mm, 78*mm)
    frow('Address:',      ML,        ym-18*mm, 78*mm)
    frow('',              ML,        ym-24*mm, 78*mm)
    frow('Contact:',      ML,        ym-32*mm, 37*mm)
    frow('TIN:',          ML+45*mm,  ym-32*mm, 33*mm)
    frow('Email:',        ML,        ym-40*mm, 37*mm)
    frow('Phone:',        ML+45*mm,  ym-40*mm, 33*mm)

    xr = ML + 95*mm; cw = UW - 95*mm
    c.setFont('Helvetica-Bold', 8.5); c.setFillColor(BLUE_DARK)
    c.drawString(xr, ym, 'ORDER DETAILS')
    c.setStrokeColor(BLUE_DARK); c.setLineWidth(1.2)
    c.line(xr, ym-2, xr+cw, ym-2)

    frow('PO Number:',     xr, ym-10*mm, cw)
    frow('Order Date:',    xr, ym-18*mm, cw)
    frow('Expected Date:', xr, ym-26*mm, cw)
    frow('Prepared By:',   xr, ym-34*mm, cw)
    frow('Approved By:',   xr, ym-42*mm, cw)

    # ── DIVIDER ──────────────────────────────────────────────────
    yt = ym - 53*mm
    c.setStrokeColor(BLUE_LIGHT); c.setLineWidth(1.5)
    c.line(ML, yt, W-MR, yt)
    yt -= 2*mm

    # ── LINE ITEMS TABLE ─────────────────────────────────────────
    cn=10*mm; cd=82*mm; cq=18*mm; cu=28*mm; ca=UW-cn-cd-cq-cu
    hh=8*mm; yh=yt-hh

    c.setFillColor(BLUE_DARK); c.rect(ML, yh, UW, hh, fill=1, stroke=0)
    c.setFont('Helvetica-Bold', 8); c.setFillColor(colors.white)
    c.drawCentredString(ML+cn/2,             yh+2.5*mm, '#')
    c.drawString(ML+cn+2,                    yh+2.5*mm, 'DESCRIPTION')
    c.drawCentredString(ML+cn+cd+cq/2,       yh+2.5*mm, 'QTY')
    c.drawCentredString(ML+cn+cd+cq+cu/2,    yh+2.5*mm, 'UNIT PRICE')
    c.drawCentredString(ML+cn+cd+cq+cu+ca/2, yh+2.5*mm, 'AMOUNT')

    rh=9.5*mm; yc=yh
    for i in range(12):
        yc -= rh
        c.setFillColor(GRAY_LIGHT if i%2==0 else colors.white)
        c.rect(ML, yc, UW, rh, fill=1, stroke=0)
        c.setFont('Helvetica', 7.5); c.setFillColor(GRAY_MID)
        c.drawCentredString(ML+cn/2, yc+3*mm, str(i+1))
        c.setStrokeColor(colors.HexColor('#e5e7eb')); c.setLineWidth(0.3)
        for xd in [ML+cn, ML+cn+cd, ML+cn+cd+cq, ML+cn+cd+cq+cu]:
            c.line(xd, yc, xd, yc+rh)
        c.setStrokeColor(GRAY_MID); c.setLineWidth(0.25)
        for x1,x2 in [(ML+cn+2,ML+cn+cd-2),(ML+cn+cd+2,ML+cn+cd+cq-2),
                      (ML+cn+cd+cq+2,ML+cn+cd+cq+cu-2),(ML+cn+cd+cq+cu+2,ML+cn+cd+cq+cu+ca-2)]:
            c.line(x1, yc+2*mm, x2, yc+2*mm)

    c.setStrokeColor(BLUE_DARK); c.setLineWidth(1)
    c.line(ML, yc, W-MR, yc)

    # ── TOTALS ───────────────────────────────────────────────────
    ytot=yc-5*mm; xtl=ML+cn+cd+cq; xtr=W-MR

    def trow(lbl, y, bold=False, bg=None):
        if bg:
            c.setFillColor(bg); c.rect(xtl, y-1*mm, xtr-xtl, 7.5*mm, fill=1, stroke=0)
        c.setFont('Helvetica-Bold' if bold else 'Helvetica', 9 if bold else 8)
        c.setFillColor(BLACK); c.drawRightString(xtl+cu-2, y+2*mm, lbl)
        c.setStrokeColor(GRAY_MID); c.setLineWidth(0.4)
        c.line(xtl+cu+2, y+1.5*mm, xtr-2, y+1.5*mm)

    trow('Subtotal:',    ytot)
    trow('Tax / VAT:',   ytot-8*mm)
    trow('TOTAL (PHP):', ytot-16*mm, bold=True, bg=BLUE_LIGHT)

    # ── NOTES ────────────────────────────────────────────────────
    yn=ytot-30*mm
    c.setFont('Helvetica-Bold', 8); c.setFillColor(GRAY_DARK)
    c.drawString(ML, yn, 'Notes / Terms & Conditions:')
    c.setStrokeColor(GRAY_MID); c.setLineWidth(0.4)
    for dy in [0,6,12,18]:
        c.line(ML, yn-5*mm-dy, ML+120*mm, yn-5*mm-dy)

    # ── SIGNATURE ────────────────────────────────────────────────
    ys=yn-32*mm; sw=UW/3
    for i,lbl in enumerate(['Prepared By','Checked By','Approved By']):
        sx=ML+i*sw
        c.setStrokeColor(GRAY_DARK); c.setLineWidth(0.6)
        c.line(sx+5*mm, ys, sx+sw-5*mm, ys)
        c.setFont('Helvetica-Bold', 7.5); c.setFillColor(GRAY_DARK)
        c.drawCentredString(sx+sw/2, ys-5*mm, lbl)
        c.setFont('Helvetica', 7); c.setFillColor(GRAY_MID)
        c.drawCentredString(sx+sw/2, ys-9.5*mm, 'Signature / Date')

    # ── FOOTER ───────────────────────────────────────────────────
    c.setFillColor(BLUE_DARK); c.rect(0, 0, W, 8*mm, fill=1, stroke=0)
    c.setFont('Helvetica', 7); c.setFillColor(colors.white)
    footer = f'{name}  ·  PURCHASE ORDER · Confidential · Authorized Use Only' if name else 'PURCHASE ORDER · Confidential · Authorized Use Only'
    c.drawCentredString(W/2, 2.5*mm, truncate(footer, 90))

    c.save(); buf.seek(0)
    return buf.read()

if __name__ == '__main__':
    args = sys.argv[1:]

    # --file <path> — read JSON from file (avoids ENAMETOOLONG on Windows)
    if len(args) >= 2 and args[0] == '--file':
        try:
            with open(args[1], 'r', encoding='utf-8') as f:
                company = json.load(f)
        except Exception as e:
            sys.stderr.write(f'File read error: {e}\n'); sys.exit(1)
    elif len(args) >= 1:
        try:
            company = json.loads(args[0])
        except Exception as e:
            sys.stderr.write(f'JSON parse error: {e}\n'); sys.exit(1)
    else:
        sys.stderr.write('Usage: generate_po_form.py --file <json_path>\n'); sys.exit(1)

    company['_logo_ir'] = load_logo(company.get('logo', ''))

    try:
        pdf_bytes = draw_form(company)
        sys.stdout.write(base64.b64encode(pdf_bytes).decode('ascii'))
    except Exception as e:
        sys.stderr.write(f'PDF error: {e}\n'); sys.exit(1)
