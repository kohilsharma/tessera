import { useId, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { UserRole } from "../api/client";
import { EntryLedger } from "./indexArchetype";

// The Dashboard archetype: a role-titled surface over one or more registers
// (#28). Shared here so the three roles speak one vocabulary — but only the
// vocabulary: ADR-0004 requires three genuinely distinct surfaces, so what each
// role puts in its registers, and which shape it puts it in, stays the page's
// own. What each register holds and the shape it holds it in are what keep the
// three distinguishable; the head band and the rules are what keep them related.
//
// The four UI states stay the page's own (uiStates.tsx), as on every other
// archetype: a dashboard picks its state before it has data to register.

// `role` is the surface's own class hook, and picks its edge ink where the design
// gives that role one (styles.css) — never the only statement of whose surface
// this is: `folio` says it in words directly above the title. Typed from the
// API's role vocabulary, so a fourth role needs no edit here.
export function DashboardPage({
  role,
  folio,
  title,
  dek,
  children,
}: {
  role: UserRole;
  folio: string;
  title: string;
  dek?: string;
  children: ReactNode;
}) {
  return (
    <main className={`dashboard dashboard--${role}`}>
      <div className="dash-head">
        <p className="dash-folio">{folio}</p>
        <h1>{title}</h1>
        {dek && <p className="dash-dek">{dek}</p>}
      </div>
      {children}
    </main>
  );
}

// One register on the surface: a heading and, opposite it, the folio that states
// what the register holds and how much of it — which is what lets an operator
// tell three registers apart before reading a single row. Labelled by its own
// heading, so the Admin console's three registers are three named landmarks to
// a screen-reader user rather than one undifferentiated run of rows.
//
// `command` is what an operator can do to the register's *subject* rather than to
// any one row — running the clustering pass (#49), which is one pass over the whole
// corpus and so has no row to hang a button on. In the row action's own treatment,
// because it is the same thing at the register's scale.
export function DashboardRegister({
  heading,
  folio,
  command,
  children,
}: {
  heading: string;
  folio: string;
  command?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section className="dash-register" aria-labelledby={headingId}>
      <div className="dash-register-head">
        <h2 id={headingId}>{heading}</h2>
        <p className="dash-register-folio">{folio}</p>
        {command && <div className="entry-action">{command}</div>}
      </div>
      {children}
    </section>
  );
}

// One row of a register: the thing's name against its ledger of facts, in the
// entry register's own geometry (uiStates' EntryList is still the frame). Not
// the Index archetype's Entry: half of what a dashboard registers has no record
// page to link to — a connector, a role count — and Entry's whole contract is
// that its title opens the record.
//
// `note` is a second line under the name for the row's own address — a
// connector's endpoint. In the name column rather than the ledger because a URL
// is longer than every other value on the surface: in a ledger cell it sets the
// column widths for the whole register and leaves the short cells beside it
// ragged.
//
// `measure` (0–1) draws the row's value as a bar beside the number that states
// it: a coverage rollup is read by comparison, and comparing eight integers is
// slower than comparing eight lengths. Omitted where the row's facts are not
// one quantity.
//
// `body` is the row's evidence, under the note: the merge queue's two candidate
// names and the reporting behind each (#67) is a list, not a sentence, so it
// cannot go in the note's paragraph and it is too long for a ledger cell — a
// title in a 32ch `dd` sets the ledger's width from its own length. In the name
// column because it is what the row's name is asserting.
//
// `action` is what an operator can do to the thing this row names — running a
// connector, disabling it (#39). It takes the Index archetype's third ruled
// column, so a register that offers actions keeps the geometry of one that does
// not. A dashboard row's action is the only place in the app where a register row
// commands anything, which is what an operator console is for.
export function RegisterRow({
  name,
  to,
  note,
  measure,
  body,
  meta,
  action,
}: {
  name: string;
  to?: string;
  note?: ReactNode;
  measure?: number;
  body?: ReactNode;
  meta: { term: string; value: ReactNode }[];
  action?: ReactNode;
}) {
  return (
    <li className="entry">
      <div className="dash-entry">
        {to ? (
          <Link className="entry-title" to={to}>
            {name}
          </Link>
        ) : (
          <p className="entry-name">{name}</p>
        )}
        {note && <p className="dash-entry-note">{note}</p>}
        {measure !== undefined && (
          <div className="dash-measure" style={{ "--share": measure } as CSSProperties}>
            <i />
          </div>
        )}
        {body}
      </div>
      <EntryLedger meta={meta} />
      {action && <div className="entry-action">{action}</div>}
    </li>
  );
}

// A register of bare counts, in plates rather than rows: the Admin surface's
// user tally is four numbers and no records, and four numbers in a ruled list of
// one-line rows reads as an inventory of nothing. Same ledger register as
// everywhere else — term in the measurement face — at the display scale a
// standing total earns.
export function CountPlates({ counts }: { counts: { term: string; value: number }[] }) {
  return (
    <dl className="dash-counts">
      {counts.map(({ term, value }) => (
        <div key={term}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// The way off the dashboard, as a ruled band of destinations rather than a line
// of links separated by interpuncts. A dashboard is a landing page: where it
// sends you is part of what it is for. Each role gets its own set — an Admin has
// no Briefs of their own to keep.
export function DashboardOnward({ links }: { links: { to: string; label: string }[] }) {
  return (
    <nav className="dash-onward" aria-label="Elsewhere in Tessera">
      {links.map(({ to, label }) => (
        <Link key={to} to={to}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
