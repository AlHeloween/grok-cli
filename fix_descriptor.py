import xml.etree.ElementTree as ET
import hashlib
import os

# Read exact original and new content
with open('exact_hooks.txt', 'r', encoding='utf-8') as f:
    original = f.read()
with open('new_hooks_table.txt', 'r', encoding='utf-8') as f:
    new = f.read()

# Compute MD5
md5_new = hashlib.md5(new.encode('utf-8')).hexdigest()
size_new = len(new.encode('utf-8'))

# Parse existing descriptor
tree = ET.parse('updates/20260228T162545_replace_update_scaffold.xml')
root = tree.getroot()

# Find the update block
for update in root.findall('.//update_md5_739dbd8741f3134a849d7c005355a631'):
    # Update md5 and size attributes
    update.set('md5', md5_new)
    update.set('size', str(size_new))
    # Update find_text
    find_text = update.find('find_text')
    if find_text is not None:
        find_text.text = original
    # Update content_md5
    content_md5 = update.find(f'content_md5_{md5_new}')
    if content_md5 is not None:
        content_md5.text = new
    # Also need to update the tag name? Keep same for now
    break

# Write back
tree.write('updates/20260228T162545_replace_update_scaffold.xml', encoding='utf-8', xml_declaration=True)
