import { FormEvent, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { register, RegistrableRole } from "../api/client";
import { Field, FormPage, FormSubmit } from "../components/formArchetype";
import { ErrorState } from "../components/uiStates";

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
      navigate("/dashboard");
    } catch (err) {
      setErrors({ form: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <FormPage
      folio="New account"
      title="Register"
      onSubmit={onSubmit}
      aside={
        <>
          Already have an account? <Link to="/login">Log in</Link>
        </>
      }
    >
      <Field id="email" label="Email" error={errors.email}>
        {(props) => (
          <input
            {...props}
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setErrors((prev) => ({ ...prev, email: undefined }));
            }}
            required
          />
        )}
      </Field>
      <Field
        id="password"
        label="Password"
        error={errors.password}
        hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
      >
        {(props) => (
          <input
            {...props}
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setErrors((prev) => ({ ...prev, password: undefined }));
            }}
            required
            minLength={MIN_PASSWORD_LENGTH}
          />
        )}
      </Field>
      <Field id="role" label="Role">
        {(props) => (
          <select {...props} value={role} onChange={(e) => setRole(e.target.value as RegistrableRole)}>
            <option value="student">Student</option>
            <option value="investor">Investor</option>
          </select>
        )}
      </Field>
      {errors.form && <ErrorState>{errors.form}</ErrorState>}
      <FormSubmit pending={submitting} pendingLabel="Registering…">
        Register
      </FormSubmit>
    </FormPage>
  );
}
