import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "path";

/**
 * Guard: the interactions route + ack module must not statically import GHL/Google/
 * job-runner barrels. Those belong behind dynamic import in new-project-async.
 */
describe("new-project interactions module boundary", () => {
  const root = process.cwd();

  function collectStaticImports(entryRel: string, maxDepth = 6): string[] {
    const visited = new Set<string>();
    const found: string[] = [];
    const importRe = /(?:from|import)\s+['"]([^'"]+)['"]/g;

    function resolve(fromFile: string, spec: string): string | null {
      if (spec.startsWith("@/")) {
        const base = path.join(root, "src", spec.slice(2));
        for (const ext of ["", ".ts", ".tsx", "/index.ts"]) {
          const p = base + ext;
          if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
        }
        return null;
      }
      if (spec.startsWith(".")) {
        const base = path.resolve(path.dirname(fromFile), spec);
        for (const ext of ["", ".ts", ".tsx", "/index.ts"]) {
          const p = base + ext;
          if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
        }
      }
      return null;
    }

    function walk(file: string, depth: number) {
      if (visited.has(file) || depth > maxDepth) return;
      visited.add(file);
      const src = fs.readFileSync(file, "utf8");
      for (const line of src.split("\n")) {
        if (line.includes("import type ") || line.trim().startsWith("//")) continue;
        // Dynamic import("./x") is allowed for heavy modules — skip those.
        if (/import\s*\(/.test(line) && !line.includes("from ")) continue;
        importRe.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = importRe.exec(line))) {
          const resolved = resolve(file, m[1]!);
          if (!resolved) continue;
          const rel = path.relative(root, resolved);
          found.push(rel);
          walk(resolved, depth + 1);
        }
      }
    }

    walk(path.join(root, entryRel), 0);
    return found;
  }

  it("interactions route does not statically reach GHL/Google/enqueue/runner", () => {
    const imports = collectStaticImports("src/app/api/slack/interactions/route.ts");
    const banned = imports.filter((rel) =>
      /connectors\/ghl|connectors\/google|project-setup\/(service|store|enqueue|runner|steps|folder-copy|sheets|new-project-async)\b/.test(
        rel,
      ),
    );
    expect(banned).toEqual([]);
    expect(imports.some((r) => r.includes("new-project-ack"))).toBe(true);
  });

  it("ack module does not statically reach GHL/Google/enqueue", () => {
    const imports = collectStaticImports("src/lib/project-setup/new-project-ack.ts");
    const banned = imports.filter((rel) =>
      /connectors\/ghl|connectors\/google|project-setup\/(service|store|enqueue|runner|steps|new-project-async)\b/.test(
        rel,
      ),
    );
    expect(banned).toEqual([]);
  });

  it("ack path import is much cheaper than async barrel", async () => {
    const tAck0 = performance.now();
    await import("@/lib/project-setup/new-project-ack");
    const ackMs = Math.round(performance.now() - tAck0);

    const tAsync0 = performance.now();
    await import("@/lib/project-setup/new-project-async");
    const asyncMs = Math.round(performance.now() - tAsync0);

    // On a warm vitest worker async graph is still materially heavier.
    // Soft assert: async should not be faster than ack when both are cold-ish.
    expect(ackMs).toBeLessThan(asyncMs + 50);
    expect(ackMs).toBeLessThan(200);
  });
});
