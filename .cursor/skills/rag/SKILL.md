---
name: rag
description: Index/query local repositories using adm RAG (adm_config.json + sqlite) and an embeddings HTTP endpoint.
---

# rag (adm RAG)

This skill covers the `adm --rag ...` and `adm --query ...` commands.

## Requirements

- `adm_config.json` must exist (or set `ADM_CONFIG_PATH` to an explicit path).
- An embeddings server must be reachable at `rag.embed.url` (default example: `http://127.0.0.1:7989/v1/embeddings`).
- Do not store API keys in JSON; store the key in the OS keyring via `tools/adm.exe --keyring set rag_embed_api_key` (key name comes from `rag.embed.api_key_env`).

## Commands

- Show settings: `tools/adm.exe --rag settings`
- List indexes: `tools/adm.exe --rag list`
- Index: `tools/adm.exe --rag index <index_name> <root1> [root2 ...]`
- Show indexed docs: `tools/adm.exe --rag docs <index_name> [limit]`
- Status: `tools/adm.exe --rag status <index_name>`
- Delete: `tools/adm.exe --rag delete <index_name>`
- Query: `tools/adm.exe --query <index_name> <request...>`

## Embeddings API (request/response)

- Request body is OpenAI-compatible:
  - `{"model":"text-embedding-embeddinggemma-300m-qat","input":"Some text to embed"}`
  - or `{"model":"...","input":["text1","text2"]}` (adm uses the list form for batching)
- If your server requires auth, adm sends `Authorization: Bearer <token>` (header/scheme configurable via `rag.embed.auth_header`/`rag.embed.auth_scheme` and the token loaded from OS keyring via `rag.embed.api_key_env`).

## Common queries (smoke)

After indexing docs, these are good “first queries” to validate wiring:

- `tools/adm.exe --query <index_name> "ADIDInstaller.json"`
- `tools/adm.exe --query <index_name> "keyring set rag_embed_api_key"`
- `tools/adm.exe --query <index_name> "codex mcp add adid_rag"`

## Windows-specific

- Set repo-local cache/temp at start of work:
  - cmd.exe: `call scripts\\dev_env_windows.cmd`
  - PowerShell: `. .\\scripts\\dev_env_windows.ps1`

## Linux-specific

- For service deployments, prefer MCP HTTP mode (`adm --mcp-http`) with a systemd unit and `Environment=ADM_CONFIG_PATH=...`.
