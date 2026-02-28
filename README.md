# Grok CLI

A conversational AI CLI tool powered by Grok with intelligent text editor capabilities and tool usage.

<img width="980" height="435" alt="Screenshot 2025-07-21 at 13 35 41" src="https://github.com/user-attachments/assets/192402e3-30a8-47df-9fc8-a084c5696e78" />

## Features

- **🤖 Conversational AI**: Natural language interface powered by Grok-3
- **📝 Smart File Operations**: AI automatically uses tools to view, create, and edit files
- **⚡ Bash Integration**: Execute shell commands through natural conversation
- **🔧 Automatic Tool Selection**: AI intelligently chooses the right tools for your requests
- **🚀 Morph Fast Apply**: Optional high-speed code editing at 4,500+ tokens/sec with 98% accuracy
- **🔌 MCP Tools**: Extend capabilities with Model Context Protocol servers (Linear, GitHub, etc.)
- **💬 Interactive UI**: Beautiful terminal interface built with Ink
- **🌍 Global Installation**: Install and use anywhere with `bun add -g @vibe-kit/grok-cli`

## Documentation

- **[Application scheme](docs/APPLICATION-SCHEME.md)** — Module map, file roles, and architecture (entry, UI, agent, Grok API, RAG, config, MCP, tools).
- **[Agent overview](docs/AGENT.md)** — How the GrokAgent works: message flow, tools, RAG injection, config, and MCP.
- **[Settings guide](docs/settings.json.md)** — Every setting, its defaults, env overrides, and how to edit via `/config` or `grok config`.

## Installation

### Prerequisites
- Bun 1.0+ (or Node.js 18+ as fallback)
- Grok API key from X.AI
- (Optional, Recommended) Morph API key for Fast Apply editing

### Global Installation (Recommended)
```bash
bun add -g @vibe-kit/grok-cli
```

Or with npm (fallback):
```bash
npm install -g @vibe-kit/grok-cli
```

### Local Development
```bash
git clone <repository>
cd grok-cli
bun install
bun run build
bun link
```

## Setup

1. Get your Grok API key from [X.AI](https://x.ai)

2. Set up your API key (choose one method):

**Method 1: Environment Variable**
```bash
export GROK_API_KEY=your_api_key_here
```

**Method 2: .env File**
```bash
cp .env.example .env
# Edit .env and add your API key
```

**Method 3: Command Line Flag**
```bash
grok --api-key your_api_key_here
```

**Method 4: User Settings File**
Create `~/.grok/user-settings.json`:
```json
{
  "apiKey": "your_api_key_here"
}
```

3. (Optional, Recommended) Get your Morph API key from [Morph Dashboard](https://morphllm.com/dashboard/api-keys)

4. Set up your Morph API key for Fast Apply editing (choose one method):

**Method 1: Environment Variable**
```bash
export MORPH_API_KEY=your_morph_api_key_here
```

**Method 2: .env File**
```bash
# Add to your .env file
MORPH_API_KEY=your_morph_api_key_here
```

### Custom Base URL (Optional)

By default, the CLI uses `https://api.x.ai/v1` as the Grok API endpoint. You can configure a custom endpoint if needed (choose one method):

**Method 1: Environment Variable**
```bash
export GROK_BASE_URL=https://your-custom-endpoint.com/v1
```

**Method 2: Command Line Flag**
```bash
grok --api-key your_api_key_here --base-url https://your-custom-endpoint.com/v1
```

**Method 3: User Settings File**
Add to `~/.grok/user-settings.json`:
```json
{
  "apiKey": "your_api_key_here",
  "baseURL": "https://your-custom-endpoint.com/v1"
}
```

## Configuration Files

Grok CLI uses two types of configuration files to manage settings:

### User-Level Settings (`~/.grok/user-settings.json`)

This file stores **global settings** that apply across all projects. These settings rarely change and include:

- **API Key**: Your Grok API key
- **Base URL**: Custom API endpoint (if needed)
- **Default Model**: Your preferred model (e.g., `grok-code-fast-1`)
- **Available Models**: List of models you can use

**Example:**
```json
{
  "apiKey": "your_api_key_here",
  "baseURL": "https://api.x.ai/v1",
  "defaultModel": "grok-code-fast-1",
  "models": [
    "grok-code-fast-1",
    "grok-4-latest",
    "grok-3-latest",
    "grok-3-fast",
    "grok-3-mini-fast"
  ]
}
```

### Project-Level Settings (`.grok/settings.json`)

This file stores **project-specific settings** in your current working directory. It includes:

- **Current Model**: The model currently in use for this project
- **MCP Servers**: Model Context Protocol server configurations
- **RAG**: Optional local retrieval settings (see “Local RAG (sqlite-vector)” below)

**Example:**
```json
{
  "model": "grok-3-fast",
  "rag": {
    "enabled": false,
    "topK": 6
  },
  "mcpServers": {
    "linear": {
      "name": "linear",
      "transport": "stdio",
      "command": "npx",
      "args": ["@linear/mcp-server"]
    }
  }
}
```

### How It Works

1. **Global Defaults**: User-level settings provide your default preferences
2. **Project Override**: Project-level settings override defaults for specific projects
3. **Directory-Specific**: When you change directories, project settings are loaded automatically
4. **Fallback Logic**: Project model → User default model → System default (`grok-code-fast-1`)

This means you can have different models for different projects while maintaining consistent global settings like your API key.

## Local RAG (sqlite-vector)

Grok CLI can optionally retrieve relevant code snippets from your project and inject them into the system context before each response (RAG).

### Enable RAG for a project

1. Add to your project’s `.grok/settings.json`:

```json
{
  "rag": {
    "enabled": true,
    "topK": 6
  }
}
```

2. Build the local index:

```bash
grok rag index
```

3. Check status:

```bash
grok rag status
```

### Interactive RAG management in chat

You can also manage RAG directly from the interactive chat interface using the `/rag` command:

- Type `/rag` to open the RAG management menu
- Browse indexed chunks with pagination (`list`)
- Search semantically across indexed content (`search`)
- Delete chunks by path or pattern (`delete`)
- Export/import MakerAI JSON (`export`, `import`)
- Open GUI instructions (`gui`)

All RAG settings can be configured via `/config` → RAG category.

### Optional: index PDFs/DOCX/PPTX/XLSX via sqlite-rag (Python)

If you want to index more than plain source/text files, you can enable the **sqlite-rag extractor**. This uses Python to convert supported file types into text (via `markitdown`), then stores embeddings in the same `.grok/rag.db` sqlite-vector index.

1. Install Python deps (one of):

```bash
python -m pip install sqlite-rag
# or (minimal)
python -m pip install markitdown
```

2. Enable extractor for this project:

```bash
grok config set project.rag.extractor sqlite-rag
# optional: choose python command explicitly
grok config set project.rag.python python
```

3. Re-index:

```bash
grok rag index --extractor sqlite-rag
```

Env overrides (optional): `GROK_RAG_EXTRACTOR=sqlite-rag`, `GROK_RAG_PYTHON=python`.

### Optional: MakerAI GUI (import/export)

If you want a GUI to browse/edit your vector content, you can export the current `.grok/rag.db` into MakerAI's `RAGVector` JSON format, edit/browse it in MakerAI, then import it back.

You can also launch the vendored MakerAI-based editor (`RagManager.exe`) via:

```bash
grok rag gui
```

This command exports to `.grok/makerai-ragvector.json` and opens the editor with **Refresh**/**Apply** buttons that call back into `grok rag export-makerai` / `grok rag import-makerai`.

```bash
# Export current project's rag.db to MakerAI JSON
grok rag export-makerai -o makerai-ragvector.json

# Import MakerAI JSON into current project's rag.db (append)
grok rag import-makerai makerai-ragvector.json

# Import and replace existing chunks
grok rag import-makerai makerai-ragvector.json --replace
```

If you vendor MakerAI into this repo under `MakerAI/`, you can build its runtime packages and a console demo with Delphi `dcc64`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-makerai.ps1
```

Outputs go to `MakerAI/_build/win64/` (demo EXE in `MakerAI/_build/win64/bin/`).

Note: Close `RagManager.exe` before running the build script, otherwise Delphi may fail with “Could not create output file …\\RagManager.exe”.

### Ignore files

Optionally create `.grok/ragignore` (one rule per line). In v1, rules are simple **substring matches** against relative paths.

### RAG DB persistence (Node/Bun)

`@sqliteai/sqlite-wasm` runs SQLite in WebAssembly and does not mount a native Node filesystem VFS by default. To keep `.grok/rag.db` persistent across runs, Grok CLI:

- Opens an in-memory DB
- Deserializes from `.grok/rag.db` if it exists
- Exports the DB back to `.grok/rag.db` on `VectorDb.close()` when mutated

Avoid concurrent writers (two processes opening the same project RAG DB at once) because the last writer wins.

### Embeddings configuration

By default, embeddings use the same API key/base URL as chat (`GROK_API_KEY` / `GROK_BASE_URL`) and model `text-embedding-3-small`.

- Override embeddings endpoint: `GROK_EMBEDDINGS_BASE_URL`
- Override embeddings model: `GROK_EMBEDDINGS_MODEL`

### Optional: k-medoids for more diverse context

By default the retriever returns the top-k nearest chunks. For more diverse, less redundant context you can enable **k-medoids**: the retriever fetches a larger candidate set and picks k representative chunks.

- **In chat**: `/config` → RAG → enable **Use k-medoids** (and optionally set **Candidate count**).
- **CLI**: `grok config set project.rag.useKMedoids true` and optionally `project.rag.candidateCount 20`.
- **JSON**: In `.grok/settings.json`, set `"rag": { "useKMedoids": true, "candidateCount": 20 }` (alongside `enabled`, `topK`, etc.).

All RAG keys and defaults are documented in **`docs/settings.json.md`**.

### License note

Local RAG uses `@sqliteai/sqlite-wasm` (bundles sqlite-vector). It is licensed under **Elastic License 2.0** (non-production use permitted). For production/managed service use, a commercial license may be required.

### Using Other API Providers

**Important**: Grok CLI uses **OpenAI-compatible APIs**. You can use any provider that implements the OpenAI chat completions standard.

**Popular Providers**:
- **X.AI (Grok)**: `https://api.x.ai/v1` (default)
- **OpenAI**: `https://api.openai.com/v1`
- **OpenRouter**: `https://openrouter.ai/api/v1`
- **Groq**: `https://api.groq.com/openai/v1`

**Example with OpenRouter**:
```json
{
  "apiKey": "your_openrouter_key",
  "baseURL": "https://openrouter.ai/api/v1",
  "defaultModel": "anthropic/claude-3.5-sonnet",
  "models": [
    "anthropic/claude-3.5-sonnet",
    "openai/gpt-4o",
    "meta-llama/llama-3.1-70b-instruct"
  ]
}
```

## Usage

### Interactive Mode

Start the conversational AI assistant:
```bash
grok
```

Or specify a working directory:
```bash
grok -d /path/to/project
```

### Headless Mode

Process a single prompt and exit (useful for scripting and automation):
```bash
grok --prompt "show me the package.json file"
grok -p "create a new file called example.js with a hello world function"
grok --prompt "run bun test and show me the results" --directory /path/to/project
grok --prompt "complex task" --max-tool-rounds 50  # Limit tool usage for faster execution
```

This mode is particularly useful for:
- **CI/CD pipelines**: Automate code analysis and file operations
- **Scripting**: Integrate AI assistance into shell scripts
- **Terminal benchmarks**: Perfect for tools like Terminal Bench that need non-interactive execution
- **Batch processing**: Process multiple prompts programmatically

### Tool Execution Control

By default, Grok CLI allows up to 400 tool execution rounds to handle complex multi-step tasks. You can control this behavior:

```bash
# Limit tool rounds for faster execution on simple tasks
grok --max-tool-rounds 10 --prompt "show me the current directory"

# Increase limit for very complex tasks (use with caution)
grok --max-tool-rounds 1000 --prompt "comprehensive code refactoring"

# Works with all modes
grok --max-tool-rounds 20  # Interactive mode
grok git commit-and-push --max-tool-rounds 30  # Git commands
```

**Use Cases**:
- **Fast responses**: Lower limits (10-50) for simple queries
- **Complex automation**: Higher limits (500+) for comprehensive tasks
- **Resource control**: Prevent runaway executions in automated environments

### Model Selection

You can specify which AI model to use with the `--model` parameter or `GROK_MODEL` environment variable:

**Method 1: Command Line Flag**
```bash
# Use Grok models
grok --model grok-code-fast-1
grok --model grok-4-latest
grok --model grok-3-latest
grok --model grok-3-fast

# Use other models (with appropriate API endpoint)
grok --model gemini-2.5-pro --base-url https://api-endpoint.com/v1
grok --model claude-sonnet-4-20250514 --base-url https://api-endpoint.com/v1
```

**Method 2: Environment Variable**
```bash
export GROK_MODEL=grok-code-fast-1
grok
```

**Method 3: User Settings File**
Add to `~/.grok/user-settings.json`:
```json
{
  "apiKey": "your_api_key_here",
  "defaultModel": "grok-code-fast-1"
}
```

**Model Priority**: `--model` flag > `GROK_MODEL` environment variable > user default model > system default (grok-code-fast-1)

### Command Line Options

```bash
grok [options]

Options:
  -V, --version          output the version number
  -d, --directory <dir>  set working directory
  -k, --api-key <key>    Grok API key (or set GROK_API_KEY env var)
  -u, --base-url <url>   Grok API base URL (or set GROK_BASE_URL env var)
  -m, --model <model>    AI model to use (e.g., grok-code-fast-1, grok-4-latest) (or set GROK_MODEL env var)
  -p, --prompt <prompt>  process a single prompt and exit (headless mode)
  --max-tool-rounds <rounds>  maximum number of tool execution rounds (default: 400)
  -h, --help             display help for command
```

### Custom Instructions

You can provide custom instructions to tailor Grok's behavior to your project or globally. Grok CLI supports both project-level and global custom instructions.

#### Project-Level Instructions

Create a `.grok/GROK.md` file in your project directory to provide instructions specific to that project:

```bash
mkdir .grok
```

Create `.grok/GROK.md` with your project-specific instructions:
```markdown
# Custom Instructions for This Project

Always use TypeScript for any new code files.
When creating React components, use functional components with hooks.
Prefer const assertions and explicit typing over inference where it improves clarity.
Always add JSDoc comments for public functions and interfaces.
Follow the existing code style and patterns in this project.
```

#### Global Instructions

For instructions that apply across all projects, create `~/.grok/GROK.md` in your home directory:

```bash
mkdir -p ~/.grok
```

Create `~/.grok/GROK.md` with your global instructions:
```markdown
# Global Custom Instructions for Grok CLI

Always prioritize code readability and maintainability.
Use descriptive variable names and add comments for complex logic.
Follow best practices for the programming language being used.
When suggesting code changes, consider performance implications.
```

#### Priority Order

Grok will load custom instructions in the following priority order:
1. **Project-level** (`.grok/GROK.md` in current directory) - takes highest priority
2. **Global** (`~/.grok/GROK.md` in home directory) - fallback if no project instructions exist

If both files exist, project instructions will be used. If neither exists, Grok operates with its default behavior.

The custom instructions are added to Grok's system prompt and influence its responses across all interactions in the respective context.

## Morph Fast Apply (Optional)

Grok CLI supports Morph's Fast Apply model for high-speed code editing at **4,500+ tokens/sec with 98% accuracy**. This is an optional feature that provides lightning-fast file editing capabilities.

**Setup**: Configure your Morph API key following the [setup instructions](#setup) above.

### How It Works

When `MORPH_API_KEY` is configured:
- **`edit_file` tool becomes available** alongside the standard `str_replace_editor`
- **Optimized for complex edits**: Use for multi-line changes, refactoring, and large modifications
- **Intelligent editing**: Uses abbreviated edit format with `// ... existing code ...` comments
- **Fallback support**: Standard tools remain available if Morph is unavailable

**When to use each tool:**
- **`edit_file`** (Morph): Complex edits, refactoring, multi-line changes
- **`str_replace_editor`**: Simple text replacements, single-line edits

### Example Usage

With Morph Fast Apply configured, you can request complex code changes:

```bash
grok --prompt "refactor this function to use async/await and add error handling"
grok -p "convert this class to TypeScript and add proper type annotations"
```

The AI will automatically choose between `edit_file` (Morph) for complex changes or `str_replace_editor` for simple replacements.

## MCP Tools

Grok CLI supports MCP (Model Context Protocol) servers, allowing you to extend the AI assistant with additional tools and capabilities.

### Adding MCP Tools

#### Add a custom MCP server:
```bash
# Add an stdio-based MCP server
grok mcp add my-server --transport stdio --command "bun" --args server.js

# Add an HTTP-based MCP server
grok mcp add my-server --transport http --url "http://localhost:3000"

# Add with environment variables
grok mcp add my-server --transport stdio --command "python" --args "-m" "my_mcp_server" --env "API_KEY=your_key"
```

#### Add from JSON configuration:
```bash
grok mcp add-json my-server '{"command": "bun", "args": ["server.js"], "env": {"API_KEY": "your_key"}}'
```

### Linear Integration Example

To add Linear MCP tools for project management:

```bash
# Add Linear MCP server
grok mcp add linear --transport sse --url "https://mcp.linear.app/sse"
```

This enables Linear tools like:
- Create and manage Linear issues
- Search and filter issues
- Update issue status and assignees
- Access team and project information

### Managing MCP Servers

```bash
# List all configured servers
grok mcp list

# Test server connection
grok mcp test server-name

# Remove a server
grok mcp remove server-name
```

### Available Transport Types

- **stdio**: Run MCP server as a subprocess (most common)
- **http**: Connect to HTTP-based MCP server
- **sse**: Connect via Server-Sent Events

Note: `streamable_http` transport is not supported by Grok CLI.

## Development

```bash
# Install dependencies
bun install

# Development mode
bun run dev

# Build project
bun run build

# Run linter
bun run lint

# Type check
bun run typecheck

# Run tests
bun run test
```

### Testing

Tests use [Vitest](https://vitest.dev/). Run the full suite with `bun run test` (or `npm run test`). Watch mode is available with `bun run test:watch`. For a coverage report, run `bun run test:coverage`; a terminal summary and an HTML report in `coverage/` are generated. Current coverage includes:

- **Utils**: `token-counter` (Grok model encoding, token counts), `text-utils` (insert/delete/move helpers), `clipboard-image` (sync paste behavior in CI)
- **Agent**: System prompt and tool execution are in separate modules (`src/agent/system-prompt.ts`, `src/agent/tool-executor.ts`) and can be unit-tested in isolation

CI runs tests on push and pull requests to `main` and `develop`.

### Themes

Grok CLI ships with VS Code-inspired presets:

- `vscode-dark-plus`
- `vscode-light-plus`
- `vscode-high-contrast`
- `vscode-high-contrast-light`
- `vscode-github-dark`
- `vscode-github-light`
- `vscode-monokai`
- `vscode-quiet-light`

You can switch themes in chat with:

```text
/theme
/theme vscode-high-contrast
```

Or set a theme before launch:

```bash
GROK_THEME=vscode-dark-plus grok
grok --theme vscode-high-contrast
```

Theme choice is also persisted in `~/.grok/user-settings.json`.

## Architecture

- **Agent**: Core command processing and execution logic
- **Tools**: Text editor and bash tool implementations
- **UI**: Ink-based terminal interface components
- **Types**: TypeScript definitions for the entire system

## Troubleshooting

### Can't type in the input (only Shift+Tab works)

Some Windows terminals can deliver printable keys to Ink with `key.meta=true` and/or with an empty `inputChar`, which can prevent Grok CLI from inserting typed characters.

- Try the latest version first (this repo includes a fix to accept printable `key.sequence`/`key.name` characters even when `inputChar` is empty).
- If you see key events in the debug log but `inputLen` never changes, the usual cause is a special-key handler accidentally swallowing all input (for this repo, that was fixed by making `onSpecialKey` synchronous except for paste handling).
- To capture what Ink is receiving, run with:

```bash
# macOS/Linux (bash/zsh)
GROK_DEBUG_INPUT=1 grok

# Windows PowerShell (optional custom path)
$env:GROK_DEBUG_INPUT=1; $env:GROK_DEBUG_INPUT_FILE=\"$PWD\\logs\\input_debug.jsonl\"; grok

# Windows cmd.exe
set GROK_DEBUG_INPUT=1 && grok
```

This shows a debug line under the footer and also appends JSONL events to `logs/input_debug.jsonl` (override path with `GROK_DEBUG_INPUT_FILE`). Attach the JSONL file when reporting input issues.

### Automating TUI input on Windows (cmd_runner)

If you need to reproduce a typing bug or script a TUI interaction, run Grok in the default cmd_runner **real console** mode and inject keystrokes:

```powershell
$run_id = (python .\cmd_runner.py start --timeout-s 60 --env GROK_API_KEY=foo -- bun run dev).Trim()
python .\cmd_runner.py send $run_id --text "/help" --enter
python .\cmd_runner.py send $run_id --text "exit" --enter
python .\cmd_runner.py wait $run_id --timeout-s 30
```

Note: Ink TUIs often render using the terminal alternate screen buffer, so `stdout.log` may not contain the visible UI; prefer `GROK_DEBUG_INPUT=1` and the JSONL log for reproducible key events.

## License

MIT

<!-- ADID_ROLLBACK (from adm.exe)
  SDID_ROLLBACK {
    "target_file": "D:\\zPython\\grok-cli\\README.md"
    "update_script": "adm.exe"
    "backup_path": "D:\\zPython\\grok-cli\\README.md.backup_20260217T225044_137695"
    "created_at": "2026-02-17T14:50:44.155184+00:00"
    "backup_hash": "c142ffd16952c0a89871b7303d6274c7"
    "new_hash": "aa630b6469274cf07be9ccbea520606a"
    "goal_id": "readme_makerai_build_close_note"
    "semantics": "Add note about closing RagManager before rebuild to avoid locked output exe."
    "update_attrs": {"relative_path": "README.md", "update_type": "text", "mode": "replace", "encoding": "utf-8", "find_pattern": null, "find_text": "Outputs go to `MakerAI/_build/win64/` (demo EXE in `MakerAI/_build/win64/bin/`).", "replace_present": true}
    "restore_cmd": "uv run adm \u002d\u002drollback \"D:\\zPython\\grok-cli\\README.md\""
  }
-->
