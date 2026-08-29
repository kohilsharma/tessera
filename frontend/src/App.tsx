import { Navigate, Route, Routes } from "react-router-dom";
import BureauPrototype from "./versions/BureauPrototype";
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
import Briefs from "./pages/Briefs";
import BriefForm from "./pages/BriefForm";
import BriefDetail from "./pages/BriefDetail";

// The route table, and nothing else. Chrome comes from AppShell (authenticated
// routes) and Masthead (sign-in/register/status), applied once here per
// variant rather than by each page. `/` lands on the user's own dashboard
// (RequireAuth bounces a signed-out visitor to /login); the Phase-3 design
// prototype keeps its own route, with no chrome, rather than standing in as
// the front door.
function App() {
  return (
    <Routes>
      <Route path="/design-prototype" element={<BureauPrototype />} />
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
        <Route path="/stories" element={<Stories />} />
        <Route path="/stories/:id" element={<StoryDetail />} />
        <Route path="/articles/:id" element={<ArticleDetail />} />
        <Route path="/search" element={<Search />} />
        <Route path="/briefs" element={<Briefs />} />
        <Route path="/briefs/new" element={<BriefForm />} />
        <Route path="/briefs/:id" element={<BriefDetail />} />
        <Route path="/briefs/:id/edit" element={<BriefForm />} />
      </Route>
    </Routes>
  );
}

export default App;
