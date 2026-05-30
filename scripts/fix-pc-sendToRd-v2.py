#!/usr/bin/env python3
"""Fix sendToRd to handle mfg_lot_no='None' and use Lot code as fallback."""

PC_PAGE = "/home/ubuntu/pre-assignment/pc/src/pages/AssayProcessBaselinePage.tsx"

with open(PC_PAGE, 'r') as f:
    content = f.read()

# Find and replace the sendToRd function
old_lot_line = "const lotNo = firstRow['mfg_lot_no'] || firstRow['Lot code'] || firstRow['lot_no'] || '';"
new_lot_line = """const rawLot = firstRow['mfg_lot_no'];
    const lotNo = (rawLot && rawLot !== 'None' && rawLot !== 'null') ? rawLot : (firstRow['Lot code'] || firstRow['lot_no'] || '');"""

if old_lot_line in content:
    content = content.replace(old_lot_line, new_lot_line)
    with open(PC_PAGE, 'w') as f:
        f.write(content)
    print("✅ Fixed mfg_lot_no 'None' handling")
else:
    print("❌ Could not find the lot_no line to fix")
    # Try to find it with different formatting
    import re
    pattern = r"const lotNo = firstRow\['mfg_lot_no'\].*?'';"
    match = re.search(pattern, content, re.DOTALL)
    if match:
        content = content.replace(match.group(0), new_lot_line)
        with open(PC_PAGE, 'w') as f:
            f.write(content)
        print("✅ Fixed with regex match")
    else:
        print("❌ Could not find pattern at all")
