import { Navigate, Route, Routes } from "react-router-dom";
import BureauPrototype from "./versions/BureauPrototype";
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

// The route table, and nothing else. `/` lands on the user's own dashboard
// (RequireAuth bounces a signed-out visitor to /login); the Phase-3 design
// prototype keeps its own route rather than standing in as the front door.
function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/design-prototype" element={<BureauPrototype />} />
      <Route path="/status" element={<HealthStatus />} />
      <Route path="/register" element={<Register />} />
      <Route path="/login" element={<Login />} />
      <Route
        path="/account"
        element={
          <RequireAuth>
            <Account />
          </RequireAuth>
        }
      />
      <Route
        path="/dashboard"
        element={
          <RequireAuth>
            <DashboardRedirect />
          </RequireAuth>
        }
      />
      <Route
        path="/dashboard/:role"
        element={
          <RequireAuth>
            <RoleDashboard />
          </RequireAuth>
        }
      />
      <Route
        path="/stories"
        element={
          <RequireAuth>
            <Stories />
          </RequireAuth>
        }
      />
      <Route
        path="/stories/:id"
        element={
          <RequireAuth>
            <StoryDetail />
          </RequireAuth>
        }
      />
      <Route
        path="/articles/:id"
        element={
          <RequireAuth>
            <ArticleDetail />
          </RequireAuth>
        }
      />
      <Route
        path="/search"
        element={
          <RequireAuth>
            <Search />
          </RequireAuth>
        }
      />
      <Route
        path="/briefs"
        element={
          <RequireAuth>
            <Briefs />
          </RequireAuth>
        }
      />
      <Route
        path="/briefs/new"
        element={
          <RequireAuth>
            <BriefForm />
          </RequireAuth>
        }
      />
      <Route
        path="/briefs/:id"
        element={
          <RequireAuth>
            <BriefDetail />
          </RequireAuth>
        }
      />
      <Route
        path="/briefs/:id/edit"
        element={
          <RequireAuth>
            <BriefForm />
          </RequireAuth>
        }
      />
    </Routes>
  );
}

export default App;
