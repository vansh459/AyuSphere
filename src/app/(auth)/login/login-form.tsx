"use client";

import { useActionState } from "react";
import { motion } from "framer-motion";
import { fadeRise } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { loginAction, type LoginState } from "./actions";

export function LoginForm() {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    loginAction,
    {},
  );

  return (
    <motion.div
      variants={fadeRise}
      initial="hidden"
      animate="visible"
      className="glass p-6"
    >
      <form action={formAction} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="pi@aiia.demo"
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
        {state.error ? (
          <p role="alert" className="text-danger">
            {state.error}
          </p>
        ) : null}
        <Button type="submit" disabled={pending} className="mt-2">
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </motion.div>
  );
}
