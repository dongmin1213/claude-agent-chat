import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Claude Agent Chat",
  description: "Web chat interface powered by Claude Agent SDK",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg-primary text-text-primary antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
