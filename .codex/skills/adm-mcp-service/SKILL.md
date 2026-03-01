---
name: adm-mcp-service
description: Run adm as an MCP server (stdio or HTTP) and install it as a service on Windows or Linux.
---

# adm-mcp-service

`adm` can run an MCP server that exposes RAG tools.

## Modes

- **Stdio (spawned by a client):** `tools/adm.exe --mcp`
- **HTTP (service-friendly):** `tools/adm.exe --mcp-http [host] [port]` (default: `127.0.0.1 7990`, endpoint: `POST /mcp`)

Both require `adm_config.json` (or `ADM_CONFIG_PATH`).

## Wire into Codex (MCP client)

Codex can launch `adm` as a stdio MCP server and call the RAG tools through it.

- Add server (writes to `~/.codex/config.toml`):
  - `codex mcp add adid_rag --env ADM_CONFIG_PATH=<abs_path_to_config> -- <abs_path_to_adm.exe> --mcp`
- Example (Windows):
  - `codex mcp add adid_rag --env ADM_CONFIG_PATH=D:\\zPython\\ADID_Python\\adm_config.local.json -- D:\\zPython\\ADID_Python\\tools\\adm.exe --mcp`
- Verify:
  - `codex mcp list`
  - `codex mcp get adid_rag`

## Windows (service)

Install (Admin PowerShell):

- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\\install_adm_mcp_service_windows.ps1 -RepoRoot <repo> -ConfigPath <repo>\\adm_config.json -Port 7990`

Check:

- `sc.exe query ADID_ADM_MCP`

## Linux (systemd service)

Install:

- `sudo ./scripts/install_adm_mcp_service_linux.sh /abs/repo_root /abs/adm_config.json 7990`

Check:

- `systemctl status adid-adm-mcp.service --no-pager`
