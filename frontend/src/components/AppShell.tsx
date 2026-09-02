import { NavLink, Outlet } from "react-router-dom";
import Wordmark from "./Wordmark";
import IdentityMenu from "./IdentityMenu";

const NAV_LINKS = [
  { to: "/stories", label: "Stories" },
  { to: "/search", label: "Search" },
  // #68. Alongside the two reader surfaces rather than under either: the graph reads the
  // retained firehose, so it is a third way into the corpus and not a view of a Story.
  { to: "/graph", label: "Graph" },
  { to: "/briefs", label: "My Briefs" },
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
          {NAV_LINKS.map(({ to, label }) => (
            <NavLink key={to} to={to}>
              {label}
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
