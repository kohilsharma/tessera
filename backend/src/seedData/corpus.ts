import type { TermsClass } from "../entities/Publisher";
import { StoryCategory } from "../entities/Story";

// Hand-authored fixtures (ADR-0007): a reproducible, guaranteed-clean, known
// multi-source corpus for the demo — not live-clustered, so the browse
// experience never depends on ingestion or clustering quality.

export type SeedPublisher = { name: string; domain: string; termsClass: TermsClass };

// `licensed` across the board: every word of fixture text below is our own
// synthetic writing (ADR-0007), so serving it is a rights decision we can
// actually make. Live publishers a connector discovers get the fail-closed
// `internal_only` default instead, until an Admin classifies them by hand (#40).
export const SEED_PUBLISHERS: SeedPublisher[] = [
  { name: "Meridian Wire", domain: "meridianwire.example", termsClass: "licensed" },
  { name: "Harbor Press", domain: "harborpress.example", termsClass: "licensed" },
  { name: "Lattice Daily", domain: "latticedaily.example", termsClass: "licensed" },
  { name: "Northfield Record", domain: "northfieldrecord.example", termsClass: "licensed" },
  { name: "Cascade Bulletin", domain: "cascadebulletin.example", termsClass: "licensed" },
  { name: "Verity News", domain: "veritynews.example", termsClass: "licensed" },
  { name: "Outpost Journal", domain: "outpostjournal.example", termsClass: "licensed" },
  { name: "Fielding Times", domain: "fieldingtimes.example", termsClass: "licensed" },
];

// ADR-0018's ingestion surfaces, seeded so the Admin dashboard has real
// connectors to inspect and, from #39, real feeds to run.
export type SeedConnector = { name: string; kind: "gdelt_gkg" | "gdelt_doc" | "rss"; endpoint: string; enabled: boolean };

// The curated RSS list. ADR-0018 makes feed curation the cheapest lever on text
// quality, so the five that emit `content:encoded` (a full article body rather
// than a one-line teaser) lead the list, and the five that emit only
// `description` follow. Which is which was measured against the live feeds on
// 2026-08-30, not assumed from the publisher. Deliberately spread across world
// news, technology, science and security so the ingested corpus has more than one
// subject in it.
//
// These replace the `meridianwire.example` placeholder, which pointed at a domain
// that cannot resolve and was the only RSS connector.
const SEED_RSS_FEEDS: { name: string; endpoint: string }[] = [
  { name: "NPR World (RSS)", endpoint: "https://feeds.npr.org/1004/rss.xml" },
  { name: "Ars Technica (RSS)", endpoint: "https://feeds.arstechnica.com/arstechnica/index" },
  { name: "NASA news releases (RSS)", endpoint: "https://www.nasa.gov/news-release/feed/" },
  { name: "WSJ World News (RSS)", endpoint: "https://feeds.a.dj.com/rss/RSSWorldNews.xml" },
  { name: "Krebs on Security (RSS)", endpoint: "https://krebsonsecurity.com/feed/" },
  { name: "BBC News World (RSS)", endpoint: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { name: "The Guardian World (RSS)", endpoint: "https://www.theguardian.com/world/rss" },
  { name: "Al Jazeera (RSS)", endpoint: "https://www.aljazeera.com/xml/rss/all.xml" },
  { name: "ScienceDaily Top Science (RSS)", endpoint: "https://www.sciencedaily.com/rss/top/science.xml" },
  { name: "TechCrunch (RSS)", endpoint: "https://techcrunch.com/feed/" },
];

export const SEED_CONNECTORS: SeedConnector[] = [
  // Disabled until their connectors exist (#41, #46): runConnector fails a run it
  // has no implementation for, and an operator should not have to learn that by
  // pressing the button. Their tickets enable them.
  {
    name: "GDELT GKG firehose",
    kind: "gdelt_gkg",
    endpoint: "http://data.gdeltproject.org/gdeltv2/lastupdate.txt",
    enabled: false,
  },
  {
    name: "GDELT DOC API",
    kind: "gdelt_doc",
    endpoint: "https://api.gdeltproject.org/api/v2/doc/doc",
    enabled: false,
  },
  ...SEED_RSS_FEEDS.map(({ name, endpoint }): SeedConnector => ({ name, kind: "rss", endpoint, enabled: true })),
];

export type SeedArticle = {
  title: string;
  url: string;
  publisherDomain: string;
  publishedAt: string;
  analysisText: string;
};

export type SeedStory = {
  slug: string;
  title: string;
  summary: string;
  category: StoryCategory;
  articles: SeedArticle[];
};

export const SEED_STORIES: SeedStory[] = [
  {
    slug: "advanced-packaging-capacity-race",
    title: "Chipmakers race to expand advanced packaging capacity",
    summary: "Three chipmakers announce new advanced-packaging lines to ease an AI-accelerator supply crunch.",
    category: "technology",
    articles: [
      {
        title: "Chipmaker breaks ground on new packaging plant",
        url: "https://meridianwire.example/articles/packaging-plant-groundbreaking",
        publisherDomain: "meridianwire.example",
        publishedAt: "2026-08-02T09:15:00Z",
        analysisText:
          "The company said the facility will add capacity for the advanced packaging techniques used in AI accelerators, with output expected in 2028.",
      },
      {
        title: "Rival foundry accelerates packaging investment",
        url: "https://latticedaily.example/articles/foundry-packaging-investment",
        publisherDomain: "latticedaily.example",
        publishedAt: "2026-08-03T14:40:00Z",
        analysisText:
          "A competing foundry confirmed it is moving up its own packaging expansion timeline, citing sustained demand from AI accelerator customers.",
      },
      {
        title: "Analysts flag packaging as the new bottleneck",
        url: "https://outpostjournal.example/articles/packaging-bottleneck-analysis",
        publisherDomain: "outpostjournal.example",
        publishedAt: "2026-08-05T11:00:00Z",
        analysisText:
          "Industry analysts said advanced packaging, not wafer fabrication, is now the tightest constraint on AI accelerator supply through 2027.",
      },
    ],
  },
  {
    slug: "cloud-ai-inference-spending-surge",
    title: "Cloud providers report surge in AI inference spending",
    summary: "Major cloud providers disclose sharply higher inference infrastructure spending in quarterly filings.",
    category: "technology",
    articles: [
      {
        title: "Cloud provider lifts capital spending guidance",
        url: "https://harborpress.example/articles/cloud-capex-guidance",
        publisherDomain: "harborpress.example",
        publishedAt: "2026-08-06T13:00:00Z",
        analysisText:
          "The company raised its full-year capital spending guidance, attributing the increase to inference infrastructure for AI workloads.",
      },
      {
        title: "Second cloud provider echoes higher inference spend",
        url: "https://veritynews.example/articles/second-cloud-inference-spend",
        publisherDomain: "veritynews.example",
        publishedAt: "2026-08-07T10:20:00Z",
        analysisText:
          "A second major provider reported similar increases in inference-related spending during its earnings call, describing demand as durable.",
      },
    ],
  },
  {
    slug: "tariff-framework-talks",
    title: "Trade ministers meet to revise tariff framework",
    summary: "Trade ministers from several countries opened talks on revising a decade-old tariff framework.",
    category: "politics",
    articles: [
      {
        title: "Ministers open tariff framework talks",
        url: "https://northfieldrecord.example/articles/tariff-talks-open",
        publisherDomain: "northfieldrecord.example",
        publishedAt: "2026-08-08T08:00:00Z",
        analysisText:
          "Trade ministers began a two-day session aimed at revising tariff schedules that have not been updated in over a decade.",
      },
      {
        title: "Officials describe cautious optimism after first session",
        url: "https://cascadebulletin.example/articles/tariff-talks-first-session",
        publisherDomain: "cascadebulletin.example",
        publishedAt: "2026-08-08T19:30:00Z",
        analysisText:
          "Officials leaving the first session described the tone as cautiously optimistic, though several delegations flagged unresolved sticking points.",
      },
    ],
  },
  {
    slug: "election-disclosure-rules-proposal",
    title: "Election oversight body proposes new disclosure rules",
    summary: "An election oversight body proposed rules requiring faster disclosure of campaign spending.",
    category: "politics",
    articles: [
      {
        title: "Oversight body unveils disclosure proposal",
        url: "https://fieldingtimes.example/articles/disclosure-proposal-unveiled",
        publisherDomain: "fieldingtimes.example",
        publishedAt: "2026-08-09T12:00:00Z",
        analysisText:
          "The proposal would shorten the window for disclosing large campaign expenditures from 30 days to 10.",
      },
      {
        title: "Campaign finance groups split on proposed rules",
        url: "https://meridianwire.example/articles/disclosure-rules-reaction",
        publisherDomain: "meridianwire.example",
        publishedAt: "2026-08-10T09:45:00Z",
        analysisText:
          "Reaction from campaign finance advocacy groups was mixed, with some calling the timeline still too slow and others warning of compliance burdens.",
      },
    ],
  },
  {
    slug: "central-bank-holds-rates",
    title: "Central bank holds rates steady amid mixed inflation signals",
    summary: "The central bank held its benchmark rate steady, citing mixed signals in recent inflation data.",
    category: "business",
    articles: [
      {
        title: "Central bank keeps rate unchanged",
        url: "https://harborpress.example/articles/central-bank-rate-hold",
        publisherDomain: "harborpress.example",
        publishedAt: "2026-08-11T15:00:00Z",
        analysisText:
          "The central bank left its benchmark interest rate unchanged, noting that recent inflation readings had been inconsistent month to month.",
      },
      {
        title: "Markets read rate hold as a dovish signal",
        url: "https://latticedaily.example/articles/rate-hold-market-reaction",
        publisherDomain: "latticedaily.example",
        publishedAt: "2026-08-11T21:10:00Z",
        analysisText:
          "Traders interpreted the decision and accompanying statement as a dovish signal, pushing short-term yields lower in after-hours trading.",
      },
      {
        title: "Economists split on how long the pause lasts",
        url: "https://outpostjournal.example/articles/rate-pause-economist-views",
        publisherDomain: "outpostjournal.example",
        publishedAt: "2026-08-12T10:00:00Z",
        analysisText:
          "Economists surveyed after the decision disagreed on whether the pause would extend through year-end or give way to a cut as soon as next quarter.",
      },
    ],
  },
  {
    slug: "retail-earnings-diverging-trends",
    title: "Retail earnings show diverging consumer spending trends",
    summary: "Retailers reported diverging results, with discount chains outperforming mid-market peers.",
    category: "business",
    articles: [
      {
        title: "Discount retailer beats estimates on traffic growth",
        url: "https://veritynews.example/articles/discount-retailer-earnings-beat",
        publisherDomain: "veritynews.example",
        publishedAt: "2026-08-13T13:30:00Z",
        analysisText:
          "The discount retailer reported same-store sales growth well above estimates, citing increased foot traffic from higher-income shoppers.",
      },
      {
        title: "Mid-market chain cuts full-year outlook",
        url: "https://northfieldrecord.example/articles/midmarket-chain-outlook-cut",
        publisherDomain: "northfieldrecord.example",
        publishedAt: "2026-08-13T18:00:00Z",
        analysisText:
          "A mid-market retail chain lowered its full-year sales outlook, pointing to softer demand for discretionary categories.",
      },
    ],
  },
  {
    slug: "room-temperature-superconductor-candidate",
    title: "Researchers report progress on room-temperature superconductor candidate",
    summary: "A university lab reported partial replication of a contested room-temperature superconductor claim.",
    category: "science",
    articles: [
      {
        title: "Lab reports partial replication of superconductor claim",
        url: "https://cascadebulletin.example/articles/superconductor-partial-replication",
        publisherDomain: "cascadebulletin.example",
        publishedAt: "2026-08-14T08:30:00Z",
        analysisText:
          "Researchers said they observed a resistance drop consistent with part of the original claim, but could not confirm the reported critical temperature.",
      },
      {
        title: "Independent physicists urge caution on new results",
        url: "https://fieldingtimes.example/articles/superconductor-caution-urged",
        publisherDomain: "fieldingtimes.example",
        publishedAt: "2026-08-15T11:15:00Z",
        analysisText:
          "Physicists not involved in the study cautioned that partial replication does not confirm room-temperature superconductivity and called for further review.",
      },
    ],
  },
  {
    slug: "lunar-resupply-mission-date",
    title: "Space agency sets date for next lunar resupply mission",
    summary: "A space agency confirmed the launch window for its next uncrewed lunar resupply mission.",
    category: "science",
    articles: [
      {
        title: "Agency confirms lunar resupply launch window",
        url: "https://meridianwire.example/articles/lunar-resupply-launch-window",
        publisherDomain: "meridianwire.example",
        publishedAt: "2026-08-16T07:00:00Z",
        analysisText:
          "The agency confirmed a two-week launch window for its next uncrewed resupply mission to the lunar surface outpost.",
      },
      {
        title: "Mission will carry expanded science payload",
        url: "https://harborpress.example/articles/lunar-mission-science-payload",
        publisherDomain: "harborpress.example",
        publishedAt: "2026-08-16T16:45:00Z",
        analysisText:
          "Beyond routine resupply cargo, the mission will carry an expanded set of science instruments for surface radiation monitoring.",
      },
    ],
  },
  {
    slug: "vaccine-formulation-review",
    title: "Health regulators review updated vaccine formulation",
    summary: "Health regulators opened a review of an updated seasonal vaccine formulation ahead of the fall season.",
    category: "health",
    articles: [
      {
        title: "Regulators open review of updated formulation",
        url: "https://latticedaily.example/articles/vaccine-formulation-review-opens",
        publisherDomain: "latticedaily.example",
        publishedAt: "2026-08-17T09:00:00Z",
        analysisText:
          "The review will assess updated strain targeting ahead of the fall vaccination season, with a decision expected within six weeks.",
      },
      {
        title: "Manufacturer submits updated trial data",
        url: "https://outpostjournal.example/articles/vaccine-manufacturer-trial-data",
        publisherDomain: "outpostjournal.example",
        publishedAt: "2026-08-18T13:20:00Z",
        analysisText:
          "The manufacturer submitted additional trial data on the updated formulation's immune response in older adults as part of the review.",
      },
    ],
  },
  {
    slug: "coastal-flood-defense-investment",
    title: "Coastal cities accelerate flood-defense investment",
    summary: "Several coastal cities announced accelerated timelines for flood-defense infrastructure projects.",
    category: "world",
    articles: [
      {
        title: "City accelerates seawall construction timeline",
        url: "https://veritynews.example/articles/seawall-construction-accelerated",
        publisherDomain: "veritynews.example",
        publishedAt: "2026-08-19T10:00:00Z",
        analysisText:
          "City officials moved up the completion date for a seawall project by two years, citing updated flood-risk modeling.",
      },
      {
        title: "Neighboring city commits new flood-defense funding",
        url: "https://northfieldrecord.example/articles/flood-defense-funding-commitment",
        publisherDomain: "northfieldrecord.example",
        publishedAt: "2026-08-19T20:10:00Z",
        analysisText:
          "A neighboring coastal city separately committed new funding toward flood-defense infrastructure, following similar risk-modeling updates.",
      },
    ],
  },
  {
    slug: "regional-ceasefire-talks-resume",
    title: "Regional ceasefire talks resume after weeks of stalemate",
    summary: "Mediators announced that stalled regional ceasefire talks had resumed after several weeks.",
    category: "world",
    articles: [
      {
        title: "Mediators announce resumed ceasefire talks",
        url: "https://cascadebulletin.example/articles/ceasefire-talks-resume",
        publisherDomain: "cascadebulletin.example",
        publishedAt: "2026-08-20T07:30:00Z",
        analysisText:
          "Mediators said both delegations had agreed to resume talks after a five-week stalemate, without disclosing what changed.",
      },
      {
        title: "Delegations offer differing accounts of the breakthrough",
        url: "https://fieldingtimes.example/articles/ceasefire-breakthrough-accounts",
        publisherDomain: "fieldingtimes.example",
        publishedAt: "2026-08-21T12:00:00Z",
        analysisText:
          "The two delegations offered differing public accounts of what prompted the resumption, though both confirmed talks were ongoing.",
      },
      {
        title: "Regional bloc welcomes resumption of talks",
        url: "https://meridianwire.example/articles/regional-bloc-welcomes-talks",
        publisherDomain: "meridianwire.example",
        publishedAt: "2026-08-21T18:40:00Z",
        analysisText:
          "A regional bloc issued a statement welcoming the resumption of talks and offered to host a further round if requested.",
      },
    ],
  },
  {
    slug: "championship-venues-finalized",
    title: "Host city finalizes venues ahead of international championship",
    summary: "The host city confirmed its final venue lineup for next year's international championship.",
    category: "sports",
    articles: [
      {
        title: "Host city confirms final venue lineup",
        url: "https://harborpress.example/articles/championship-venue-lineup-confirmed",
        publisherDomain: "harborpress.example",
        publishedAt: "2026-08-22T09:00:00Z",
        analysisText:
          "Organizers confirmed the final list of venues for next year's championship, including two newly built arenas.",
      },
      {
        title: "Ticket sales open for confirmed venues",
        url: "https://latticedaily.example/articles/championship-ticket-sales-open",
        publisherDomain: "latticedaily.example",
        publishedAt: "2026-08-23T14:00:00Z",
        analysisText:
          "Ticket sales opened for the confirmed venues, with organizers reporting high early demand for the two newly built arenas.",
      },
    ],
  },
];
