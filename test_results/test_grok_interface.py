#!/usr/bin/env python3
import subprocess
import sys
import os

# Change to extracted_docs directory where RAG db exists
os.chdir("extracted_docs")

# Test if grok command works
print("Testing grok --help...")
try:
    # Try 'grok' directly (if globally installed)
    result = subprocess.run(
        ["grok", "--help"], capture_output=True, text=True, timeout=10
    )
    print(f"Exit code: {result.returncode}")
    print(f"Stdout:\n{result.stdout[:500]}")
    print(f"Stderr:\n{result.stderr[:500]}")
except FileNotFoundError:
    print("'grok' command not found, trying 'bun run grok'...")
    try:
        # Go back to project root
        os.chdir("../..")
        result = subprocess.run(
            ["bun", "run", "grok", "--help"], capture_output=True, text=True, timeout=10
        )
        print(f"Exit code: {result.returncode}")
        print(f"Stdout:\n{result.stdout[:500]}")
        print(f"Stderr:\n{result.stderr[:500]}")
    except Exception as e:
        print(f"Error: {e}")

# Check for RAG commands
print("\n\nTesting 'grok rag' commands...")
try:
    os.chdir("extracted_docs")
    result = subprocess.run(
        ["grok", "rag", "--help"], capture_output=True, text=True, timeout=10
    )
    print(f"RAG help stdout:\n{result.stdout[:1000]}")
except:
    try:
        os.chdir("../..")
        result = subprocess.run(
            ["bun", "run", "grok", "rag", "--help"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        print(f"RAG help stdout:\n{result.stdout[:1000]}")
    except Exception as e:
        print(f"Error: {e}")
