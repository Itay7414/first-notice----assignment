"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { signOut, useSession } from "@/lib/auth-client";

export function SiteHeader() {
  const router = useRouter();
  const { data: session, isPending } = useSession();

  async function handleSignOut() {
    await signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="flex items-center justify-between border-b px-6 py-3">
      <Link href="/dashboard" className="text-sm font-semibold">
        FirstNotice
      </Link>

      <div className="flex items-center gap-3">
        {!isPending && session && (
          <>
            <span className="text-sm text-muted-foreground">
              {session.user.email}{" "}
              <span className="capitalize">({session.user.role})</span>
            </span>
            <Button variant="outline" size="sm" onClick={handleSignOut}>
              Sign Out
            </Button>
          </>
        )}

        {!isPending && !session && (
          <Link
            href="/login"
            className={cn(buttonVariants({ size: "sm" }))}
          >
            Sign In
          </Link>
        )}
      </div>
    </header>
  );
}
