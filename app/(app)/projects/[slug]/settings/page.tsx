import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth-helpers";
import { currentTenantIdFor } from "@/lib/tenant-context";
import { isTenantAdmin } from "@/lib/agents/membership";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { ProjectSettingsForm } from "./settings-form";
import { ProjectAreasManager } from "./areas-manager";
import { ProjectApprovalRulesSection } from "./approval-rules";
import { WorkflowSettingsForm } from "./workflow-settings-form";
import { workflowValues } from "@/lib/workflow-config";

export const metadata = { title: "Project settings" };

export default async function ProjectSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ github?: string }>;
}) {
  const user = await requireUser();
  const tenantId = await currentTenantIdFor(user.id);
  if (!tenantId) redirect("/tenants");
  if (!(await isTenantAdmin(user, tenantId))) notFound();
  const { slug } = await params;
  const project = await prisma.project.findFirst({
    where: { tenantId, slug },
    select: {
      id: true, slug: true, name: true, goal: true, repoUrl: true, stagingUrl: true,
      githubInstallationId: true, rewardConfig: true, workflow: true,
    },
  });
  if (!project) notFound();
  const workflow = workflowValues(project.workflow);
  const areas = await prisma.projectArea.findMany({
    where: { projectId: project.id },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, name: true, slug: true, description: true, paths: true },
  });
  const [issueTypes, approvalRules] = await Promise.all([
    prisma.issueType.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.approvalRule.findMany({
      // A rule made before types were tenant-scoped can point at another
      // organization's type. Don't show that type (or the stale rule) here.
      where: {
        projectId: project.id,
        OR: [{ issueTypeId: null }, { issueType: { tenantId } }],
      },
      include: { issueType: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const { github } = await searchParams;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-2">
        <Link href="/projects" className="text-sm text-teal-700 hover:underline">← Projects</Link>
        <h1 className="text-2xl font-semibold text-slate-900">{project.name} settings</h1>
        <p className="text-sm text-slate-600">Owners and admins can update project details and connect its GitHub App installation.</p>
      </div>
      {github === "error" ? <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">GitHub setup could not be completed. Start the connection again from this page.</p> : null}
      {github === "connected" ? <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">GitHub App installation connected.</p> : null}
      {github === "unavailable" ? <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">The GitHub App is not configured. Set GITHUB_APP_SLUG before connecting it.</p> : null}
      <section className="space-y-5 rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
        <ProjectSettingsForm project={project} />
        <div className="border-t border-slate-200 pt-5">
          <h2 className="text-base font-semibold text-slate-900">GitHub App</h2>
          <p className="mt-1 text-sm text-slate-600">Installation ID: {project.githubInstallationId ?? "Not connected"}. No access token is stored.</p>
          <form action={`/projects/${encodeURIComponent(project.slug)}/settings/github`} method="get" className="mt-3">
            <Button type="submit">{project.githubInstallationId ? "Change installation" : "Connect GitHub App"}</Button>
          </form>
        </div>
      </section>
      <section className="space-y-5 rounded-xl border border-slate-200 bg-white p-4 sm:p-6" aria-labelledby="workflow-heading">
        <div>
          <h2 id="workflow-heading" className="text-base font-semibold text-slate-900">Workflow</h2>
          <p className="mt-1 text-sm text-slate-600">
            The gates agents work under in this project. Changes are audited.
          </p>
        </div>
        <WorkflowSettingsForm slug={project.slug} workflow={workflow} />
      </section>
      <section className="space-y-5 rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
        <ProjectApprovalRulesSection
          projectId={project.id}
          slug={project.slug}
          rules={approvalRules}
          issueTypes={issueTypes}
        />
      </section>
      <ProjectAreasManager projectSlug={project.slug} areas={areas} />
      <Link href="/issues" className="inline-block text-sm text-teal-700 hover:underline">Back to issues</Link>
    </div>
  );
}
