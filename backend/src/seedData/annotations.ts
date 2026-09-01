import type { GkgAnnotationKind, GkgLocationDetail } from "../entities/GkgAnnotation";
import type { ParsedAnnotation } from "../ingestion/gkg";
import type { SeedArticle } from "./corpus";

// #62. The Curated Corpus's own GKG Annotations, hand-authored. The firehose half
// of the graph rolls over weekly with the Retention Window (ADR-0028); fixture
// Articles have no discovering connector, so retention never touches them and
// these are the permanent half (ADR-0029). They are staged through the connector's
// own `stageAnnotations`, so occurrence identity — and therefore idempotence — is
// the same code path GKG goes through.
//
// Persons and organizations are invented, like the reporting and the Publishers
// they appear in (ADR-0007): a fixture body is not a thing anyone said, so putting
// a real newsroom's or a real executive's name in one would be a fabricated
// attribution. Locations are real, because a location annotation carries gazetteer
// detail and inventing coordinates would make the map view lie about where a place
// is. Names recur across Articles and across Stories on purpose — an entity graph
// of isolated nodes demonstrates nothing (ADR-0019).

// Gazetteer detail written once per place, so the same surface name resolves to
// one Entity across the corpus however many Articles mention it. Country codes are
// FIPS 10-4, as GDELT reports them, not ISO — Switzerland is SZ, Germany GM.
//
// ponytail: the FeatureIDs are invented, in GNS/GNIS shape (negative outside the
// US, positive inside it). Nothing resolves against a real gazetteer — #63 is
// where resolution decides what it keys on — and a stable id per place is the only
// property that is load-bearing here.
const PLACES = {
  Amsterdam: { featureId: "-2759794", countryCode: "NL", latitude: 52.3676, longitude: 4.9041 },
  Atlanta: { featureId: "4180439", countryCode: "US", latitude: 33.749, longitude: -84.388 },
  Basel: { featureId: "-2661604", countryCode: "SZ", latitude: 47.5596, longitude: 7.5886 },
  Brussels: { featureId: "-2800866", countryCode: "BE", latitude: 50.8503, longitude: 4.3517 },
  Chicago: { featureId: "4887398", countryCode: "US", latitude: 41.8781, longitude: -87.6298 },
  Doha: { featureId: "-290030", countryCode: "QA", latitude: 25.2854, longitude: 51.531 },
  Dresden: { featureId: "-2935022", countryCode: "GM", latitude: 51.0504, longitude: 13.7373 },
  Dublin: { featureId: "-2964574", countryCode: "EI", latitude: 53.3498, longitude: -6.2603 },
  Frankfurt: { featureId: "-2925533", countryCode: "GM", latitude: 50.1109, longitude: 8.6821 },
  Geneva: { featureId: "-2660646", countryCode: "SZ", latitude: 46.2044, longitude: 6.1432 },
  Hamburg: { featureId: "-2911298", countryCode: "GM", latitude: 53.5511, longitude: 9.9937 },
  Hsinchu: { featureId: "-1729911", countryCode: "TW", latitude: 24.8039, longitude: 120.9647 },
  Kourou: { featureId: "-3381538", countryCode: "FG", latitude: 5.1594, longitude: -52.6503 },
  Lisbon: { featureId: "-2267057", countryCode: "PO", latitude: 38.7223, longitude: -9.1393 },
  Porto: { featureId: "-2735943", countryCode: "PO", latitude: 41.1579, longitude: -8.6291 },
  Rotterdam: { featureId: "-2747891", countryCode: "NL", latitude: 51.9244, longitude: 4.4777 },
  Seattle: { featureId: "5809844", countryCode: "US", latitude: 47.6062, longitude: -122.3321 },
  Taipei: { featureId: "-1668341", countryCode: "TW", latitude: 25.033, longitude: 121.5654 },
  Toulouse: { featureId: "-2972315", countryCode: "FR", latitude: 43.6047, longitude: 1.4442 },
  Uppsala: { featureId: "-2666199", countryCode: "SW", latitude: 59.8586, longitude: 17.6389 },
  Wellington: { featureId: "-2179537", countryCode: "NZ", latitude: -41.2866, longitude: 174.7756 },
  Zurich: { featureId: "-2657896", countryCode: "SZ", latitude: 47.3769, longitude: 8.5417 },
} satisfies Record<string, GkgLocationDetail>;

type SeedAnnotation = {
  kind: GkgAnnotationKind;
  // The exact substring of the Article's own `analysisText` this occurrence sits
  // at. The character offset is *derived* from it at seed time rather than written
  // by hand, so an annotation naming something the body does not say cannot be
  // seeded at all — which is the acceptance criterion "plausible against each
  // fixture Article's own text", enforced by code instead of by proofreading.
  anchor: string;
  // Defaults to the anchor. Set where GKG's reported name is not the text's own
  // wording: a theme is a code, and a person GKG reports without their title.
  surfaceName?: string;
  locationDetail?: GkgLocationDetail;
};

const person = (anchor: string): SeedAnnotation => ({ kind: "person", anchor });
const org = (anchor: string): SeedAnnotation => ({ kind: "organization", anchor });
const place = (anchor: keyof typeof PLACES): SeedAnnotation => ({
  kind: "location",
  anchor,
  locationDetail: PLACES[anchor],
});
// GKG anchors a theme on the word that triggered it — an occupation word triggers
// the TAX_FNCACT_* family — so the code is the surface name and the trigger word is
// where it sits.
const theme = (code: string, anchor: string): SeedAnnotation => ({
  kind: "theme",
  anchor,
  surfaceName: code,
});

// Keyed by the fixture Article's URL, which is what the seed already identifies an
// Article by — a slug or an index would be a second identity to keep in step.
const SEED_ANNOTATIONS: Record<string, SeedAnnotation[]> = {
  "https://meridianwire.example/articles/packaging-plant-groundbreaking": [
    org("Halcyon Semiconductor"),
    person("Dana Ilves"),
    place("Hsinchu"),
    theme("TAX_FNCACT_CHIEF_EXECUTIVE", "chief executive"),
  ],
  "https://latticedaily.example/articles/foundry-packaging-investment": [
    org("Tessellate Foundry"),
    person("Ana Ruiz"),
    place("Dresden"),
    theme("TAX_FNCACT_DIRECTOR", "director"),
  ],
  "https://outpostjournal.example/articles/packaging-bottleneck-analysis": [
    org("Cardinal Research"),
    org("Halcyon Semiconductor"),
    org("Tessellate Foundry"),
    org("Northwind Cloud"),
    person("Marisol Vance"),
    place("Taipei"),
    theme("TAX_FNCACT_ANALYSTS", "analysts"),
  ],
  "https://harborpress.example/articles/cloud-capex-guidance": [
    org("Northwind Cloud"),
    org("Halcyon Semiconductor"),
    person("Peter Lindqvist"),
    place("Seattle"),
    theme("TAX_FNCACT_ANALYSTS", "analysts"),
  ],
  "https://veritynews.example/articles/second-cloud-inference-spend": [
    org("Aurora Compute"),
    person("Neve Halloran"),
    place("Dublin"),
    theme("TAX_FNCACT_CHIEF_EXECUTIVE", "chief executive"),
    theme("TAX_FNCACT_ANALYSTS", "analysts"),
  ],
  "https://northfieldrecord.example/articles/tariff-talks-open": [
    org("Adriatic Economic Council"),
    person("Ingrid Solberg"),
    place("Geneva"),
    theme("TAX_FNCACT_MINISTERS", "ministers"),
    theme("ECON_TRADE_DISPUTE", "tariff"),
  ],
  "https://cascadebulletin.example/articles/tariff-talks-first-session": [
    org("Adriatic Economic Council"),
    person("Ingrid Solberg"),
    place("Geneva"),
    place("Brussels"),
    theme("TAX_FNCACT_OFFICIALS", "Officials"),
    theme("TAX_FNCACT_REPORTERS", "reporters"),
  ],
  "https://fieldingtimes.example/articles/disclosure-proposal-unveiled": [
    org("Fairwater Electoral Commission"),
    person("Priya Raman"),
    place("Wellington"),
    theme("TAX_FNCACT_COMMISSIONER", "commissioner"),
    theme("ELECTION", "Electoral"),
  ],
  "https://meridianwire.example/articles/disclosure-rules-reaction": [
    org("Civic Ledger Project"),
    org("Fairwater Electoral Commission"),
    person("Priya Raman"),
    place("Wellington"),
    theme("TAX_FNCACT_ADVOCATES", "advocacy"),
    theme("ELECTION", "Electoral"),
  ],
  "https://harborpress.example/articles/central-bank-rate-hold": [
    org("Bank of Halden"),
    person("Kofi Mensah"),
    place("Frankfurt"),
    theme("ECON_INTEREST_RATES", "interest rate"),
    theme("ECON_INFLATION", "inflation"),
    theme("TAX_FNCACT_GOVERNOR", "governor"),
  ],
  "https://latticedaily.example/articles/rate-hold-market-reaction": [
    org("Bank of Halden"),
    person("Kofi Mensah"),
    place("Zurich"),
    theme("TAX_FNCACT_TRADERS", "Traders"),
  ],
  "https://outpostjournal.example/articles/rate-pause-economist-views": [
    org("Cardinal Research"),
    org("Bank of Halden"),
    person("Marisol Vance"),
    place("Frankfurt"),
    theme("TAX_FNCACT_ECONOMISTS", "Economists"),
  ],
  "https://veritynews.example/articles/discount-retailer-earnings-beat": [
    org("Bellmark Stores"),
    org("Ardenne Group"),
    person("Rosa Aguilar"),
    place("Chicago"),
    theme("TAX_FNCACT_CHIEF_EXECUTIVE", "chief executive"),
    theme("TAX_FNCACT_SHOPPERS", "shoppers"),
  ],
  "https://northfieldrecord.example/articles/midmarket-chain-outlook-cut": [
    org("Ardenne Group"),
    org("Cardinal Research"),
    org("Bellmark Stores"),
    person("Marisol Vance"),
    place("Atlanta"),
    theme("TAX_FNCACT_ANALYST", "analyst"),
  ],
  "https://cascadebulletin.example/articles/superconductor-partial-replication": [
    org("Meridian Institute of Technology"),
    person("Amara Okonjo"),
    place("Uppsala"),
    theme("TAX_FNCACT_RESEARCHERS", "Researchers"),
  ],
  "https://fieldingtimes.example/articles/superconductor-caution-urged": [
    org("Meridian Institute of Technology"),
    person("Halvard Reyes"),
    person("Amara Okonjo"),
    place("Zurich"),
    theme("TAX_FNCACT_PHYSICISTS", "Physicists"),
  ],
  "https://meridianwire.example/articles/lunar-resupply-launch-window": [
    org("Continental Space Agency"),
    person("Elena Marchetti"),
    place("Kourou"),
    theme("TAX_FNCACT_DIRECTOR", "director"),
  ],
  "https://harborpress.example/articles/lunar-mission-science-payload": [
    org("Meridian Institute of Technology"),
    org("Continental Space Agency"),
    person("Elena Marchetti"),
    place("Toulouse"),
    theme("TAX_FNCACT_DIRECTOR", "director"),
  ],
  "https://latticedaily.example/articles/vaccine-formulation-review-opens": [
    org("Federal Medicines Board"),
    org("Vantis Biologics"),
    person("Yusuf Haddad"),
    place("Basel"),
    theme("MEDICAL", "medical"),
    theme("TAX_FNCACT_DIRECTOR", "director"),
  ],
  "https://outpostjournal.example/articles/vaccine-manufacturer-trial-data": [
    org("Vantis Biologics"),
    org("Federal Medicines Board"),
    person("Yusuf Haddad"),
    place("Amsterdam"),
    theme("MEDICAL", "clinical"),
    theme("TAX_FNCACT_REVIEWERS", "reviewers"),
  ],
  "https://veritynews.example/articles/seawall-construction-accelerated": [
    org("Harborline Water Authority"),
    person("Lena Brandt"),
    place("Rotterdam"),
    theme("NATURAL_DISASTER_FLOOD", "flood"),
    theme("TAX_FNCACT_OFFICIALS", "officials"),
    theme("TAX_FNCACT_ENGINEER", "engineer"),
  ],
  "https://northfieldrecord.example/articles/flood-defense-funding-commitment": [
    org("Harborline Water Authority"),
    person("Lena Brandt"),
    place("Hamburg"),
    theme("NATURAL_DISASTER_FLOOD", "flood"),
    theme("TAX_FNCACT_ENGINEER", "engineer"),
  ],
  "https://cascadebulletin.example/articles/ceasefire-talks-resume": [
    org("Levant Contact Group"),
    person("Tomas Weller"),
    place("Geneva"),
    theme("CEASEFIRE", "ceasefire"),
    theme("TAX_FNCACT_MEDIATORS", "Mediators"),
  ],
  "https://fieldingtimes.example/articles/ceasefire-breakthrough-accounts": [
    org("Levant Contact Group"),
    person("Tomas Weller"),
    place("Doha"),
    theme("TAX_FNCACT_REPORTERS", "reporters"),
  ],
  "https://meridianwire.example/articles/regional-bloc-welcomes-talks": [
    org("Adriatic Economic Council"),
    person("Tomas Weller"),
    place("Brussels"),
    theme("TAX_FNCACT_DIPLOMATS", "diplomats"),
  ],
  "https://harborpress.example/articles/championship-venue-lineup-confirmed": [
    org("Lisbon Organizing Committee"),
    person("Sofia Duarte"),
    place("Lisbon"),
    theme("TAX_FNCACT_ORGANIZERS", "Organizers"),
    theme("TAX_FNCACT_PRESIDENT", "president"),
  ],
  "https://latticedaily.example/articles/championship-ticket-sales-open": [
    org("Lisbon Organizing Committee"),
    person("Sofia Duarte"),
    place("Porto"),
    theme("TAX_FNCACT_ORGANIZERS", "organizers"),
  ],
};

// One fixture Article's annotations, with offsets located in its own text. Throws
// rather than dropping: an anchor the body does not contain is an authoring
// mistake, and a seed that quietly staged fewer occurrences than were written
// would leave a hole in the demo graph nobody would notice until a reviewer did.
export function seedAnnotationsFor(article: SeedArticle): ParsedAnnotation[] {
  const authored = SEED_ANNOTATIONS[article.url];
  if (!authored) throw new Error(`No seed annotations authored for ${article.url}`);
  return authored.map((annotation) => {
    const charOffset = article.analysisText.indexOf(annotation.anchor);
    if (charOffset < 0) {
      throw new Error(`Seed annotation anchor "${annotation.anchor}" is not in ${article.url}`);
    }
    return {
      kind: annotation.kind,
      surfaceName: annotation.surfaceName ?? annotation.anchor,
      charOffset,
      locationDetail: annotation.locationDetail ?? null,
    };
  });
}
