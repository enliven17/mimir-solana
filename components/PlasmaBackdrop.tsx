"use client";

/**
 * Theme-aware Plasma backdrop. The WebGL palette is a light purple gradient
 * that only suits the light theme — in dark mode we hide it entirely so the
 * page stays a clean near-black (no purple wash). Reacts live to the toggle.
 */
import { useEffect, useState } from "react";
import Plasma from "./Plasma";

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

  if (dark) return null;

  return (
    <Plasma
      color="#9945FF"
      speed={0.9}
      scale={1}
      opacity={0.8}
      mouseInteractive={false}
    />
  );
}
