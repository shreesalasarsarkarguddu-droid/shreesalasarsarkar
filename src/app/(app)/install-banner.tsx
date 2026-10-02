"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
const DISMISS_KEY = "install-banner-dismissed";

/** Offers "Install app" when the browser allows it (Android Chrome / desktop Chrome / Edge), or the iPhone steps. */
export function InstallBanner() {
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      /* storage blocked: just show the banner */
    }
    if (standalone || dismissed) return;

    const onPrompt = (e: Event) => {
      e.preventDefault(); // keep it for our own button
      setEvent(e as InstallEvent);
      setHidden(false);
    };
    const onInstalled = () => setHidden(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    // iPhone/iPad Safari never fires beforeinstallprompt - show the manual steps instead
    const iosTimer = /iphone|ipad|ipod/i.test(navigator.userAgent)
      ? setTimeout(() => {
          setIos(true);
          setHidden(false);
        }, 0)
      : undefined;
    return () => {
      clearTimeout(iosTimer);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  function dismiss() {
    setHidden(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  async function install() {
    if (!event) return;
    await event.prompt();
    const { outcome } = await event.userChoice;
    if (outcome === "accepted") setHidden(true);
    setEvent(null);
  }

  if (hidden) return null;
  return (
    <div className="mb-3 flex items-center gap-3 rounded-xl bg-blue-700 px-4 py-3 text-white print:hidden">
      <Image src="/icons/icon-192.png" alt="" width={36} height={36} unoptimized className="h-9 w-9 shrink-0 rounded-lg ring-1 ring-white/30" />
      <p className="min-w-0 flex-1 text-sm leading-snug">
        {ios ? (
          <>
            Install the app: tap <b>Share</b> then <b>Add to Home Screen</b>.
          </>
        ) : (
          <>Install this app on your phone for quick access.</>
        )}
      </p>
      {!ios && event && (
        <button onClick={install} className="h-10 shrink-0 rounded-lg bg-white px-4 text-sm font-bold text-blue-800">
          Install
        </button>
      )}
      <button onClick={dismiss} aria-label="Hide" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-xl text-white/80 hover:bg-white/10">
        ×
      </button>
    </div>
  );
}
