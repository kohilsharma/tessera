import { Outlet } from "react-router-dom";
import Wordmark from "./Wordmark";

// Wordmark-only chrome for sign-in, register, and status: a signed-out
// visitor has nowhere else in the app to go yet, so no primary nav.
export default function Masthead() {
  return (
    <>
      <header className="site-header site-header--masthead">
        <Wordmark to="/login" />
      </header>
      <Outlet />
    </>
  );
}
