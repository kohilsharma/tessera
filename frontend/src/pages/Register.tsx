import { FormEvent, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { register, RegistrableRole } from "../api/client";

// Kept in step with the same rules in backend/src/routes/auth.ts. The backend is
// authoritative; these exist only to fail a field before a round-trip.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

type FieldErrors = { email?: string; password?: string; form?: string };

export default function Register() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<RegistrableRole>("student");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  function validate(): FieldErrors {
    const found: FieldErrors = {};
    if (!EMAIL_RE.test(email)) found.email = "Enter a valid email address";
    if (password.length < MIN_PASSWORD_LENGTH) {
      found.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
    }
    return found;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const found = validate();
    if (found.email || found.password) {
      setErrors(found);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await register({ email, password, role });
      navigate("/account");
    } catch (err) {
      setErrors({ form: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main>
      <h1>Register</h1>
      <form onSubmit={onSubmit} noValidate>
        <div>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setErrors((prev) => ({ ...prev, email: undefined }));
            }}
            required
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? "email-error" : undefined}
          />
          {errors.email && (
            <p id="email-error" role="alert">
              {errors.email}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setErrors((prev) => ({ ...prev, password: undefined }));
            }}
            required
            minLength={MIN_PASSWORD_LENGTH}
            aria-invalid={Boolean(errors.password)}
            aria-describedby={errors.password ? "password-error" : "password-hint"}
          />
          {errors.password ? (
            <p id="password-error" role="alert">
              {errors.password}
            </p>
          ) : (
            <p id="password-hint">At least {MIN_PASSWORD_LENGTH} characters.</p>
          )}
        </div>
        <div>
          <label htmlFor="role">Role</label>
          <select id="role" value={role} onChange={(e) => setRole(e.target.value as RegistrableRole)}>
            <option value="student">Student</option>
            <option value="investor">Investor</option>
          </select>
        </div>
        {errors.form && <p role="alert">{errors.form}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? "Registering…" : "Register"}
        </button>
      </form>
      <p>
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </main>
  );
}
