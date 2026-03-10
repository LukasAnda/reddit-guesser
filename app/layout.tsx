import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Higher or Lower — Reddit Edition",
  description: "Guess which Reddit post has more upvotes",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <meta name="google-adsense-account" content="ca-pub-4421417503139987" />
        <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4421417503139987" crossOrigin="anonymous"></script>
      </head>
      <body className={`${geist.variable} antialiased`}>{children}</body>
    </html>
  );
}
