import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ArticleSummary } from "../api/client";
import { Pagination, type PaginationEnvelope } from "./listControls";
import { EntryList } from "./uiStates";

// The Index archetype: a filter register above a ruled entry list above
// pagination. Defined here as a shared layout rather than as Stories markup,
// because Briefs and Search want the same one (#32) and three inventions of one
// layout is how a list vocabulary drifts.
//
// The four UI states stay the page's own choice (uiStates.tsx): Search's no-term
// state has no equivalent on Stories, so the archetype holds the frame and the
// entry, not the state machine.

// `action` is the one thing an index can offer besides its list — Briefs' "New
// Brief". It sits with the title rather than floating above the register,
// because the register is about narrowing what is already there.
export function IndexPage({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="index">
      <div className="index-head">
        <h1>{title}</h1>
        {action}
      </div>
      {children}
    </main>
  );
}

// The filter register: the page's filter, sort, and date-range pills read as one
// ruled band rather than loose form fields. A form because the controls are
// controls, named because a named form is a landmark a screen-reader user can
// jump to; `label` because what is being filtered differs per page.
export function FilterRegister({ label, children }: { label: string; children: ReactNode }) {
  return (
    <form className="filter-register" aria-label={label} onSubmit={(e) => e.preventDefault()}>
      {children}
    </form>
  );
}

// The list's populated frame and its pagination in one place, in the order the
// archetype names: entries above the control that says where in the result set
// they fall. Kept together so the three indexes can't order them differently.
// (EntryList alone is still right for a list with no pages — a Story's
// Articles.)
export function EntryRegister({
  envelope,
  onGoToPage,
  children,
}: {
  envelope: PaginationEnvelope;
  onGoToPage: (page: number) => void;
  children: ReactNode;
}) {
  return (
    <>
      <EntryList>{children}</EntryList>
      <Pagination envelope={envelope} onGoToPage={onGoToPage} />
    </>
  );
}

// One entry in the register: the record's name, and the facts you scan a corpus
// by. `meta` is the prototype's ledger pattern — monospace uppercase term over a
// weighted value — so provenance reads as provenance and not as prose.
//
// `cover` is the plate a Brief's cover image sits on: passing it draws the plate,
// omitting it is a record type that has no cover (a Story, a search result). The
// node inside may render nothing — a Brief with no image, or one still fetching —
// and the row still holds its shape, which is the point of the plate.
//
// `action` is what can be done to this entry's membership of the list it is in —
// detaching an Article from a Brief (#34). Not what can be done to the record:
// the record's own actions live on its record page.
export function Entry({
  to,
  title,
  cover,
  meta,
  action,
}: {
  to: string;
  title: string;
  cover?: ReactNode;
  meta: { term: string; value: ReactNode }[];
  action?: ReactNode;
}) {
  return (
    <li className="entry">
      {cover !== undefined && <div className="entry-cover">{cover}</div>}
      <Link className="entry-title" to={to}>
        {title}
      </Link>
      <dl className="entry-register">
        {meta.map(({ term, value }) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {action && <div className="entry-action">{action}</div>}
    </li>
  );
}

// A corpus Article listed under the record that holds it — a Story's coverage
// (#33) or a Brief's attachments (#34). One definition because it is one row in
// both: the same provenance, in the same order, linking to the same record page.
// A search result is not this row — it carries its Story and its score, and
// belongs to the index that ranked it.
export function ArticleEntry({ article, action }: { article: ArticleSummary; action?: ReactNode }) {
  return (
    <Entry
      to={`/articles/${article.id}`}
      title={article.title}
      meta={[
        { term: "Publisher", value: article.publisher.name },
        {
          term: "Published",
          value: <time dateTime={article.publishedAt}>{new Date(article.publishedAt).toLocaleDateString()}</time>,
        },
      ]}
      action={action}
    />
  );
}
