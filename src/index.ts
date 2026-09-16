import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

type Skill = { name: string; description: string; directory: string; body: string };

const skillsRoot = resolve(process.env.AGENT_SKILLS_DIR ?? join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "agent-skills"));
const indexPath = resolve(process.env.AGENT_SKILLS_INDEX ?? join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "agent-skills.sqlite"));
mkdirSync(join(indexPath, ".."), { recursive: true });
const db = new DatabaseSync(indexPath);
db.exec("DROP TABLE IF EXISTS skills; CREATE VIRTUAL TABLE skills USING fts5(name, description, content, body UNINDEXED, directory UNINDEXED)");
let fingerprint = "";

function frontmatter(body: string) {
  const match = body.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  const fields = new Map<string, string>();
  for (const line of match?.[1]?.split("\n") ?? []) {
    const field = line.match(/^([\w-]+):\s*["']?(.+?)["']?\s*$/);
    if (field) fields.set(field[1], field[2]);
  }
  return { name: fields.get("name"), description: fields.get("description") };
}

function files() {
  const result: string[] = [];
  for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = join(skillsRoot, entry.name);
    const skillFile = join(directory, "SKILL.md");
    try {
      if (statSync(skillFile).isFile()) result.push(skillFile);
    } catch { /* removed during scan */ }
  }
  return result;
}

function skillFiles(directory: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...skillFiles(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

function searchableFiles(skillFile: string, directory: string) {
  const references = join(directory, "references");
  return [skillFile, ...(existsSync(references) ? skillFiles(references) : [])];
}

function signature(paths: string[]) {
  return paths.flatMap(path => {
    try { return searchableFiles(path, join(skillsRoot, relative(skillsRoot, path).split(sep)[0])).map(file => `${file}:${statSync(file).mtimeMs}:${statSync(file).size}`); }
    catch { return []; }
  }).sort().join("|");
}

function rebuild(paths: string[]) {
  db.exec("DELETE FROM skills");
  const insert = db.prepare("INSERT INTO skills(name, description, content, body, directory) VALUES (?, ?, ?, ?, ?)");
  for (const skillFile of paths) {
    const body = readFileSync(skillFile, "utf8");
    const meta = frontmatter(body);
    if (!meta.name || !meta.description) continue;
    const directory = join(skillsRoot, relative(skillsRoot, skillFile).split(sep)[0]);
    const searchable = searchableFiles(skillFile, directory).map(file => readFileSync(file, "utf8")).join("\n");
    insert.run(meta.name, meta.description, searchable, body, directory);
  }
  fingerprint = signature(paths);
}

function sync() {
  let paths: string[] = [];
  try { paths = files(); } catch { return; }
  const next = signature(paths);
  if (next !== fingerprint) rebuild(paths);
}

function skill(name: string): Skill {
  sync();
  const row = db.prepare("SELECT name, description, body, directory FROM skills WHERE name = ?").get(name) as Skill | undefined;
  if (!row) throw new Error(`Unknown skill: ${name}`);
  return row;
}

function safeFile(name: string, path: string) {
  const root = realpathSync(skill(name).directory);
  const target = resolve(root, path);
  if (target !== root && !target.startsWith(root + sep)) throw new Error("Path escapes the skill directory");
  const real = realpathSync(target);
  if (real !== root && !real.startsWith(root + sep)) throw new Error("Path escapes the skill directory");
  if (!statSync(real).isFile()) throw new Error("Path is not a file");
  return real;
}

function text(value: unknown) { return { content: [{ type: "text" as const, text: String(value) }] }; }

const server = new McpServer({ name: "agent-skills", version: "0.1.0" });
server.registerTool("search", {
  description: "Search the private Agent Skills library and return the best matches.",
  inputSchema: { query: z.string().min(1), limit: z.number().int().min(1).max(10).optional() },
}, ({ query, limit = 5 }) => {
  sync();
  const terms = query.trim().split(/\s+/).map(term => `"${term.replaceAll('"', '""')}"`).join(" OR ");
  const rows = db.prepare("SELECT name, description, snippet(skills, 2, '[', ']', '…', 18) AS snippet, bm25(skills) AS score FROM skills WHERE skills MATCH ? ORDER BY score LIMIT ?").all(terms, limit) as Array<{ name: string; description: string; snippet: string }>;
  return text(JSON.stringify(rows));
});
server.registerTool("load", {
  description: "Load one Agent Skill's SKILL.md after search has identified it.",
  inputSchema: { skill: z.string().min(1) },
}, ({ skill: name }) => text(skill(name).body));
server.registerTool("read", {
  description: "Read a reference file from a previously selected Agent Skill.",
  inputSchema: { skill: z.string().min(1), path: z.string().min(1) },
}, ({ skill: name, path }) => text(readFileSync(safeFile(name, path), "utf8")));

await server.connect(new StdioServerTransport());
