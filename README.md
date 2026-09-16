# Agent Skills MCP

Minimal stdio MCP server for discovering a private Agent Skills library without putting its catalog in the model context.

## Run

Requires Node 22.5+ (for `node:sqlite`). With Nix, `nix develop` provides Node and TypeScript; build before using `nix run .`.

```sh
npm install
npm run build
AGENT_SKILLS_DIR="$HOME/.local/share/agent-skills" npm start
```

The default library is `${XDG_DATA_HOME:-~/.local/share}/agent-skills/`. Set `AGENT_SKILLS_DIR` to override it. The SQLite index is a rebuildable cache in `${XDG_CACHE_HOME:-~/.cache}/agent-skills.sqlite`.

Configure the resulting command as an MCP server in Pi, Codex, or another MCP client:

```json
{
  "mcpServers": {
    "agent-skills": {
      "command": "node",
      "args": ["/path/to/agent-skills-mcp/dist/index.js"]
    }
  }
}
```

The server exposes only three tools:

1. `search("den forwarder")` — returns a few ranked matches.
2. `load("den")` — returns `den/SKILL.md`.
3. `read("den", "references/forwarders.md")` — returns a selected reference.

The filesystem remains the source of truth. The index is refreshed when skill files change. Invalid skills and paths outside a skill directory are rejected.
