import { NavLink, Outlet } from "react-router-dom";
import Wordmark from "./Wordmark";
import IdentityMenu from "./IdentityMenu";
import {
  Cards,
  ChartBar,
  Graph,
  MagnifyingGlass,
  Newspaper,
  Notebook,
  type Icon,
} from "@phosphor-icons/react";

// #96: an icon per destination, not one. A single iconed entry among five bare ones reads
// as an oversight rather than as emphasis, and the row is the one place in the app a reader
// scans by shape before reading. Each is decorative — `aria-hidden`, so the label stays the
// whole accessible name — because an icon beside its own word tells a screen reader nothing
// the word did not.
const NAV_LINKS: { to: string; label: string; Icon: Icon }[] = [
  { to: "/stories", label: "Stories", Icon: Newspaper },
  { to: "/search", label: "Search", Icon: MagnifyingGlass },
  // #96. Its own destination rather than a switch off /search: the two readings of a query
  // are siblings, and this one was unfindable while it was nested under the other.
  { to: "/timeline", label: "Timeline", Icon: ChartBar },
  // #68. Alongside the two reader surfaces rather than under either: the graph reads the
  // retained firehose, so it is a third way into the corpus and not a view of a Story.
  { to: "/graph", label: "Graph", Icon: Graph },
  { to: "/briefs", label: "My Briefs", Icon: Notebook },
  { to: "/study", label: "Flashcards", Icon: Cards },
];

// The full chrome for authenticated routes — wordmark, primary nav, identity
// control — applied once at the route table (App.tsx) rather than by each
// page. NavLink marks the current route with aria-current="page" on its own.
export default function AppShell() {
  return (
    <>
      <header className="site-header">
        <Wordmark to="/dashboard" />
        <nav className="site-nav" aria-label="Primary navigation">
          {NAV_LINKS.map(({ to, label, Icon }) => (
            <NavLink key={to} to={to}>
              <Icon aria-hidden size={16} /> {label}
            </NavLink>
          ))}
        </nav>
        <IdentityMenu />
      </header>
      <div className="page-ground">
        <Outlet />
      </div>
    </>
  );
}
