"use client";

/**
 * Theme-aware Plasma backdrop. The WebGL palette is a light purple gradient,
 * so on dark mode we drop the opacity hard — otherwise the light plasma would
 * wash the dark page out. Reacts live to the theme toggle via a class observer.
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

  return (
    <Plasma
      color="#9945FF"
      speed={0.9}
      scale={1}
      opacity={dark ? 0.22 : 0.8}
      mouseInteractive={false}
    />
  );
}
