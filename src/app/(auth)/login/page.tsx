import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  return (
    <main className="flex min-h-screen flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-heading font-bold text-primary-deep">AyuSphere</p>
          <p className="mt-1 opacity-70">
            Clinical Research Intelligence for Ayurveda
          </p>
        </div>
        <LoginForm />
        <p className="mt-6 text-center opacity-50">
          SIH26046 · synthetic demo data only
        </p>
      </div>
    </main>
  );
}
