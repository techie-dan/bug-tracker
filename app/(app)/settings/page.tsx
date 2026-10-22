import { ThemeSettings } from "@/components/theme-settings";
import { parseTheme } from "@/lib/theme";
import Link from "next/link";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { NotificationSettings } from "@/components/notification-settings";
import { DisplayNameForm } from "@/components/display-name-form";
import { WalletAddressForm } from "@/components/wallet-address-form";
import { KeyboardShortcutSettings } from "@/components/keyboard-shortcut-settings";
import { isAgentPlatformEnabled } from "@/lib/feature-flags";
import { ChangePasswordForm } from "@/components/change-password-form";
import { AccountDataSettings } from "@/components/account-data-settings";

/* Distinct browser-tab title; the root layout appends "· Ziki". */
export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  let settings: {
    name?: string | null;
    email?: string | null;
    theme?: string | null;
    walletAddress?: string | null;
    emailNotifications?: boolean;
    notifyMentions?: boolean;
    notifyAssignments?: boolean;
    notifyStatusChanges?: boolean;
    keyboardShortcuts?: boolean;
    passwordHash?: string | null;
  } | null = null;

  try {
    settings = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        name: true,
        email: true,
        theme: true,
        walletAddress: true,
        emailNotifications: true,
        notifyMentions: true,
        notifyAssignments: true,
        notifyStatusChanges: true,
        keyboardShortcuts: true,
        passwordHash: true,
      },
    });
  } catch (error) {
    console.error("[settings] full settings query failed, falling back to minimal fields:", error);
    try {
      settings = await prisma.user.findUnique({
        where: { id: user.id },
        select: {
          name: true,
          email: true,
        },
      });
    } catch (fallbackError) {
      console.error("[settings] fallback user query failed:", fallbackError);
      settings = {
        name: user.name ?? null,
        email: user.email ?? null,
      };
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <Link href="/issues" className="text-sm text-teal-700 hover:underline">
          ← Back to issues
        </Link>
        <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
      </div>
      <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Profile
        </h2>
        <DisplayNameForm initialName={settings?.name ?? user.name ?? ""} />
        <p className="mt-3 text-sm">
          <Link href={`/users/${user.id}`} className="text-teal-700 hover:underline">
            See how your profile looks to others
          </Link>
        </p>
      </section>
      {settings?.passwordHash ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Password</h2>
          <p className="mt-2 text-sm text-slate-600">Changing your password signs out all active sessions.</p>
          <ChangePasswordForm />
        </section>
      ) : null}
      <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Wallet
        </h2>
        <WalletAddressForm initialAddress={settings?.walletAddress ?? ""} />
      </section>
      <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Security
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Protect your account with a second step at sign-in.
        </p>
        <p className="mt-3 text-sm">
          <Link href="/settings/security" className="font-medium text-teal-700 hover:underline">
            Two-factor sign-in
          </Link>
        </p>
      </section>
      <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Appearance
        </h2>
        <ThemeSettings initialTheme={parseTheme(settings?.theme)} />
      </section>
      <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Email notifications
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Sent to <span className="font-medium text-slate-800">{settings?.email}</span>.
          You&apos;re never emailed about your own changes.
        </p>
        <NotificationSettings
          initialEnabled={settings?.emailNotifications ?? true}
          initialPrefs={{
            notifyMentions: settings?.notifyMentions ?? true,
            notifyAssignments: settings?.notifyAssignments ?? true,
            notifyStatusChanges: settings?.notifyStatusChanges ?? true,
          }}
        />
      </section>
      {isAgentPlatformEnabled() ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Agents
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Register the AI agents that work issues for you, and see your team&apos;s.
          </p>
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            <Link href="/settings/agents/connect" className="font-medium text-teal-700 hover:underline">
              Connect your agent
            </Link>
            <Link href="/settings/agents" className="font-medium text-teal-700 hover:underline">
              Manage agents
            </Link>
            <Link href="/settings/webhooks" className="font-medium text-teal-700 hover:underline">
              Webhooks
            </Link>
            <Link href="/settings/agents/pair" className="font-medium text-teal-700 hover:underline">
              Pair an agent
            </Link>
            <Link href="/settings/audit" className="font-medium text-teal-700 hover:underline">
              Agent audit log
            </Link>
            <Link href="/docs" className="font-medium text-teal-700 hover:underline">
              API Docs & /llms.txt
            </Link>
          </div>
        </section>
      ) : null}
      <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          API &amp; Integrations
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Developer documentation, cURL references, and machine-readable specifications for AI agents and automated tools.
        </p>
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          <Link href="/docs" className="font-medium text-teal-700 hover:underline">
            API Documentation
          </Link>
          <a
            href="/llms.txt"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-teal-700 hover:underline"
          >
            AI Specs (/llms.txt) ↗
          </a>
        </div>
      </section>
      <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Keyboard shortcuts
        </h2>
        <KeyboardShortcutSettings initialEnabled={settings?.keyboardShortcuts ?? true} />
      </section>
      <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Account data &amp; deletion
        </h2>
        <AccountDataSettings />
      </section>
    </div>
  );
}
