import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import AppShell from "./components/AppShell";
import Masthead from "./components/Masthead";
import HealthStatus from "./pages/HealthStatus";
import Register from "./pages/Register";
import Login from "./pages/Login";
import Account from "./pages/Account";
import RequireAuth from "./pages/RequireAuth";
import DashboardRedirect from "./pages/DashboardRedirect";
import RoleDashboard from "./pages/RoleDashboard";
import Stories from "./pages/Stories";
import StoryDetail from "./pages/StoryDetail";
import ArticleDetail from "./pages/ArticleDetail";
import Search from "./pages/Search";
import SearchTimeline from "./pages/SearchTimeline";
import Graph from "./pages/Graph";
import EntityNeighbourhood from "./pages/EntityNeighbourhood";
import Briefs from "./pages/Briefs";
import BriefForm from "./pages/BriefForm";
import BriefDetail from "./pages/BriefDetail";
import Study from "./pages/Study";
import AdminUsers from "./pages/AdminUsers";

// The route table, and nothing else. Chrome comes from AppShell (authenticated
// routes) and Masthead (sign-in/register/status), applied once here per
// variant rather than by each page. `/` lands on the user's own dashboard
// (RequireAuth bounces a signed-out visitor to /login). Every route in here is
// one a reader reaches: the Bureau design prototype that used to sit beside
// them at /design-prototype went with the system it demonstrated (#73).

// #96 moved the timeline out from under /search. `Navigate` drops the search string on its
// own, and the search *is* the timeline, so the old address forwards with its query intact.
export function TimelineMoved() {
  const { search } = useLocation();
  return <Navigate to={`/timeline${search}`} replace />;
}

function App() {
  return (
    <Routes>
      <Route element={<Masthead />}>
        <Route path="/status" element={<HealthStatus />} />
        <Route path="/register" element={<Register />} />
        <Route path="/login" element={<Login />} />
      </Route>
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/account" element={<Account />} />
        <Route path="/dashboard" element={<DashboardRedirect />} />
        <Route path="/dashboard/:role" element={<RoleDashboard />} />
        <Route path="/admin/users" element={<AdminUsers />} />
        <Route path="/admin/users/:id" element={<AdminUsers />} />
        <Route path="/stories" element={<Stories />} />
        <Route path="/stories/:id" element={<StoryDetail />} />
        <Route path="/articles/:id" element={<ArticleDetail />} />
        <Route path="/search" element={<Search />} />
        {/* The same query read as a timeline (#65). Top-level since #96 promoted it to a
            destination of its own: nested under /search, a nav entry for it would have
            marked Search as the current page too, and it is a reading a reader arrives at
            rather than only a switch off the ranked list. */}
        <Route path="/timeline" element={<SearchTimeline />} />
        {/* Where it used to live. Kept because the address shipped — Phase 3.5's own
            verification record links it — and a moved page that answers 404 loses the
            reader rather than the URL. Carries the query across, since the whole point of
            a timeline link is the search it draws. */}
        <Route path="/search/timeline" element={<TimelineMoved />} />
        {/* The bounded global graph (#68). Its own top-level route, not under /stories:
            ADR-0028's graph reads the retained firehose, which is a different corpus from
            any Story. */}
        <Route path="/graph" element={<Graph />} />
        {/* One name's neighbourhood (#69), reached by opening a name in the view above.
            Under /graph because it is the same graph read closer, and the Entity id in the
            path because a shared link is to one name — the Theme it may be narrowed by
            rides in the query string, where a facet belongs. */}
        <Route path="/graph/entities/:entityId" element={<EntityNeighbourhood />} />
        <Route path="/briefs" element={<Briefs />} />
        <Route path="/briefs/new" element={<BriefForm />} />
        <Route path="/briefs/:id" element={<BriefDetail />} />
        <Route path="/briefs/:id/edit" element={<BriefForm />} />
        <Route path="/study" element={<Study />} />
      </Route>
    </Routes>
  );
}

export default App;
