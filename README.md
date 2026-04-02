# Worthy Mobile Games

A community-curated list of mobile games that respect players. No ads, no pay-to-win, no predatory mechanics, just games worth playing.

Browse the list at **[worthymobile.games](https://worthymobile.games)**.

Likewise, the site will also be completely and forever free, open source, contain no ads or any other anmnoyances.

## How it works

This repository is the "backend" for the Worthy Mobile Games website. Games are submitted as GitHub Issues, reviewed by maintainers, and automatically published to the site.

1. **Suggest a game** by [creating an issue](../../issues/new/choose) using the template
2. **Maintainers review** the submission and apply labels
3. **A workflow** generates the data and pushes it to the website
4. **A bot comment** on each issue shows the criteria evaluation and resulting tier

## Criteria

Every game is evaluated against a checklist of criteria, split into two tiers.

### Silver (baseline - must ALL pass to be listed)

| Criterion             | Description                                                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No ads                | No ads of any kind - banners, interstitials, rewarded, offer walls                                                                                                 |
| No pay-to-win         | No mechanics where paying gives a gameplay advantage                                                                                                               |
| No gacha / loot boxes | No randomized paid rewards of any kind                                                                                                                             |
| No bypassable timers  | No energy systems or timers that can be skipped with purchases                                                                                                     |
| No dark patterns      | No manufactured urgency, deceptive UI, or notification spam                                                                                                        |
| Clean IAP             | IAP limited to one-time unlock, cosmetics, or genuine content DLC. Purchased content must be sidegrades or new experiences, not upgrades. Base game feels complete |

### Gold (must ALSO pass for Gold tier)

| Criterion                                    | Description                                                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| No subscription / battle pass                | No recurring payment models                                                                                        |
| No IAPs (except for full game purchases)     | No in-app purchases at all, with the sole exception of a one-time payment to unlock the full game                  |
| No progression gates                         | No energy systems or artificial gates (unless genuinely integral to design AND impossible to bypass with purchases) |

A game that **passes all Silver criteria** but fails one or more Gold criteria is listed as **Silver**.

A game that **passes all criteria** is listed as **Gold**.

A game that **fails any Silver criterion** is **not listed**.

## How the scoring works

Each game on the list has a computed **score** that determines its position. The score combines two factors: **criteria compliance** (dominant) and **community votes** (differentiator).

### Step 1: Criteria score (0 to 1)

Each criterion has a [weight](config/criteria-weights.json) that reflects its importance. The criteria score is the sum of weights for passing criteria divided by the total weight.

```
criteria_score = sum(weight × pass) / sum(weight)
```

Silver criteria carry more weight because they define the project's core identity.

A Gold game scores **1.0** (all 145 points). The worst possible Silver game (fails all gold criteria) scores **0.759** (110 out of 145 points).

### Step 2: Vote score - Bayesian average (0 to 1)

Raw vote counts are misleading - a game with 2 votes averaging high would unfairly outrank a game with 200 votes averaging slightly lower. To address this, votes are normalized using a Bayesian average (similar to IMDb's weighted rating):

```
R = thumbs_up / max_thumbs_up_in_catalog
C = average R across all games
m = minimum votes for trust (default: 5)
v = this game's thumbs_up count

vote_score = (v / (v + m)) × R + (m / (v + m)) × C
```

When a game has few votes, the formula pulls its score toward the global average. As votes accumulate, the game's own popularity takes over.

### Step 3: Final score

```
final_score = 0.85 × criteria_score + 0.15 × vote_score
```

Criteria compliance makes up **85%** of the score. Votes make up **15%** - enough to differentiate games within the same tier, but not enough to let popularity override quality standards.

### Can a Silver game outrank a Gold game?

In most cases, Gold games rank above Silver games because they have a higher criteria score and that score dominates the formula. For example:

- A Gold game with zero votes scores approximately **0.85**
- A Silver game (failing all gold criteria) with maximum votes scores approximately **0.80**

However, a Silver game that _barely_ misses Gold (e.g., only fails the "no subscription" criterion, worth 10 points out of 145) and has strong community votes could score **0.94**, matching or slightly outranking a new Gold game with zero votes.

This is intentional. The tier badge on the website still clearly communicates the quality distinction - users always see whether a game is Gold or Silver. But a massively popular, community-validated game that barely misses Gold probably deserves more visibility than a brand-new Gold game that hasn't been validated by the community yet. As the new Gold game collects votes, it will naturally climb above.

## Contributing

This repository is about maintaining the game data.

The best way to contribute is to [suggest a game](../../issues/new/choose). Before submitting, please search existing issues to make sure it hasn't already been suggested.

If you find incorrect data for a game or disagree with how a game is tagged, feel free to comment in the respective issue.
