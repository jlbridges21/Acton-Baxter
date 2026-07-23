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

type LoginValues = z.infer<typeof loginSchema>;

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
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: LoginValues) {
    setError(null);
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
          <CardTitle>Sign in</CardTitle>
          <CardDescription className="mt-2">
            Acton Property Research is an internal tool. Accounts are created by an administrator in
            Supabase. Public registration is not available.
          </CardDescription>
          <form className="mt-6 space-y-4" onSubmit={handleSubmit(onSubmit)}>
            <div>
              <label
                htmlFor="email"
                className="mb-2 block text-sm font-semibold text-[var(--acton-navy)]"
              >
                Email
              </label>
              <Input id="email" type="email" autoComplete="email" {...register("email")} />
              {errors.email ? (
                <p className="mt-2 text-sm text-red-700">{errors.email.message}</p>
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
                {...register("password")}
              />
              {errors.password ? (
                <p className="mt-2 text-sm text-red-700">{errors.password.message}</p>
              ) : null}
            </div>
            {error ? <p className="text-sm text-red-700">{error}</p> : null}
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? "Signing in..." : "Sign in"}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
