export type Evidence = {
  id: string;
  publisher: string;
  date: string;
  title: string;
  excerpt: string;
  mode: string;
  hash: string;
  ink: "blue" | "magenta";
};

export type Claim = {
  id: string;
  type: "Consensus" | "Source-specific" | "Contradiction" | "Lens-specific";
  text: string;
  evidence: string[];
  contradicts?: string[];
};

export type Filter = (typeof filters)[number];
// Prototype only: one claim list toggled by lens. The real Investor role is a
// distinct dashboard, "deliberately NOT Student + one lens" (CONTEXT.md, ADR-0021).
export type Lens = "Student" | "Investor";

export const evidence: Evidence[] = [
  {
    id: "A1",
    publisher: "Reuters",
    date: "28 Jul 2026",
    title: "European chip consortium confirms first pilot line",
    excerpt: "The consortium said its pilot line will begin limited production in Dresden during the fourth quarter, with broader qualification expected next year.",
    mode: "api_content",
    hash: "7e9c06e2a81f9d43117c04933248690d994fd506a65d47d223434f0b871f14af",
    ink: "blue",
  },
  {
    id: "A2",
    publisher: "Nikkei Asia",
    date: "28 Jul 2026",
    title: "Equipment constraints shadow European chip expansion",
    excerpt: "Two suppliers said delivery schedules for advanced lithography components remain the principal constraint on the planned ramp.",
    mode: "feed_excerpt",
    hash: "0a2b7635019c7ea3c74a3b1804ee24518e467f7f11a4bbd2c3e5f60e33dd8b51",
    ink: "magenta",
  },
  {
    id: "A3",
    publisher: "Financial Times",
    date: "29 Jul 2026",
    title: "Funding terms complicate semiconductor alliance",
    excerpt: "Member states have approved the initial funding package, though final disbursement remains tied to national subsidy reviews.",
    mode: "licensed_full_text",
    hash: "d93f819760a78544f1833ca0149c2512ce0ccb452bfd8f28e010c6708ed51db7",
    ink: "blue",
  },
  {
    id: "A4",
    publisher: "Handelsblatt",
    date: "29 Jul 2026",
    title: "Dresden pilot targets fourth-quarter start",
    excerpt: "Project leaders maintained the fourth-quarter target and described supplier discussions as part of normal commissioning work.",
    mode: "feed_excerpt",
    hash: "624fdd2fb136538a5fb96b93aff33e13f22877109fd728e757ade661ade179ca",
    ink: "magenta",
  },
];

export const claims: Claim[] = [
  {
    id: "C1",
    type: "Consensus",
    text: "The consortium is targeting limited pilot production in Dresden during the fourth quarter of 2026.",
    evidence: ["A1", "A4"],
  },
  {
    id: "C2",
    type: "Source-specific",
    text: "Final public funding remains conditional on national subsidy reviews, according to the Financial Times.",
    evidence: ["A3"],
  },
  {
    id: "C3",
    type: "Contradiction",
    text: "Reporting differs on whether equipment supply is a material schedule risk or routine commissioning work.",
    evidence: ["A2"],
    contradicts: ["A4"],
  },
  {
    id: "C4",
    type: "Lens-specific",
    text: "The pilot line tests manufacturing processes before high-volume production; meeting a pilot date does not establish commercial scale.",
    evidence: ["A1", "A3"],
  },
];

export const filters = ["All claims", "Consensus", "Source-specific", "Contradiction", "Lens-specific"] as const;

export const modeDescription: Record<Evidence["mode"], string> = {
  api_content: "Full text pulled via GDELT DOC API",
  feed_excerpt: "Headline and excerpt via RSS feed",
  licensed_full_text: "Licensed full text via partner agreement",
};
