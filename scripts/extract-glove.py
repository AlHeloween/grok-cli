#!/usr/bin/env python3
"""
Extract specific GloVe file from glove.6B.zip.
Usage: python scripts/extract-glove.py [dimension]
Example: python scripts/extract-glove.py 50
"""

import zipfile
import sys
import os


def main():
    if len(sys.argv) > 1:
        dimension = sys.argv[1]
    else:
        dimension = "50"  # Default to 50d

    zip_path = "data/glove/glove.6B.zip"
    target_file = f"glove.6B.{dimension}d.txt"
    output_path = f"data/glove/{target_file}"

    if not os.path.exists(zip_path):
        print(f"Error: ZIP file not found at {zip_path}")
        sys.exit(1)

    print(f"Extracting {target_file} from {zip_path}...")

    try:
        with zipfile.ZipFile(zip_path, "r") as zip_ref:
            # Check if file exists in zip
            if target_file not in zip_ref.namelist():
                available = [f for f in zip_ref.namelist() if f.endswith(".txt")]
                print(f"Error: {target_file} not found in ZIP.")
                print(f"Available files: {', '.join(available)}")
                sys.exit(1)

            # Extract the file
            zip_ref.extract(target_file, "data/glove/")

            # Rename if needed (extracts to data/glove/glove.6B.50d.txt)
            extracted_path = os.path.join("data/glove", target_file)
            if extracted_path != output_path:
                if os.path.exists(output_path):
                    os.remove(output_path)
                os.rename(extracted_path, output_path)

            print(f"Successfully extracted to {output_path}")

            # Get file size
            size = os.path.getsize(output_path)
            print(f"File size: {size:,} bytes ({size / 1024 / 1024:.2f} MB)")

            # Show first few lines
            with open(output_path, "r", encoding="utf-8") as f:
                print("\nFirst 3 lines:")
                for i in range(3):
                    line = f.readline().strip()
                    if line:
                        parts = line.split()
                        word = parts[0]
                        vector_len = len(parts) - 1
                        print(f"  {word}: {vector_len} dimensions")

    except Exception as e:
        print(f"Error extracting file: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
