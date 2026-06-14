import "./globals.css";
import { fontDisplay, fontBody, fontMono } from "@/lib/fonts";
import { SolanaWalletProviders } from "@/lib/solana/wallet-providers";
import { Toaster } from "sonner";
import NextTopLoader from "nextjs-toploader";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      className={`${fontDisplay.variable} ${fontBody.variable} ${fontMono.variable}`}
    >
      <head>
        {/* Set the theme before paint to avoid a flash of the wrong palette. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(localStorage.getItem('mimir-theme')!=='light')document.documentElement.classList.add('dark');}catch(e){document.documentElement.classList.add('dark');}})();`,
          }}
        />
      </head>
      <body className="overflow-x-hidden">
        <NextTopLoader
          color="#22D3EE"
          height={2}
          showSpinner={false}
          shadow={false}
        />
        <SolanaWalletProviders>
          {children}
          <Toaster
            position="bottom-center"
            theme="dark"
            toastOptions={{
              style: {
                background: "#18181B",
                border: "1px solid #27272A",
                color: "#FAFAFA",
                borderRadius: 16,
                fontFamily: "var(--font-body)",
              },
            }}
          />
        </SolanaWalletProviders>
      </body>
    </html>
  );
}
