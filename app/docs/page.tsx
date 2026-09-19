import { DocsPage } from "@/components/docs/DocsPage";
import { listGuides } from "@/lib/guides";

export default async function Docs() {
  return <DocsPage guides={await listGuides()} />;
}
