"""
OCR parser for Purchase Order scanned forms.
Usage: python3 parse_po.py <image_path>
Outputs: JSON with extracted PO fields
"""
import sys, re, json
from PIL import Image, ImageFilter, ImageEnhance
import pytesseract

def preprocess(path):
    img = Image.open(path).convert('L')          # grayscale
    img = img.filter(ImageFilter.SHARPEN)
    img = ImageEnhance.Contrast(img).enhance(2.0)
    # Upscale if small
    w, h = img.size
    if w < 1200:
        scale = 1800 / w
        img = img.resize((int(w*scale), int(h*scale)), Image.LANCZOS)
    return img

def clean(s):
    return re.sub(r'\s+', ' ', s or '').strip()

def parse_currency(s):
    """Extract numeric value from a string like '₱ 1,234.56' or '1234.56'"""
    s = re.sub(r'[^\d.,]', '', s or '')
    s = s.replace(',', '')
    try:
        return float(s)
    except:
        return 0.0

def extract_field(lines, *keywords):
    """Find a value after a keyword label on the same line."""
    kw_lower = [k.lower() for k in keywords]
    for line in lines:
        ll = line.lower()
        for kw in kw_lower:
            if kw in ll:
                # Value is after the keyword + colon
                pattern = re.escape(kw) + r'[:\s]*(.*)'
                m = re.search(pattern, ll)
                if m:
                    val = clean(line[m.start(1):])
                    # Strip trailing noise like underscores / dashes
                    val = re.sub(r'[_\-]{2,}.*$', '', val).strip()
                    if len(val) > 1:
                        return val
    return ''

def parse_table_rows(lines):
    """
    Find the line items table. Strategy:
    1. Locate header row (contains DESCRIPTION + QTY / AMOUNT keywords)
    2. Extract subsequent rows until Subtotal/Total
    3. Each row: row_no | description | qty | unit_price | amount
    """
    rows = []
    in_table = False
    header_idx = -1

    for i, line in enumerate(lines):
        ll = line.lower()
        if ('description' in ll) and ('qty' in ll or 'quantity' in ll) and ('amount' in ll or 'price' in ll):
            in_table = True
            header_idx = i
            continue

        if in_table:
            # Stop at totals section
            if re.search(r'\b(subtotal|total|notes?|terms|signature|prepared|approved|checked)\b', ll):
                break

            stripped = clean(line)
            if not stripped or len(stripped) < 3:
                continue

            # Try to parse: optional_row_no | description text | qty | unit_price | amount
            # Numbers at end of line are amount, before that unit_price, before that qty
            nums = re.findall(r'[\d,]+\.?\d{0,2}', stripped)
            
            # Remove leading row number
            text = re.sub(r'^\d+[\.\s]+', '', stripped)

            if len(nums) >= 3:
                # Last = amount, second-to-last = unit_price, third = qty
                amount     = parse_currency(nums[-1])
                unit_price = parse_currency(nums[-2])
                qty        = parse_currency(nums[-3])
                # Description = everything before first number
                desc_m = re.match(r'^([^\d]+)', text)
                desc = clean(desc_m.group(1)) if desc_m else text
                # Trim trailing noise
                desc = re.sub(r'[_\-]{2,}.*$', '', desc).strip()
                if desc and (qty > 0 or unit_price > 0 or amount > 0):
                    rows.append({
                        'description': desc,
                        'quantity':    qty if qty > 0 else 1,
                        'unitPrice':   unit_price,
                        'amount':      amount,
                    })
            elif len(nums) == 2:
                # qty + unit_price, amount might be missing
                qty        = parse_currency(nums[0])
                unit_price = parse_currency(nums[1])
                desc_m = re.match(r'^([^\d]+)', text)
                desc = clean(desc_m.group(1)) if desc_m else text
                desc = re.sub(r'[_\-]{2,}.*$', '', desc).strip()
                if desc and unit_price > 0:
                    rows.append({
                        'description': desc,
                        'quantity':    qty if qty > 0 else 1,
                        'unitPrice':   unit_price,
                        'amount':      round(qty * unit_price, 2),
                    })
            elif len(nums) == 0 and len(text) > 3:
                # Description-only row (continuation) — merge with last row
                desc = re.sub(r'[_\-]{2,}.*$', '', text).strip()
                if rows and desc:
                    rows[-1]['description'] += ' ' + desc

    return rows

def extract_total(lines, *keywords):
    """Extract the numeric value from a line matching any keyword."""
    for line in lines:
        ll = line.lower()
        for kw in keywords:
            if kw in ll:
                nums = re.findall(r'[\d,]+\.?\d{0,2}', line)
                if nums:
                    return parse_currency(nums[-1])
    return 0.0

def extract_date(text):
    """Try to find a date pattern in text."""
    patterns = [
        r'\b(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})\b',
        r'\b(\w+ \d{1,2},? \d{4})\b',
        r'\b(\d{4}[\/\-]\d{2}[\/\-]\d{2})\b',
    ]
    for p in patterns:
        m = re.search(p, text)
        if m:
            return clean(m.group(0))
    return ''

def main():
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'No image path provided'}))
        sys.exit(1)

    img_path = sys.argv[1]
    try:
        img = preprocess(img_path)
    except Exception as e:
        print(json.dumps({'error': f'Image load failed: {e}'}))
        sys.exit(1)

    # Run OCR — use LSTM engine for best accuracy
    custom_cfg = r'--oem 1 --psm 6'
    try:
        raw_text = pytesseract.image_to_string(img, config=custom_cfg)
    except Exception as e:
        print(json.dumps({'error': f'OCR failed: {e}'}))
        sys.exit(1)

    lines = [l for l in raw_text.split('\n') if l.strip()]

    # ── Extract fields ─────────────────────────────────────────
    vendor_name   = extract_field(lines, 'vendor name', 'vendor:', 'supplier')
    po_number     = extract_field(lines, 'po number', 'po no', 'purchase order no', 'p.o. no')
    order_date    = extract_field(lines, 'order date', 'date:')
    expected_date = extract_field(lines, 'expected date', 'delivery date', 'expected delivery')
    prepared_by   = extract_field(lines, 'prepared by')
    approved_by   = extract_field(lines, 'approved by')
    address       = extract_field(lines, 'address:')
    contact       = extract_field(lines, 'contact:')
    phone         = extract_field(lines, 'phone:')
    email         = extract_field(lines, 'email:')
    notes         = extract_field(lines, 'notes', 'terms')

    # Extract dates from raw value strings
    if order_date:
        order_date = extract_date(order_date) or order_date
    if expected_date:
        expected_date = extract_date(expected_date) or expected_date

    # Extract totals
    subtotal = extract_total(lines, 'subtotal')
    tax      = extract_total(lines, 'tax', 'vat')
    total    = extract_total(lines, 'total (php)', 'total:', 'grand total')

    # Extract line items
    line_items = parse_table_rows(lines)

    # Recalculate if totals missing
    if not total and line_items:
        total = sum(r['amount'] for r in line_items)
    if not subtotal and line_items:
        subtotal = sum(r['amount'] for r in line_items)

    result = {
        'success':      True,
        'rawText':      raw_text[:2000],   # first 2000 chars for debug
        'vendor': {
            'name':    vendor_name,
            'address': address,
            'contact': contact,
            'phone':   phone,
            'email':   email,
        },
        'poNumber':     po_number,
        'orderDate':    order_date,
        'expectedDate': expected_date,
        'preparedBy':   prepared_by,
        'approvedBy':   approved_by,
        'notes':        notes,
        'lines':        line_items,
        'subtotal':     subtotal,
        'taxAmount':    tax,
        'total':        total,
        'confidence': {
            'lineCount':   len(line_items),
            'hasVendor':   bool(vendor_name),
            'hasDate':     bool(order_date),
            'hasTotal':    total > 0,
        }
    }

    print(json.dumps(result))

if __name__ == '__main__':
    main()
