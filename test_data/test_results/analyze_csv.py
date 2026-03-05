#!/usr/bin/env python3
import csv
import sys
import os

csv_path = os.path.join(os.path.dirname(__file__), "..", "test_data", "examples.csv")

print(f"Reading CSV from: {csv_path}")
print(f"File size: {os.path.getsize(csv_path)} bytes")

# Try to parse with different quoting options
with open(csv_path, "r", encoding="utf-8") as f:
    # Read first few lines to see structure
    lines = []
    for i in range(20):
        line = f.readline()
        if not line:
            break
        lines.append(line)

    print("First 20 lines (raw):")
    for i, line in enumerate(lines):
        print(f"{i}: {repr(line)}")

# Now try to parse as CSV
with open(csv_path, "r", encoding="utf-8") as f:
    reader = csv.DictReader(f)

    # Try to read first few rows
    rows = []
    for i, row in enumerate(reader):
        rows.append(row)
        if i >= 2:  # Get first 3 rows
            break

    print("\nFirst 3 rows parsed:")
    for i, row in enumerate(rows):
        print(f"\nRow {i}:")
        for key in row.keys():
            value = row[key]
            print(f"  {key}: {repr(value[:200] if value else '')}")
