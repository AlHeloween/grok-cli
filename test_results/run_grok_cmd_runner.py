#!/usr/bin/env python3
import subprocess
import json
import os
import sys
import time
import shutil


def run_cmd_runner(command, cwd=None, timeout=30):
    """Run a command using cmd_runner.exe and capture output."""
    # Use tools/adm.exe --cmd-runner as per skill
    cmd = [
        "tools/adm.exe",
        "--cmd-runner",
        "start",
        "--terminal",
        "conhost",
        "--",
    ] + command

    print(f"Running cmd_runner: {' '.join(cmd)}")
    print(f"Working directory: {cwd or os.getcwd()}")

    try:
        # Start the process
        result = subprocess.run(
            cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout
        )

        print(f"Exit code: {result.returncode}")
        print(f"Stdout:\n{result.stdout[:1000]}")
        print(f"Stderr:\n{result.stderr[:1000]}")

        return {
            "success": result.returncode == 0,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "returncode": result.returncode,
        }
    except subprocess.TimeoutExpired:
        print(f"Command timed out after {timeout} seconds")
        return {"success": False, "error": "timeout"}
    except Exception as e:
        print(f"Error running cmd_runner: {e}")
        return {"success": False, "error": str(e)}


def main():
    # Read selected questions
    questions_path = os.path.join(os.path.dirname(__file__), "selected_questions.json")
    with open(questions_path, "r", encoding="utf-8") as f:
        questions = json.load(f)

    if not questions:
        print("No questions found")
        return

    # Use first question for testing
    question = questions[0]
    print(f"Testing with question: {question['question'][:100]}...")

    # Set environment for hash embeddings (no API needed for RAG)
    env = os.environ.copy()
    env["GROK_EMBEDDINGS_PROVIDER"] = "hash"
    env["GROK_EMBEDDINGS_HASH_DIMENSION"] = "256"
    env["GROK_RAG_QUANTIZE"] = "false"
    # Note: Still need GROK_API_KEY for Grok API calls

    # Change to extracted_docs directory where RAG db exists
    docs_dir = os.path.join(os.path.dirname(__file__), "extracted_docs")

    # Try to run grok with the question as message argument
    grok_command = ["grok", question["question"]]

    result = run_cmd_runner(grok_command, cwd=docs_dir, timeout=15)

    # Save result
    output_path = os.path.join(os.path.dirname(__file__), "grok_cmd_runner_result.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(
            {"question": question, "command": grok_command, "result": result},
            f,
            indent=2,
            ensure_ascii=False,
        )

    print(f"\nSaved result to: {output_path}")

    # Also try to get grok rag status
    print("\n\nTesting 'grok rag status'...")
    status_result = run_cmd_runner(["grok", "rag", "status"], cwd=docs_dir, timeout=10)

    status_output_path = os.path.join(
        os.path.dirname(__file__), "grok_rag_status_result.json"
    )
    with open(status_output_path, "w", encoding="utf-8") as f:
        json.dump(
            {"command": ["grok", "rag", "status"], "result": status_result},
            f,
            indent=2,
            ensure_ascii=False,
        )

    print(f"Saved status result to: {status_output_path}")


if __name__ == "__main__":
    main()
