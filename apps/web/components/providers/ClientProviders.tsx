'use client';

import dynamic from 'next/dynamic';

const WalletProvider = dynamic(
  () => import('./WalletProvider').then(mod => mod.WalletProvider),
  { ssr: false }
);

const Navbar = dynamic(
  () => import('../Navbar'),
  { ssr: false }
);

export function ClientProviders({ children }: { children: React.ReactNode }) {
  return (
    <WalletProvider>
      <Navbar />
      <main className="flex-1 w-full flex flex-col">
        {children}
      </main>
    </WalletProvider>
  );
}
