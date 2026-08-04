import type { Metadata } from "next";
import { Source_Sans_3 } from "next/font/google";
import { NavigationProgressHost } from "@/components/layout/navigation-progress-host";
import "./globals.css";

const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-source-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Baxter",
    template: "%s · Baxter",
  },
  description:
    "Baxter by Acton ADU — internal tools and knowledge platform. Property Research is the first Baxter tool for PEM preparation.",
  applicationName: "Baxter",
  other: {
    "baxter-app": "baxter",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${sourceSans.variable} antialiased`} data-baxter-app="baxter">
        <NavigationProgressHost />
        {children}
      </body>
    </html>
  );
}
