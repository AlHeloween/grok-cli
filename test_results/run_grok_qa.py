#!/usr/bin/env python3
import subprocess
import json
import os
import sys
import time
import shutil
from datetime import datetime


def run_grok_prompt(question, cwd=None, timeout=60):
    """Run grok with a single prompt in headless mode and capture output."""
    # Set environment variables for local embeddings and RAG
    env = os.environ.copy()
    env["GROK_EMBEDDINGS_PROVIDER"] = "hash"
    env["GROK_EMBEDDINGS_HASH_DIMENSION"] = "256"
    env["GROK_RAG_ENABLED"] = "1"
    env["GROK_RAG_QUANTIZE"] = "false"
    env["GROK_RAG_QUANTIZE_PRELOAD"] = "false"

    # Build command
    cmd = ["grok", "-p", question]

    print(f"Running: {' '.join(cmd)}")
    print(f"Question: {question[:80]}...")

    try:
        start_time = time.time()
        result = subprocess.run(
            cmd, cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout
        )
        elapsed = time.time() - start_time

        print(f"  Exit code: {result.returncode}")
        print(f"  Time: {elapsed:.2f}s")

        return {
            "success": result.returncode == 0,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "returncode": result.returncode,
            "elapsed_time": elapsed,
        }
    except subprocess.TimeoutExpired:
        print(f"  Timeout after {timeout} seconds")
        return {"success": False, "error": "timeout", "elapsed_time": timeout}
    except Exception as e:
        print(f"  Error: {e}")
        return {"success": False, "error": str(e)}


def check_rag_status(cwd):
    """Check RAG status to ensure it's enabled and indexed."""
    print("\nChecking RAG status...")
    try:
        result = subprocess.run(
            ["grok", "rag", "status"],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=10,
        )
        print(result.stdout)
        return result.stdout
    except Exception as e:
        print(f"Error checking RAG status: {e}")
        return ""


def main():
    # Paths
    base_dir = os.path.dirname(os.path.abspath(__file__))
    docs_dir = os.path.join(base_dir, "extracted_docs")
    questions_path = os.path.join(base_dir, "selected_questions.json")
    output_path = os.path.join(base_dir, "grok_qa_results.json")
    report_path = os.path.join(base_dir, "grok_qa_report.md")

    # Load questions
    with open(questions_path, "r", encoding="utf-8") as f:
        questions = json.load(f)

    print(f"Loaded {len(questions)} questions")

    # Check RAG status first
    rag_status = check_rag_status(docs_dir)

    # Run each question
    results = []
    for i, q in enumerate(questions):
        print(f"\n{'=' * 60}")
        print(f"Question {i + 1}/{len(questions)}: {q['id']}")
        print(f"{'=' * 60}")

        # Combine system instruction with question if present
        question_text = q["question"]
        if q.get("system_instruction"):
            # Add system instruction as context
            question_text = f"{q['system_instruction']}\n\n{question_text}"

        result = run_grok_prompt(question_text, cwd=docs_dir, timeout=120)

        results.append(
            {
                "question_id": q["id"],
                "question": q["question"],
                "system_instruction": q.get("system_instruction", ""),
                "result": result,
            }
        )

        # Small delay between requests
        if i < len(questions) - 1:
            print("Waiting 5 seconds before next question...")
            time.sleep(5)

    # Save results
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "timestamp": datetime.now().isoformat(),
                "rag_status_check": rag_status,
                "questions_count": len(questions),
                "results": results,
            },
            f,
            indent=2,
            ensure_ascii=False,
        )

    print(f"\n✅ Saved results to: {output_path}")

    # Generate markdown report
    generate_report(results, rag_status, report_path)

    print(f"✅ Generated report: {report_path}")


def generate_report(results, rag_status, report_path):
    """Generate a human-readable markdown report."""
    with open(report_path, "w", encoding="utf-8") as f:
        f.write("# Grok-CLI Q/A Test Results\n\n")
        f.write(f"**Generated**: {datetime.now().isoformat()}\n\n")

        f.write("## RAG Status\n\n")
        f.write("```\n")
        f.write(rag_status)
        f.write("\n```\n\n")

        f.write("## Questions & Answers\n\n")
        for i, item in enumerate(results):
            f.write(f"### Question {i + 1}: {item['question_id']}\n\n")

            if item["system_instruction"]:
                f.write("**System Instruction**:\n")
                f.write(f"> {item['system_instruction']}\n\n")

            f.write("**Question**:\n")
            f.write(f"> {item['question']}\n\n")

            result = item["result"]

            if "error" in result:
                f.write(f"**Error**: {result['error']}\n\n")
            elif not result["success"]:
                f.write(
                    f"**Failed** (exit code: {result.get('returncode', 'unknown')})\n\n"
                )
            else:
                f.write(f"**Success** (time: {result.get('elapsed_time', 0):.2f}s)\n\n")

                f.write("**Response**:\n")
                f.write("```\n")
                f.write(result.get("stdout", "").strip())
                f.write("\n```\n\n")

                if result.get("stderr"):
                    f.write("**Stderr**:\n")
                    f.write("```\n")
                    f.write(result.get("stderr", "").strip())
                    f.write("\n```\n\n")

            f.write("---\n\n")

        # Summary
        f.write("## Summary\n\n")
        successful = sum(1 for item in results if item["result"].get("success", False))
        f.write(f"- **Total questions**: {len(results)}\n")
        f.write(f"- **Successful**: {successful}\n")
        f.write(f"- **Failed**: {len(results) - successful}\n")

        if successful > 0:
            avg_time = (
                sum(
                    item["result"].get("elapsed_time", 0)
                    for item in results
                    if item["result"].get("success", False)
                )
                / successful
            )
            f.write(f"- **Average response time**: {avg_time:.2f}s\n")


if __name__ == "__main__":
    main()
