"use client";
import { ConnectButton } from "@rainbow-me/rainbowkit";

export function WalletButton() {
  return (
    <ConnectButton.Custom>
      {({
        account,
        chain,
        openAccountModal,
        openChainModal,
        openConnectModal,
        authenticationStatus,
        mounted,
      }) => {
        const ready = mounted && authenticationStatus !== 'loading';
        const connected =
          ready &&
          account &&
          chain &&
          (!authenticationStatus ||
            authenticationStatus === 'authenticated');

        const buttonClass = "inline-flex h-9 items-center justify-center gap-1.5 rounded-full border border-white/8 bg-white/4 px-3 text-xs font-semibold uppercase tracking-[0.14em] text-primary transition-all duration-200 hover:border-primary/25 hover:bg-primary/10 hover:text-primary hover:shadow-[0_0_12px_rgba(78,222,163,0.08)] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 sm:px-4";

        return (
          <div
            {...(!ready && {
              'aria-hidden': true,
              'style': {
                opacity: 0,
                pointerEvents: 'none',
                userSelect: 'none',
              },
            })}
          >
            {(() => {
              if (!connected) {
                return (
                  <button onClick={openConnectModal} type="button" className={buttonClass}>
                    Connect Wallet
                  </button>
                );
              }

              if (chain.unsupported) {
                return (
                  <button onClick={openChainModal} type="button" className={buttonClass + " text-error hover:text-error hover:border-error/25 hover:bg-error/10 border-error/50"}>
                    Wrong network
                  </button>
                );
              }

              return (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={openChainModal}
                    style={{ display: 'flex', alignItems: 'center' }}
                    type="button"
                    className="hidden sm:inline-flex h-9 items-center justify-center gap-1.5 rounded-full border border-white/8 bg-white/4 px-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground transition-all duration-200 hover:border-white/20 hover:bg-white/10 hover:text-white active:scale-95"
                  >
                    {chain.hasIcon && (
                      <div
                        style={{
                          background: chain.iconBackground,
                          width: 16,
                          height: 16,
                          borderRadius: 999,
                          overflow: 'hidden',
                          marginRight: 4,
                        }}
                      >
                        {chain.iconUrl && (
                          <img
                            alt={chain.name ?? 'Chain icon'}
                            src={chain.iconUrl}
                            style={{ width: 16, height: 16 }}
                          />
                        )}
                      </div>
                    )}
                    {chain.name}
                  </button>

                  <button onClick={openAccountModal} type="button" className={buttonClass}>
                    {account.displayName}
                  </button>
                </div>
              );
            })()}
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}
