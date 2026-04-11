import { Octokit } from "octokit";

// --- Types ---

interface CriteriaResult {
  noProgressionGates: boolean;
  noIAP: boolean;
  noSubscription: boolean;
  cleanIAP: boolean;
  noDarkPatterns: boolean;
  noBypassableTimers: boolean;
  noGacha: boolean;
  noPayToWin: boolean;
  noAds: boolean;
}

// --- Constants ---

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

const BOT_MARKER = "<!-- worthy-criteria-bot -->";

// --- Helpers ---

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

function deriveVerdict(criteria: CriteriaResult) {
  const silverPass = SILVER_CRITERIA.every((k) => criteria[k]);
  const allPass = Object.values(criteria).every((v) => v);

  if (allPass) return { text: "WORTHY: Gold", emoji: "🥇" };
  if (silverPass) return { text: "WORTHY: Silver", emoji: "🥈" };
  return { text: "NOT WORTHY", emoji: "🚫" };
}

function buildCommentBody(criteria: CriteriaResult): string {
  const verdict = deriveVerdict(criteria);
  const icon = (pass: boolean) => (pass ? "✅" : "❌");
  const status = (pass: boolean) => (pass ? "Pass" : "**Fail**");

  return `${BOT_MARKER}
## ${verdict.emoji} ${verdict.text}

### 🥇 Gold Criteria
| | Criterion | Status |
|---|---|---|
| ${icon(criteria.noProgressionGates)} | No energy systems / artificial progression gates | ${status(criteria.noProgressionGates)} |
| ${icon(criteria.noIAP)} | No IAPs (except complete game experiences like DLC campaigns) | ${status(criteria.noIAP)} |
| ${icon(criteria.noSubscription)} | No subscription or battle pass | ${status(criteria.noSubscription)} |

### 🥈 Silver Criteria (Baseline)
| | Criterion | Status |
|---|---|---|
| ${icon(criteria.noDarkPatterns)} | No dark patterns | ${status(criteria.noDarkPatterns)} |
| ${icon(criteria.noBypassableTimers)} | No bypassable timers / energy systems | ${status(criteria.noBypassableTimers)} |
| ${icon(criteria.noGacha)} | No gacha or loot boxes | ${status(criteria.noGacha)} |
| ${icon(criteria.noPayToWin)} | No pay-to-win mechanics | ${status(criteria.noPayToWin)} |
| ${icon(criteria.noAds)} | No ads of any kind | ${status(criteria.noAds)} |
| ${icon(criteria.cleanIAP)} | Clean IAP (sidegrades or new experiences only, base game feels complete) | ${status(criteria.cleanIAP)} |

---
*This checklist is automatically maintained. To change the evaluation, update the \`has/*\` labels on this issue.*`;
}

// --- Main ---

async function main() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("GITHUB_TOKEN is required");
    process.exit(1);
  }

  const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? "").split("/");
  const issueNumber = parseInt(process.env.ISSUE_NUMBER ?? "", 10);

  if (!owner || !repo || isNaN(issueNumber)) {
    console.error(
      "GITHUB_REPOSITORY and ISSUE_NUMBER env vars are required"
    );
    process.exit(1);
  }

  const octokit = new Octokit({ auth: token });

  // Fetch the issue to get current labels
  const { data: issue } = await octokit.rest.issues.get({
    owner,
    repo,
    issue_number: issueNumber,
  });

  const labelNames = issue.labels
    .map((l) => (typeof l === "string" ? l : l.name ?? ""))
    .filter(Boolean);

  // Only post/update the bot comment on validated issues
  const isValidated = labelNames.includes("status/validated");

  // Find existing bot comment
  const { data: comments } = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: issueNumber,
  });

  const botComment = comments.find(
    (c) => c.body && c.body.includes(BOT_MARKER)
  );

  if (!isValidated) {
    // Remove stale bot comment if the label was removed
    if (botComment) {
      await octokit.rest.issues.deleteComment({
        owner,
        repo,
        comment_id: botComment.id,
      });
      console.log(`Removed criteria comment from non-validated issue #${issueNumber}`);
    } else {
      console.log(`Issue #${issueNumber} is not validated, skipping.`);
    }
    return;
  }

  const criteria = evaluateCriteria(labelNames);
  const body = buildCommentBody(criteria);

  if (botComment) {
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: botComment.id,
      body,
    });
    console.log(`Updated criteria comment on issue #${issueNumber}`);
  } else {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body,
    });
    console.log(`Created criteria comment on issue #${issueNumber}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
