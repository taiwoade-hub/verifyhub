import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "VerifyHub — Build it. Run it. Let Kane verify it.",
  description:
    "VerifyHub turns code into a live application and lets AI verify that it actually works. Isolated runners, live browser verification, structured evidence, Telegram notifications.",
  keywords: ["VerifyHub", "verification", "AI", "Kane", "CI", "Docker", "ngrok"],
  authors: [{ name: "VerifyHub" }],
  icons: {
    icon: "/logo.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#0d0d10",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`antialiased bg-background text-foreground`}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
