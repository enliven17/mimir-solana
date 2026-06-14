/**
 * World Cup 2026 themed claim drafting for the market-creator.
 *
 * We're in the middle of the tournament, so alongside the crypto price claims
 * the creator opens football markets: match results, goal totals, and star
 * players to score. Resolution evidence is a web search the oracle scrapes
 * after the deadline (the oracle refunds if the result isn't yet decidable).
 */

export const WC_TEAMS = [
  "Argentina", "Brazil", "France", "England", "Spain", "Germany",
  "Portugal", "Netherlands", "USA", "Mexico", "Croatia", "Belgium",
  "Uruguay", "Morocco", "Italy", "Japan",
];

export interface WcPlayer {
  name: string;
  team: string;
}

export const WC_PLAYERS: WcPlayer[] = [
  { name: "Lionel Messi", team: "Argentina" },
  { name: "Kylian Mbappé", team: "France" },
  { name: "Vinícius Júnior", team: "Brazil" },
  { name: "Jude Bellingham", team: "England" },
  { name: "Harry Kane", team: "England" },
  { name: "Cristiano Ronaldo", team: "Portugal" },
  { name: "Lamine Yamal", team: "Spain" },
  { name: "Jamal Musiala", team: "Germany" },
  { name: "Rodrygo", team: "Brazil" },
  { name: "Antoine Griezmann", team: "France" },
  { name: "Christian Pulisic", team: "USA" },
  { name: "Julián Álvarez", team: "Argentina" },
];

export interface WcDraft {
  question: string;
  creatorPosition: string;
  counterPosition: string;
  category: string;
  resolutionUrl: string;
  label: string;
}

/** A search page the oracle can scrape for the result after the deadline. */
function searchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

function pick<T>(arr: T[]): T {
  // No Math.random ban here (this is a worker, not a workflow script).
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickTwoTeams(): [string, string] {
  const a = pick(WC_TEAMS);
  let b = pick(WC_TEAMS);
  while (b === a) b = pick(WC_TEAMS);
  return [a, b];
}

type Template = () => WcDraft;

const TEMPLATES: Template[] = [
  // Match winner
  () => {
    const [home, away] = pickTwoTeams();
    return {
      label: `${home} vs ${away} — winner`,
      category: "sports",
      question: `Will ${home} beat ${away} when they meet at the 2026 World Cup?`,
      creatorPosition: `Yes — ${home} wins`,
      counterPosition: `No — draw or ${away} wins`,
      resolutionUrl: searchUrl(`${home} vs ${away} World Cup 2026 result score`),
    };
  },
  // Over/under goals
  () => {
    const [home, away] = pickTwoTeams();
    return {
      label: `${home} vs ${away} — over 2.5 goals`,
      category: "sports",
      question: `Will the ${home} vs ${away} World Cup match have more than 2.5 total goals?`,
      creatorPosition: "Yes — 3 or more goals",
      counterPosition: "No — 2 goals or fewer",
      resolutionUrl: searchUrl(`${home} vs ${away} World Cup 2026 final score goals`),
    };
  },
  // Player to score
  () => {
    const p = pick(WC_PLAYERS);
    return {
      label: `${p.name} — to score`,
      category: "sports",
      question: `Will ${p.name} score for ${p.team} in their next 2026 World Cup match?`,
      creatorPosition: `Yes — ${p.name} scores`,
      counterPosition: `No — ${p.name} doesn't score`,
      resolutionUrl: searchUrl(`${p.name} goal ${p.team} World Cup 2026 match`),
    };
  },
  // Both teams to score
  () => {
    const [home, away] = pickTwoTeams();
    return {
      label: `${home} vs ${away} — both score`,
      category: "sports",
      question: `Will both ${home} and ${away} score in their 2026 World Cup match?`,
      creatorPosition: "Yes — both teams score",
      counterPosition: "No — at least one team is kept scoreless",
      resolutionUrl: searchUrl(`${home} vs ${away} World Cup 2026 score both teams scored`),
    };
  },
];

/** Draft up to `count` distinct World Cup claims for this cycle. */
export function draftWorldCupClaims(count: number): WcDraft[] {
  const out: WcDraft[] = [];
  const seen = new Set<string>();
  let guard = 0;
  while (out.length < count && guard < count * 8) {
    guard++;
    const d = pick(TEMPLATES)();
    if (seen.has(d.question)) continue;
    seen.add(d.question);
    out.push(d);
  }
  return out;
}
