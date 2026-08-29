import { Link } from "react-router-dom";

export default function Wordmark({ to }: { to: string }) {
  return (
    <Link className="site-wordmark" to={to} aria-label="Tessera home">
      <span className="site-mark" aria-hidden="true">
        <i />
        <i />
      </span>
      TESSERA
    </Link>
  );
}
