import { Suspense } from "react";
import { AuthForm } from "@/components/auth/AuthForm";
import styles from "@/components/auth/AuthForm.module.css";

export default function LoginPage() {
  return (
    <div className={styles.page}>
      <Suspense fallback={null}>
        <AuthForm mode="login" />
      </Suspense>
    </div>
  );
}
