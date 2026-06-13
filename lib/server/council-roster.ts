/**
 * Server-side council roster: derives each persona's public address from the
 * admin secret (same derivation the worker uses) so the UI can map on-chain
 * challenger addresses back to a persona — without ever exposing a secret key.
 */
import { loadAgentKeypair, derivePersonaKeypair } from "@/lib/solana/keypair";
import { COUNCIL_PERSONAS } from "@/agents/council/personas";

export interface RosterEntry {
  slug: string;
  displayName: string;
  emoji: string;
  bio: string;
  archetype: string;
  address: string;
}

let cached: RosterEntry[] | null = null;

export function councilRoster(): RosterEntry[] {
  if (cached) return cached;
  let admin;
  try {
    admin = loadAgentKeypair();
  } catch {
    // No keypair available (e.g. web service without the secret) — roster
    // addresses are unknown, but the page can still render personas.
    return COUNCIL_PERSONAS.map((p) => ({
      slug: p.slug,
      displayName: p.displayName,
      emoji: p.emoji,
      bio: p.bio,
      archetype: p.archetype,
      address: "",
    }));
  }
  cached = COUNCIL_PERSONAS.map((p) => ({
    slug: p.slug,
    displayName: p.displayName,
    emoji: p.emoji,
    bio: p.bio,
    archetype: p.archetype,
    address: derivePersonaKeypair(admin, p.slug).publicKey.toBase58(),
  }));
  return cached;
}

/** address (base58) → persona, for labelling on-chain challengers. */
export function personaByAddress(): Record<string, RosterEntry> {
  const map: Record<string, RosterEntry> = {};
  for (const e of councilRoster()) if (e.address) map[e.address] = e;
  return map;
}
