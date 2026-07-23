"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { CompanyLogo } from "@/components/branding/company-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";

const loginSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

const signupSchema = loginSchema
  .extend({
    fullName: z.string().trim().min(2, "Enter your full name"),
    confirmPassword: z.string().min(6, "Confirm your password"),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type LoginValues = z.infer<typeof loginSchema>;
type SignupValues = z.infer<typeof signupSchema>;

export function LoginForm({
  logoUrl = null,
  companyName = "Acton ADU",
  reportTitle = "Property Research",
  logoAlt = "Acton ADU logo",
}: {
  logoUrl?: string | null;
  companyName?: string;
  reportTitle?: string;
  logoAlt?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const loginForm = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const signupForm = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: { email: "", password: "", confirmPassword: "", fullName: "" },
  });

  async function onSignIn(values: LoginValues) {
    setError(null);
    setInfo(null);
    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: values.email,
        password: values.password,
      });
      if (signInError) {
        setError(signInError.message);
        return;
      }
      const next = searchParams.get("next") || "/dashboard";
      router.replace(next);
      router.refresh();
    } catch {
      setError("Unable to sign in. Confirm your Supabase environment variables are configured.");
    }
  }

  async function onSignUp(values: SignupValues) {
    setError(null);
    setInfo(null);
    try {
      const supabase = createClient();
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: values.email,
        password: values.password,
        options: {
          data: {
            full_name: values.fullName,
            role: "new_user",
          },
        },
      });
      if (signUpError) {
        setError(signUpError.message);
        return;
      }

      if (data.session) {
        router.replace("/pending-access");
        router.refresh();
        return;
      }

      setInfo(
        "Account created. Check your email to confirm, then sign in. An administrator must grant access before you can use the app.",
      );
      setMode("signin");
      loginForm.setValue("email", values.email);
    } catch {
      setError("Unable to create an account. Confirm Supabase auth is configured.");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--acton-gray-50)] px-4">
      <div className="w-full max-w-md space-y-6">
        <CompanyLogo
          href="/login"
          className="justify-center"
          logoUrl={logoUrl}
          companyName={companyName}
          reportTitle={reportTitle}
          alt={logoAlt}
        />
        <Card>
          <CardTitle>{mode === "signin" ? "Sign in" : "Create account"}</CardTitle>
          <CardDescription className="mt-2">
            {mode === "signin"
              ? "Sign in with your Acton account. New accounts stay locked until an administrator grants access."
              : "Create an account to request access. You will receive the new_user role and cannot run research until an admin approves you."}
          </CardDescription>

          <div className="mt-4 flex gap-2">
            <Button
              type="button"
              variant={mode === "signin" ? "primary" : "secondary"}
              className="flex-1"
              onClick={() => {
                setMode("signin");
                setError(null);
              }}
            >
              Sign in
            </Button>
            <Button
              type="button"
              variant={mode === "signup" ? "primary" : "secondary"}
              className="flex-1"
              onClick={() => {
                setMode("signup");
                setError(null);
                setInfo(null);
              }}
            >
              Create account
            </Button>
          </div>

          {mode === "signin" ? (
            <form className="mt-6 space-y-4" onSubmit={loginForm.handleSubmit(onSignIn)}>
              <div>
                <label
                  htmlFor="email"
                  className="mb-2 block text-sm font-semibold text-[var(--acton-navy)]"
                >
                  Email
                </label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  {...loginForm.register("email")}
                />
                {loginForm.formState.errors.email ? (
                  <p className="mt-2 text-sm text-red-700">
                    {loginForm.formState.errors.email.message}
                  </p>
                ) : null}
              </div>
              <div>
                <label
                  htmlFor="password"
                  className="mb-2 block text-sm font-semibold text-[var(--acton-navy)]"
                >
                  Password
                </label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  {...loginForm.register("password")}
                />
                {loginForm.formState.errors.password ? (
                  <p className="mt-2 text-sm text-red-700">
                    {loginForm.formState.errors.password.message}
                  </p>
                ) : null}
              </div>
              {error ? <p className="text-sm text-red-700">{error}</p> : null}
              {info ? <p className="text-sm text-[var(--acton-navy)]">{info}</p> : null}
              <Button type="submit" className="w-full" disabled={loginForm.formState.isSubmitting}>
                {loginForm.formState.isSubmitting ? "Signing in..." : "Sign in"}
              </Button>
            </form>
          ) : (
            <form className="mt-6 space-y-4" onSubmit={signupForm.handleSubmit(onSignUp)}>
              <div>
                <label
                  htmlFor="fullName"
                  className="mb-2 block text-sm font-semibold text-[var(--acton-navy)]"
                >
                  Full name
                </label>
                <Input
                  id="fullName"
                  type="text"
                  autoComplete="name"
                  {...signupForm.register("fullName")}
                />
                {signupForm.formState.errors.fullName ? (
                  <p className="mt-2 text-sm text-red-700">
                    {signupForm.formState.errors.fullName.message}
                  </p>
                ) : null}
              </div>
              <div>
                <label
                  htmlFor="signup-email"
                  className="mb-2 block text-sm font-semibold text-[var(--acton-navy)]"
                >
                  Email
                </label>
                <Input
                  id="signup-email"
                  type="email"
                  autoComplete="email"
                  {...signupForm.register("email")}
                />
                {signupForm.formState.errors.email ? (
                  <p className="mt-2 text-sm text-red-700">
                    {signupForm.formState.errors.email.message}
                  </p>
                ) : null}
              </div>
              <div>
                <label
                  htmlFor="signup-password"
                  className="mb-2 block text-sm font-semibold text-[var(--acton-navy)]"
                >
                  Password
                </label>
                <Input
                  id="signup-password"
                  type="password"
                  autoComplete="new-password"
                  {...signupForm.register("password")}
                />
                {signupForm.formState.errors.password ? (
                  <p className="mt-2 text-sm text-red-700">
                    {signupForm.formState.errors.password.message}
                  </p>
                ) : null}
              </div>
              <div>
                <label
                  htmlFor="confirmPassword"
                  className="mb-2 block text-sm font-semibold text-[var(--acton-navy)]"
                >
                  Confirm password
                </label>
                <Input
                  id="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  {...signupForm.register("confirmPassword")}
                />
                {signupForm.formState.errors.confirmPassword ? (
                  <p className="mt-2 text-sm text-red-700">
                    {signupForm.formState.errors.confirmPassword.message}
                  </p>
                ) : null}
              </div>
              {error ? <p className="text-sm text-red-700">{error}</p> : null}
              <Button type="submit" className="w-full" disabled={signupForm.formState.isSubmitting}>
                {signupForm.formState.isSubmitting ? "Creating account..." : "Create account"}
              </Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
