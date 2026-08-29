import type { ReactNode } from "react";
import { Link } from "react-router-dom";

// The Record archetype: a masthead (folio, way back, title, dek) over a ledger
// of provenance facts, over the record's body. Shared here rather than written
// into Story detail, because Article detail wants the same one now and Brief
// detail wants it next (#34) — one record vocabulary, not three.
//
// No page-root component: a record's root is a plain <main>, and a wrapper that
// added nothing but a class no stylesheet reads would be one.
//
// The four UI states stay the page's own (uiStates.tsx): a record page picks
// its state before it has a record to draw a masthead for.

// `folio` names what kind of record this is, `back` is the way out of it — the
// pair sits above the title in the register the design uses for identity.
// Both are required: a record with no stated kind and no exit is the dead end
// this archetype exists to stop being.
//
// `ledger` is the prototype's ledger pattern — monospace uppercase term over a
// weighted value, hard rules between cells — carrying the facts about the
// record, kept out of the body, which carries the record itself.
export function RecordMasthead({
  folio,
  back,
  title,
  dek,
  ledger,
}: {
  folio: string;
  back: { to: string; label: string };
  title: string;
  dek?: ReactNode;
  ledger: { term: string; value: ReactNode }[];
}) {
  return (
    <section className="record-mast">
      <div className="record-mast-body">
        <div className="record-mast-head">
          <p className="record-folio">{folio}</p>
          <Link className="record-return" to={back.to}>
            {back.label}
          </Link>
        </div>
        <h1>{title}</h1>
        {dek && <p className="record-dek">{dek}</p>}
      </div>
      <dl className="record-ledger">
        {ledger.map(({ term, value }) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// One section of the record's body, under a heading in the register the mast's
// title is not: the mast is the record's identity, a section is one part of its
// substance.
export function RecordSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="record-section">
      <h2>{heading}</h2>
      {children}
    </section>
  );
}
