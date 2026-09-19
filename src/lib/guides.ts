import { promises as fs } from "node:fs";
import path from "node:path";

const GUIDES_DIR = path.join(process.cwd(), "docs", "guides");

export interface GuideSummary {
  slug: string;
  title: string;
}

/** `# Guide: Build a Zealot…` → "Build a Zealot…". */
function titleOf(markdown: string, fallback: string): string {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading ? heading.replace(/^Guide:\s*/i, "") : fallback;
}

export async function listGuides(): Promise<GuideSummary[]> {
  const files = (await fs.readdir(GUIDES_DIR)).filter((f) => f.endsWith(".md")).sort();
  return Promise.all(
    files.map(async (file) => {
      const slug = file.replace(/\.md$/, "");
      return { slug, title: titleOf(await fs.readFile(path.join(GUIDES_DIR, file), "utf8"), slug) };
    })
  );
}

export async function readGuide(slug: string): Promise<(GuideSummary & { body: string }) | null> {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  try {
    const body = await fs.readFile(path.join(GUIDES_DIR, `${slug}.md`), "utf8");
    return { slug, title: titleOf(body, slug), body };
  } catch {
    return null;
  }
}
