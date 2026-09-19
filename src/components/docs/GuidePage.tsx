import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import { BookOpen, LayoutGrid, Swords } from "lucide-react";
import type { GuideSummary } from "@/lib/guides";
import styles from "./docs.module.css";

/** Guide images live in `public/guides/img/`; markdown references them as `img/...` so the file also previews on GitHub. */
function resolveSrc(src: string | Blob | undefined): string | undefined {
  return typeof src === "string" && src.startsWith("img/") ? `/guides/${src}` : (src as string | undefined);
}

export function GuidePage({ guide, guides }: { guide: GuideSummary & { body: string }; guides: GuideSummary[] }) {
  return (
    <div className={styles.page}>
      <div className={styles.topbar}>
        <BookOpen size={16} />
        <h1>BattleSim Docs</h1>
        <div className={styles.spacer} />
        <a href="/campaigns">
          <LayoutGrid size={14} /> Campaigns
        </a>
        <a href="/">
          <Swords size={14} /> Sandbox
        </a>
      </div>

      <div className={styles.layout}>
        <nav className={styles.nav}>
          <a href="/docs" className={styles.navItem}>← Reference</a>
          <span className={styles.navHeading}>Guides</span>
          {guides.map((g) => (
            <a key={g.slug} href={`/docs/guides/${g.slug}`} className={g.slug === guide.slug ? styles.navItemActive : styles.navItem}>
              {g.title}
            </a>
          ))}
        </nav>

        <main className={styles.content}>
          <article className={`${styles.section} ${styles.guide}`}>
            <Markdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeSlug]}
              components={{
                img: ({ src, alt }) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={resolveSrc(src)} alt={alt ?? ""} loading="lazy" />
                )
              }}
            >
              {guide.body}
            </Markdown>
          </article>
        </main>
      </div>
    </div>
  );
}
