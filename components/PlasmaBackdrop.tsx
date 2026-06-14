"use client";

/**
 * Theme-aware Plasma backdrop. Same purple plasma in both themes, but the
 * gradient floor swaps: light mode ramps white→purple, dark mode ramps
 * near-black→purple so the page stays dark while the plasma still glows.
 * Reacts live to the theme toggle via a class observer.
 */
import { useEffect, useState } from "react";
import Plasma from "./Plasma";

const LIGHT_PAL: [string, string, string, string] = [
  "#FAF7FF",
  "#EFE6FF",
  "#DCC9FF",
  "#9945FF",
];

// Near-black base → deep purple → bright Solana purple.
const DARK_PAL: [string, string, string, string] = [
  "#070709",
  "#1C1030",
  "#5B2BAE",
  "#A970FF",
];

export default function PlasmaBackdrop() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const el = document.documentElement;
    const update = () => setDark(el.classList.contains("dark"));
    update();
    const obs = new MutationObserver(update);
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  return (
    <Plasma
      color="#9945FF"
      pal={dark ? DARK_PAL : LIGHT_PAL}
      speed={0.9}
      scale={1}
      opacity={dark ? 0.9 : 0.8}
      mouseInteractive={false}
    />
  );
}
