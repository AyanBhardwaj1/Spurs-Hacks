import type { Metadata } from "next";
import "@/components/landing/landing.css";
import "@/components/studio/studio.css";

export const metadata: Metadata = { title: "Studio · Rundown" };

// The studio is the product's working surface, so it always uses the dark theme, like an edit suite.
export default function StudioLayout({ children }: LayoutProps<"/studio">) {
  return <div className="studio theme-dark">{children}</div>;
}
