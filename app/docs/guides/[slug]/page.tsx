import { notFound } from "next/navigation";
import { GuidePage } from "@/components/docs/GuidePage";
import { listGuides, readGuide } from "@/lib/guides";

export default async function Guide({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [guide, guides] = await Promise.all([readGuide(slug), listGuides()]);
  if (!guide) notFound();
  return <GuidePage guide={guide} guides={guides} />;
}
