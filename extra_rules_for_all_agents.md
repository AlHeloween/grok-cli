1. Universal Document Header & Reproduce Block

Every document claiming a working state must include this exact YAML frontmatter and reproduce block at the top of the file (within the first 30 lines).
YAML

---
title: "Feature or Component Title"
owner: "team-or-person@organization.com"
status: "production" # Must be: production | test | execution | research | obsolete
surface: "canonical_surface_id"
last_verified: "YYYY-MM-DD"
tags: ["tag1", "tag2"]
related_code: 
  - "src/path/to/main_implementation.ext"
  - "scripts/path/to/entrypoint.sh"
summary: "A concise, one-line summary of the component."

# REQUIRED for 'production', 'test', or 'execution' status
reproduce:
  files:
    - "scripts/path/to/entrypoint.sh"
    - "src/path/to/binary_or_script.ext"
  commands:
    - "./scripts/entrypoint.sh --mode=test --input=data/test_input.json --out=logs/out.log"
  inputs:
    - "models/model_name.bin@sha256:abcdef123456..."
    - "data/test_input.json@sha256:0987654321..."
  expected_outputs:
    - "logs/out.log contains 'SUCCESS: 0 failures'"
---

2. The DOCINDEX.md Schema

This file sits at the repository root and acts as the ultimate automated source of truth. CI scripts should auto-generate or verify this index against the individual doc headers.
Markdown

# DOCINDEX (Auto-verified by CI)

## production_surfaces
- id: canonical_surface_id
  owner: "team-or-person@organization.com"
  entrypoints: ["scripts/entrypoint.sh"]
  canonical_docs: ["docs/PRODUCTION_README.md"]
  last_verified: YYYY-MM-DD
  contact: "ops-team@organization.com"

## research_surfaces
- id: experimental_feature_id
  owner: "research-team@organization.com"
  folder: "quarantine_or_experiments_folder"
  note: "Quarantine: Experimental probe; not for production use."

3. Pull Request Template (.github/PULL_REQUEST_TEMPLATE.md)

This forces developers to declare their impact on production surfaces and confirm they are following the reproducibility rules before they can even submit the PR.
Markdown

### What changed
- [Short summary of the architectural or code changes]

### Production surfaces impacted
- [Explicit file paths, e.g., scripts/entrypoint.sh, src/core/main.cpp, or NONE]

### Reproducibility & Documentation
- [ ] Reproduce block included/updated in relevant docs? (yes/no)
- [ ] Smoke-run results verified locally? (yes/no/NA)
- [ ] docs/PRODUCTION_README.md updated? (yes/no/NA)

### Research/Quarantine Promotion
- [ ] If citing a research document for a production change, have you included a `promotion.md` file? (yes/no/NA)
- Explain why this research doc is safe to reference for production: [Explanation]

4. Promotion Template (promotion.md)

When a feature graduates from research to production, it must be accompanied by this formal audit trail. The automated agent will reject promotions without it.
Markdown

# Promotion: [experimental_feature] -> production

- promoted_by: "user@organization.com"
- date: YYYY-MM-DD
- tests: ["smoke_test_suite_name", "integration_suite_name"]
- ci_runs: [URL_link_to_successful_CI_run]
- evidence: 
  - "ci/logs/smoke_test.log"
  - "verification_snapshot@sha256:..."
- owner_acceptance: "approving-team@organization.com"

Would you like me to generate the actual Python CI validator scripts (like the header checker or index generator) that the automated agent would use to enforce these templates?