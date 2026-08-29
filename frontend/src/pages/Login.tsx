import { FormEvent, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { login } from "../api/client";
import { Field, FormPage, FormSubmit } from "../components/formArchetype";
import { ErrorState } from "../components/uiStates";

type FieldErrors = { email?: string; password?: string; form?: string };

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  // Presence only. Login must not tell a visitor which half of a wrong pair was
  // wrong, so anything beyond "you left this blank" is the backend's 401 to give
  // — which lands in the shared error treatment below the fields, not against a
  // field, because neither field is the one that failed.
  function validate(): FieldErrors {
    const found: FieldErrors = {};
    if (!email) found.email = "Enter your email address";
    if (!password) found.password = "Enter your password";
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
      await login({ email, password });
      navigate("/dashboard");
    } catch (err) {
      setErrors({ form: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <FormPage
      folio="Account access"
      title="Log in"
      onSubmit={onSubmit}
      aside={
        <>
          Need an account? <Link to="/register">Register</Link>
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
      <Field id="password" label="Password" error={errors.password}>
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
          />
        )}
      </Field>
      {errors.form && <ErrorState>{errors.form}</ErrorState>}
      <FormSubmit pending={submitting} pendingLabel="Logging in…">
        Log in
      </FormSubmit>
    </FormPage>
  );
}
