import { Octokit } from "octokit";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// --- Types ---

interface CriteriaResult {
  // Gold criteria (top, hardest)
  noProgressionGates: boolean;
  noIAP: boolean;
  noSubscription: boolean;
  // Silver criteria (bottom, baseline)
  cleanIAP: boolean;
  noDarkPatterns: boolean;
  noBypassableTimers: boolean;
  noGacha: boolean;
  noPayToWin: boolean;
  noAds: boolean;
}

interface Tag {
  type: "genre" | "payment" | "feature" | "warning";
  value: string;
}

interface PlatformEntry {
  platform: "android" | "ios";
  storeId: string;
  storeUrl: string;
}

interface Game {
  issueId: number;
  name: string;
  slug: string;
  tier: "gold" | "silver";
  platforms: PlatformEntry[];
  iconUrl: string;
  tags: Tag[];
  criteria: CriteriaResult;
  score: number;
  description: string;
  likes: number;
  dateAdded: string;
  dateUpdated: string;
}

interface SearchEntry {
  issueId: number;
  title: string;
  status: "approved" | "pending" | "rejected" | "needs-info" | "closed";
}

interface CriteriaWeights {
  scoring: { alpha: number; minVotesForTrust: number };
  criteria: {
    gold: Record<string, number>;
    silver: Record<string, number>;
  };
}

// --- Constants ---

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEIGHTS_PATH = join(__dirname, "..", "config", "criteria-weights.json");

// Map of "has/*" labels to criteria fields (presence = criterion FAILS)
const CRITERIA_FAIL_LABELS: Record<string, keyof CriteriaResult> = {
  "has/ads": "noAds",
  "has/pay-to-win": "noPayToWin",
  "has/gacha": "noGacha",
  "has/bypassable-timers": "noBypassableTimers",
  "has/dark-patterns": "noDarkPatterns",
  "has/subscription": "noSubscription",
  "has/unclean-iap": "cleanIAP",
  "has/iap": "noIAP",
  "has/progression-gates": "noProgressionGates",
};

const SILVER_CRITERIA: (keyof CriteriaResult)[] = [
  "noAds",
  "noPayToWin",
  "noGacha",
  "noBypassableTimers",
  "noDarkPatterns",
  "cleanIAP",
];

const TAG_PREFIXES: Record<string, Tag["type"]> = {
  "genre/": "genre",
  "payment/": "payment",
  "feature/": "feature",
  "warning/": "warning",
};

// --- Helpers ---

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function evaluateCriteria(labelNames: string[]): CriteriaResult {
  const result: CriteriaResult = {
    noProgressionGates: true,
    noIAP: true,
    noSubscription: true,
    cleanIAP: true,
    noDarkPatterns: true,
    noBypassableTimers: true,
    noGacha: true,
    noPayToWin: true,
    noAds: true,
  };

  for (const label of labelNames) {
    const field = CRITERIA_FAIL_LABELS[label];
    if (field) {
      result[field] = false;
    }
  }

  return result;
}

function deriveTier(criteria: CriteriaResult): "gold" | "silver" | "rejected" {
  // Check silver baseline first
  const silverPass = SILVER_CRITERIA.every((key) => criteria[key]);
  if (!silverPass) return "rejected";

  // Check all criteria for gold
  const allPass = Object.values(criteria).every((v) => v);
  return allPass ? "gold" : "silver";
}

function computeScore(
  criteria: CriteriaResult,
  likes: number,
  allLikes: number[],
  weights: CriteriaWeights,
): number {
  // Step 1: Criteria score (0-1)
  const allWeights = { ...weights.criteria.gold, ...weights.criteria.silver };
  let weightedSum = 0;
  let totalWeight = 0;

  for (const [key, weight] of Object.entries(allWeights)) {
    totalWeight += weight;
    if (criteria[key as keyof CriteriaResult]) {
      weightedSum += weight;
    }
  }

  const criteriaScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

  // Step 2: Vote score - Bayesian average (0-1)
  const maxLikes = Math.max(...allLikes, 1);
  const R = likes / maxLikes;

  const allR = allLikes.map((l) => l / maxLikes);
  const C = allR.length > 0 ? allR.reduce((a, b) => a + b, 0) / allR.length : 0;

  const m = weights.scoring.minVotesForTrust;
  const voteScore = (likes / (likes + m)) * R + (m / (likes + m)) * C;

  // Step 3: Final score
  const alpha = weights.scoring.alpha;
  return alpha * criteriaScore + (1 - alpha) * voteScore;
}

function extractTags(labelNames: string[]): Tag[] {
  const tags: Tag[] = [];

  for (const label of labelNames) {
    for (const [prefix, type] of Object.entries(TAG_PREFIXES)) {
      if (label.startsWith(prefix)) {
        tags.push({ type, value: label.slice(prefix.length) });
        break;
      }
    }
  }

  return tags;
}

function extractPlatforms(
  labelNames: string[],
  issueBody: string,
): PlatformEntry[] {
  const platforms: PlatformEntry[] = [];

  // Extract store URLs from the issue body (GitHub form responses)
  const androidUrlMatch = issueBody.match(
    /play\.google\.com\/store\/apps\/details\?id=([a-zA-Z0-9_.]+)/,
  );
  const iosUrlMatch = issueBody.match(
    /apps\.apple\.com\/(?:[a-z]+\/)?app\/(?:[^/]+\/)?id(\d+)/,
  );

  if (labelNames.includes("platform/android") && androidUrlMatch) {
    platforms.push({
      platform: "android",
      storeId: androidUrlMatch[1],
      storeUrl: `https://play.google.com/store/apps/details?id=${androidUrlMatch[1]}`,
    });
  }

  if (labelNames.includes("platform/ios") && iosUrlMatch) {
    platforms.push({
      platform: "ios",
      storeId: iosUrlMatch[1],
      storeUrl: `https://apps.apple.com/app/id${iosUrlMatch[1]}`,
    });
  }

  return platforms;
}

function extractDescription(issueBody: string): string {
  // GitHub form responses have headers like "### Why is this game worthy?"
  const match = issueBody.match(
    /### Why is this game worthy\?\s*\n\s*\n([\s\S]*?)(?:\n###|\n$|$)/,
  );
  return match ? match[1].trim().slice(0, 500) : "";
}

function extractGameName(issueTitle: string): string {
  // Issue title format: "[Game] Monument Valley"
  return issueTitle.replace(/^\[Game\]\s*/, "").trim();
}

function getStatus(
  labelNames: string[],
  issueState: string,
): SearchEntry["status"] {
  if (issueState === "closed" && labelNames.includes("status/validated"))
    return "approved";
  if (issueState === "closed") return "closed";
  if (labelNames.includes("status/rejected")) return "rejected";
  if (labelNames.includes("status/needs-info")) return "needs-info";
  return "pending";
}

// --- Icon fetching ---

async function fetchAndroidIconUrl(storeId: string): Promise<string> {
  try {
    const res = await fetch(
      `https://play.google.com/store/apps/details?id=${storeId}&hl=en`,
    );
    const html = await res.text();
    // The Play Store page includes the icon in an img tag or meta tag
    const ogMatch = html.match(/property="og:image"\s+content="([^"]+)"/);
    return ogMatch ? ogMatch[1] : "";
  } catch {
    return "";
  }
}

async function fetchIosIconUrl(appId: string): Promise<string> {
  try {
    const res = await fetch(`https://itunes.apple.com/lookup?id=${appId}`);
    const data = (await res.json()) as {
      results: { artworkUrl512?: string }[];
    };
    return data.results?.[0]?.artworkUrl512 ?? "";
  } catch {
    return "";
  }
}

async function getIconUrl(platforms: PlatformEntry[]): Promise<string> {
  // Try Android first (more reliable scraping), then iOS
  for (const p of platforms) {
    if (p.platform === "android") {
      const url = await fetchAndroidIconUrl(p.storeId);
      if (url) return url;
    }
  }
  for (const p of platforms) {
    if (p.platform === "ios") {
      const url = await fetchIosIconUrl(p.storeId);
      if (url) return url;
    }
  }
  return "";
}

// --- Main ---

async function main() {
  const owner = process.env.GITHUB_REPOSITORY_OWNER ?? "worthy-mobile-games";
  const repo = "worthy-mobile-games";
  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    console.error("GITHUB_TOKEN is required");
    process.exit(1);
  }

  const octokit = new Octokit({ auth: token });
  const weights: CriteriaWeights = JSON.parse(
    readFileSync(WEIGHTS_PATH, "utf-8"),
  );

  console.log("Fetching issues...");

  // Fetch all open issues (paginated, 100 per page)
  const allIssues: Awaited<
    ReturnType<typeof octokit.rest.issues.listForRepo>
  >["data"] = [];

  let page = 1;
  while (true) {
    const { data } = await octokit.rest.issues.listForRepo({
      owner,
      repo,
      state: "all",
      per_page: 100,
      page,
    });

    // Filter out pull requests (GitHub API returns PRs as issues too)
    const issues = data.filter((i) => !i.pull_request);
    allIssues.push(...issues);

    if (data.length < 100) break;
    page++;
  }

  console.log(`Fetched ${allIssues.length} issues`);

  // Build search index (all issues)
  const searchIndex: SearchEntry[] = allIssues.map((issue) => {
    const labelNames = issue.labels
      .map((l) => (typeof l === "string" ? l : (l.name ?? "")))
      .filter(Boolean);

    return {
      issueId: issue.number,
      title: extractGameName(issue.title),
      status: getStatus(labelNames, issue.state),
    };
  });

  // Process approved issues into games
  const approvedIssues = allIssues.filter((issue) => {
    const labelNames = issue.labels
      .map((l) => (typeof l === "string" ? l : (l.name ?? "")))
      .filter(Boolean);
    return issue.state === "closed" && labelNames.includes("status/validated");
  });

  console.log(`Processing ${approvedIssues.length} approved games...`);

  // First pass: collect all likes for Bayesian average
  const allLikes = approvedIssues.map((issue) => issue.reactions?.["+1"] ?? 0);

  // Second pass: build game objects
  const games: Game[] = [];

  for (const issue of approvedIssues) {
    const labelNames = issue.labels
      .map((l) => (typeof l === "string" ? l : (l.name ?? "")))
      .filter(Boolean);

    const criteria = evaluateCriteria(labelNames);
    const tier = deriveTier(criteria);

    // Skip rejected games (shouldn't have status/validated, but safety check)
    if (tier === "rejected") {
      console.warn(
        `Issue #${issue.number} "${issue.title}" has status/validated but fails silver criteria. Skipping.`,
      );
      continue;
    }

    const name = extractGameName(issue.title);
    const body = issue.body ?? "";
    const platforms = extractPlatforms(labelNames, body);
    const likes = issue.reactions?.["+1"] ?? 0;

    // Fetch icon
    const iconUrl = await getIconUrl(platforms);

    const game: Game = {
      issueId: issue.number,
      name,
      slug: slugify(name),
      tier,
      platforms,
      iconUrl,
      tags: extractTags(labelNames),
      criteria,
      score: computeScore(criteria, likes, allLikes, weights),
      description: extractDescription(body),
      likes,
      dateAdded: issue.created_at,
      dateUpdated: issue.updated_at,
    };

    games.push(game);
  }

  // Sort by score descending, then name ascending
  games.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  // Generate meta
  const meta = {
    totalGames: games.length,
    lastUpdated: new Date().toISOString(),
    tiers: {
      gold: games.filter((g) => g.tier === "gold").length,
      silver: games.filter((g) => g.tier === "silver").length,
    },
    platforms: {
      android: games.filter((g) =>
        g.platforms.some((p) => p.platform === "android"),
      ).length,
      ios: games.filter((g) => g.platforms.some((p) => p.platform === "ios"))
        .length,
    },
  };

  // Write output
  const outDir = join(__dirname, "..", "output");
  mkdirSync(outDir, { recursive: true });

  writeFileSync(join(outDir, "games.json"), JSON.stringify(games, null, 2));
  writeFileSync(
    join(outDir, "search-index.json"),
    JSON.stringify(searchIndex, null, 2),
  );
  writeFileSync(join(outDir, "meta.json"), JSON.stringify(meta, null, 2));

  console.log(
    `Generated ${games.length} games, ${searchIndex.length} search entries`,
  );
  console.log(`Output written to ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
