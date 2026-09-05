import { Link, Navigate } from "react-router-dom";
import { ArrowRight, CheckCircle, Lock, ShieldCheck, TrendUp, Warning } from "@phosphor-icons/react";
import { getToken } from "../auth/token";
import { CitationChip } from "../components/primitives";
import styles from "./Landing.module.css";

// The one composition on this page is a board: a fixed column grid, tabular figures,
// and a status column read top to bottom, the way a departure board is read. It is not
// decoration — the pipeline genuinely is four ordered stages, and the ordering is the
// product's whole argument, so the page states it in the form that carries an order.
//
// Nothing here is invented data. PRODUCT.md rules out fabricated evidence, so the board
// describes the mechanism rather than pretending to be a corpus, and the sample claims
// below are labelled as the shapes they are rather than dressed up as real reporting.

const PIPELINE = [
  {
    stage: "Ingest",
    detail: "Four sources, one connector seam",
    note: "RSS · GKG firehose · DOC API · Readability",
    status: "canonical url is identity",
  },
  {
    stage: "Cluster",
    detail: "Related reporting becomes a Story",
    note: "Two publishers, or it is not a Story",
    status: "below threshold goes to review",
  },
  {
    stage: "Freeze",
    detail: "The evidence is pinned before the model runs",
    note: "Stable ids, SHA-256 over the set",
    status: "immutable",
    held: true,
  },
  {
    stage: "Cite",
    detail: "Claims may cite the frozen set and nothing else",
    note: "Checked in backend code, beneath the prompt",
    status: "uncited claims are dropped",
  },
];

const CLAIM_SHAPES = [
  {
    tone: "agree" as const,
    icon: CheckCircle,
    name: "Consensus",
    body: "What every source in the set reports the same way.",
  },
  {
    tone: "diverge" as const,
    icon: Warning,
    name: "Contradiction",
    body: "Where the reporting disagrees — kept apart, not averaged into one summary.",
  },
  {
    tone: "imply" as const,
    icon: TrendUp,
    name: "Implication",
    body: "What follows for a reader, with the stakeholders and the uncertainty stated.",
  },
];

const ROLES = [
  { name: "Student", body: "Guided reading, cited flashcards on a spaced schedule, and Briefs you own." },
  { name: "Investor", body: "Consensus against contradiction, publisher leaning with a blindspot signal, market indicators beside the reporting." },
  { name: "Admin", body: "Connectors, the review queues, generation failures, and versioned prompt tuning." },
];

export default function Landing() {
  // Signed in already: the front door is not a place to linger.
  if (getToken()) return <Navigate to="/dashboard" replace />;

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <h1 className={styles.headline}>
          Analysis you can <em>check</em>, not analysis you have to trust.
        </h1>
        <p className={styles.lede}>
          Tessera reads reporting from many outlets, groups it into Stories as they develop, and
          writes analysis where every claim points back at the reporting it came from. Follow any
          claim to the exact article snapshot behind it.
        </p>
        <div className={styles.actions}>
          <Link className={styles.primary} to="/login">
            Sign in <ArrowRight aria-hidden size={17} weight="bold" />
          </Link>
          <Link className={styles.secondary} to="/register">
            Create an account
          </Link>
        </div>
      </section>

      <section className={styles.board} aria-labelledby="pipeline-heading">
        <div className={styles.boardHead}>
          <h2 id="pipeline-heading">How a claim earns its place</h2>
          <p>The order is the argument. Evidence is fixed before any model is asked anything.</p>
        </div>
        <ol className={styles.rows}>
          {PIPELINE.map((row, index) => (
            <li key={row.stage} className={styles.row} data-held={row.held || undefined}>
              <span className={styles.index}>{String(index + 1).padStart(2, "0")}</span>
              <span className={styles.stage}>{row.stage}</span>
              <span className={styles.detail}>
                {row.detail}
                <small>{row.note}</small>
              </span>
              <span className={styles.status}>
                {row.held && <Lock aria-hidden size={13} weight="fill" />}
                {row.status}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.shapes} aria-labelledby="shapes-heading">
        <h2 id="shapes-heading">Agreement and disagreement stay separate</h2>
        <ul>
          {CLAIM_SHAPES.map(({ tone, icon: Icon, name, body }) => (
            <li key={name} data-tone={tone}>
              <Icon aria-hidden size={22} weight="duotone" />
              <h3>{name}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ul>
        <p className={styles.sample}>
          Every displayed claim carries chips like these, and each one opens the reporting under it:
          <span className={styles.chips}>
            <CitationChip evidenceId="A1" publisher="Reuters" href="/login" />
            <CitationChip evidenceId="A2" publisher="BBC News" href="/login" />
          </span>
        </p>
      </section>

      <section className={styles.roles} aria-labelledby="roles-heading">
        <h2 id="roles-heading">Three roles, three different products</h2>
        <p className={styles.rolesLede}>
          Not one screen with permissions over it. The roles differ in what they are asked, what
          they are shown, and what the system will refuse them.
        </p>
        <dl>
          {ROLES.map((role) => (
            <div key={role.name}>
              <dt>{role.name}</dt>
              <dd>{role.body}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={styles.invariant}>
        <ShieldCheck aria-hidden size={26} weight="duotone" />
        <p>
          <strong>No displayed claim without a valid citation.</strong> That rule lives in backend
          code underneath the prompt, so no amount of prompt tuning reaches it. A claim citing
          something outside its frozen evidence is dropped before anyone sees it.
        </p>
      </section>

      <footer className={styles.foot}>
        <span>Tessera — evidence-grounded news intelligence.</span>
        <Link to="/status">API status</Link>
      </footer>
    </main>
  );
}
