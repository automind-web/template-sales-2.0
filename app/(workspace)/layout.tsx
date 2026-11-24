"use client";

import type { ReactNode } from "react";
import { AppShell } from "../../components/app-shell.tsx";
import { SessionProvider } from "../../components/session.tsx";

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
    return (
        <SessionProvider>
            <AppShell>{children}</AppShell>
        </SessionProvider>
    );
}
