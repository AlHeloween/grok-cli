#!/usr/bin/env python3
import csv
import sys
import os
import json
import random

# Increase field size limit
csv.field_size_limit(10 * 1024 * 1024)  # 10MB limit

csv_path = os.path.join(os.path.dirname(__file__), "..", "test_data", "examples.csv")
output_dir = os.path.join(os.path.dirname(__file__), "extracted_docs")
mapping_path = os.path.join(os.path.dirname(__file__), "doc_question_mapping.json")
questions_path = os.path.join(os.path.dirname(__file__), "selected_questions.json")

print(f"Reading CSV from: {csv_path}")
print(f"File size: {os.path.getsize(csv_path)} bytes")

# Create output directory
os.makedirs(output_dir, exist_ok=True)

# Parse CSV
documents = []
questions = []

with open(csv_path, "r", encoding="utf-8") as f:
    reader = csv.DictReader(f)

    for i, row in enumerate(reader):
        doc_id = f"doc_{i + 1:03d}"
        context = row["context_document"]
        question = row["user_request"]

        # Save document
        doc_path = os.path.join(output_dir, f"{doc_id}.txt")
        with open(doc_path, "w", encoding="utf-8") as doc_file:
            doc_file.write(context)

        documents.append(
            {
                "id": doc_id,
                "path": doc_path,
                "question": question,
                "system_instruction": row["system_instruction"],
            }
        )

        questions.append(
            {
                "id": doc_id,
                "question": question,
                "system_instruction": row["system_instruction"],
            }
        )

        if (i + 1) % 100 == 0:
            print(f"Processed {i + 1} records...")

print(f"\nTotal records processed: {len(documents)}")

# Save mapping
with open(mapping_path, "w", encoding="utf-8") as f:
    json.dump(documents, f, indent=2, ensure_ascii=False)

print(f"Saved document mapping to: {mapping_path}")

# Randomly select 5 questions
random.seed(42)  # For reproducibility
selected = random.sample(questions, min(5, len(questions)))

with open(questions_path, "w", encoding="utf-8") as f:
    json.dump(selected, f, indent=2, ensure_ascii=False)

print(f"\nSelected {len(selected)} questions:")
for i, q in enumerate(selected):
    print(f"{i + 1}. ID: {q['id']}")
    print(f"   Question: {q['question'][:100]}...")
    print()

print(f"Saved selected questions to: {questions_path}")
