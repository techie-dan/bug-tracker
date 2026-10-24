"use client";

import { useRef, useState, useTransition } from "react";
import { unstable_rethrow } from "next/navigation";
import { createBugAction, type ActionResult } from "@/app/actions/issues";
import { submitFailureMessage } from "@/lib/submit-error";
import { ErrorSummary, FieldError, useFieldErrors } from "@/components/ui/field-errors";
import { severities } from "@/lib/validations/issue";
import { severityLabels } from "@/lib/labels";
import type { AppRole } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CharacterCounter } from "@/components/ui/character-counter";
import { AttachmentPicker } from "@/components/attachment-picker";
import { SimilarIssues } from "@/components/similar-issues";
import { MarkdownEditor } from "@/components/markdown-editor";
import { useFormDraft } from "@/components/use-form-draft";
import { buildDraftKey } from "@/lib/form-drafts";
import { DraftBanner } from "@/components/draft-banner";
import { AssigneeCombobox } from "@/components/assignee-combobox";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { initialDescription, templateSwitch } from "@/lib/issue-templates";

/** Must match the title limit enforced by createBugSchema. */
const TITLE_MAX_LENGTH = 200;

type UserOption = { id: string; name: string; role: AppRole; image?: string | null };
type CategoryOption = { id: string; name: string };
type TypeOption = {
  id: string;
  name: string;
  description?: string | null;
  /** Pre-fills the description (#307). */
  template?: string | null;
};

/** Field names as the person sees them, for the error summary. */
const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  typeId: "Type",
  categoryId: "Platform",
  description: "Description",
  proofLinks: "GitHub PR",
  severity: "Severity",
  assigneeId: "Assignee",
};

export function CreateIssueForm({
  users,
  assigneeUsers = users,
  categories = [],
  types = [],
  isAdmin,
  currentUserId,
  projectId,
}: {
  users: UserOption[];
  assigneeUsers?: UserOption[];
  categories?: CategoryOption[];
  types?: TypeOption[];
  isAdmin: boolean;
  currentUserId?: string;
  projectId?: string | null;
}) {
  const defaultTypeId =
    types.find((t) => t.name.toLowerCase() === "fix")?.id ?? types[0]?.id ?? "";
  const templateOf = (id: string) => types.find((t) => t.id === id)?.template ?? null;
  const confirm = useConfirm();

  // #307: changing type offers that type's template. An untouched template
  // or a blank field is swapped silently; anything typed is only replaced
  // after asking.
  async function changeType(nextTypeId: string) {
    const current = values.description;
    const decision = templateSwitch(current, templateOf(values.typeId), templateOf(nextTypeId));
    setValue("typeId", nextTypeId);
    if (decision.kind === "replace") {
      setValue("description", decision.text);
    } else if (decision.kind === "confirm") {
      const typeName = types.find((t) => t.id === nextTypeId)?.name ?? "this type";
      const ok = await confirm({
        title: `Use the ${typeName} template?`,
        body: "It replaces what you've written in the description. Keep your text to change only the type.",
        confirmLabel: "Replace with template",
        cancelLabel: "Keep my text",
      });
      if (ok) setValue("description", decision.text);
    }
  }

  const draftKey = buildDraftKey({
    userId: currentUserId,
    formType: "create-bug",
    projectId,
  });

  const { values, setValue, isRestored, clearDraft, discardDraft } = useFormDraft(
    draftKey,
    {
      title: "",
      typeId: defaultTypeId,
      description: initialDescription(templateOf(defaultTypeId)),
      categoryId: "",
      proofLinks: "",
      severity: "medium" as (typeof severities)[number],
      assigneeId: "",
      assignToMe: false,
    },
  );
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const [mode, setMode] = useState<"report" | "detailed">("detailed");
  const [editorUploading, setEditorUploading] = useState(false);
  const [pickerUploading, setPickerUploading] = useState(false);
  const isUploading = editorUploading || pickerUploading;
  const [error, setError] = useState<string | null>(null);
  // True when the request itself failed (network / server error), so the
  // person can simply retry; validation errors from the server aren't retryable.
  const [canRetry, setCanRetry] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const errs = useFieldErrors("report", formRef);
  const mentionUsers = users.map((user) => ({ id: user.id, name: user.name }));

  return (
    <form
      ref={formRef}
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (pending || isUploading) return;
        setError(null);
        setCanRetry(false);
        errs.clear();
        const formData = new FormData();
        formData.set("title", values.title);
        formData.set("description", values.description);
        formData.set("attachmentIds", attachmentIds.join(","));
        formData.set("isReport", mode === "report" ? "true" : "false");
        if (mode === "detailed") {
          formData.set("typeId", values.typeId);
          formData.set("categoryId", values.categoryId);
          formData.set("proofLinks", values.proofLinks);
        }
        if (isAdmin) {
          formData.set("severity", values.severity);
          formData.set("assigneeId", values.assigneeId);
        } else if (values.assignToMe && currentUserId) {
          formData.set("assigneeId", currentUserId);
        }
        startTransition(async () => {
          try {
            const result: ActionResult = await createBugAction(formData);
            if (result.error) {
              // A field-specific error goes beside its control and takes
              // focus there; only an error about no field in particular
              // stays as the form-level alert at the bottom.
              if (result.field || result.fieldErrors) errs.show(result);
              else setError(result.error);
            } else {
              clearDraft();
            }
          } catch (error) {
            unstable_rethrow(error);
            setError(submitFailureMessage(navigator.onLine));
            setCanRetry(true);
          }
        });
      }}
    >
      {isRestored ? (
        <DraftBanner
          onDiscard={discardDraft}
          message="Restored unsaved draft from this browser"
        />
      ) : null}

      <div className="flex border-b border-slate-200">
        <button
          type="button"
          onClick={() => setMode("report")}
          className={`border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
            mode === "report"
              ? "border-teal-600 text-teal-700"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          Quick report
        </button>
        <button
          type="button"
          onClick={() => setMode("detailed")}
          className={`border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
            mode === "detailed"
              ? "border-teal-600 text-teal-700"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          Detailed issue
        </button>
      </div>

      {mode === "report" ? (
        <div className="rounded-lg border border-teal-200 bg-teal-50/60 p-3 text-xs text-teal-900">
          <p className="font-semibold">✨ Lightweight human report intake</p>
          <p className="mt-0.5 text-teal-700">
            Describe what happened in plain language and upload media. Autonomous agents will analyze, deduplicate, infer platform/type, and structure your report.
          </p>
        </div>
      ) : null}

      <ErrorSummary errors={errs.fieldErrors} labels={FIELD_LABELS} />

      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="title" className="text-sm font-medium text-slate-700">
              Title
            </label>
            <Input
              id="title"
              name="title"
              required={mode === "detailed"}
              minLength={mode === "detailed" ? 3 : undefined}
              maxLength={TITLE_MAX_LENGTH}
              placeholder={
                mode === "report"
                  ? "Short summary (optional — auto-generated from description if empty)"
                  : "Short summary of the issue"
              }
              value={values.title}
              onChange={(event) => setValue("title", event.target.value)}
              {...errs.attrs("title")}
            />
            <CharacterCounter
              length={values.title.length}
              max={TITLE_MAX_LENGTH}
              className="text-right"
            />
            <FieldError formId={errs.formId} field="title" errors={errs.fieldErrors} />
            <SimilarIssues title={values.title} />
          </div>

          {mode === "detailed" && types.length > 0 ? (
            <div className="space-y-1.5">
              <label htmlFor="typeId" className="text-sm font-medium text-slate-700">
                Type
              </label>
              <Select
                id="typeId"
                name="typeId"
                value={values.typeId}
                onChange={(event) => void changeType(event.target.value)}
                {...errs.attrs("typeId")}
              >
                {types.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </Select>
              <FieldError formId={errs.formId} field="typeId" errors={errs.fieldErrors} />
            </div>
          ) : null}
        </div>

        {mode === "detailed" ? (
          <div className="space-y-1.5">
            <label
              htmlFor="categoryId"
              className="text-sm font-medium text-slate-700"
            >
              Platform
            </label>
            <Select
              id="categoryId"
              name="categoryId"
              value={values.categoryId}
              onChange={(event) => setValue("categoryId", event.target.value)}
              {...errs.attrs("categoryId")}
            >
              <option value="">Select a platform</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </Select>
            <FieldError formId={errs.formId} field="categoryId" errors={errs.fieldErrors} />
          </div>
        ) : null}
        <div className="space-y-1.5">
          <label
            id="description-label"
            htmlFor="description"
            className="text-sm font-medium text-slate-700"
          >
            Description
          </label>
          <MarkdownEditor
            id="description"
            labelId="description-label"
            name="description"
            required
            minLength={10}
            maxLength={5000}
            rows={6}
            placeholder={
              mode === "report"
                ? "Describe what happened in your own words. What were you doing, and what went wrong?"
                : "Steps to reproduce, expected vs actual, environment…"
            }
            value={values.description}
            onChange={(val) => setValue("description", val)}
            onUploadingChange={setEditorUploading}
            users={mentionUsers}
            {...errs.attrs("description")}
            footer={
              <p className="text-xs text-slate-500">
                {mode === "report"
                  ? "Markdown is supported. Plain language is welcome; our agents will structure the report."
                  : "Markdown is supported. Be specific: what should happen, what actually happens, and how to reproduce it."}
              </p>
            }
          />
          <FieldError formId={errs.formId} field="description" errors={errs.fieldErrors} />
        </div>

        {mode === "detailed" ? (
          <div className="space-y-1.5">
            <label
              htmlFor="proofLinks"
              className="text-sm font-medium text-slate-700"
            >
              GitHub PR
            </label>
            <Textarea
              id="proofLinks"
              name="proofLinks"
              rows={3}
              placeholder={
                "https://github.com/organization/repo/pull/123"
              }
              value={values.proofLinks}
              onChange={(event) => setValue("proofLinks", event.target.value)}
              {...errs.attrs("proofLinks")}
            />
            <FieldError formId={errs.formId} field="proofLinks" errors={errs.fieldErrors} />
            <p className="text-xs text-slate-500">
              Optional. One GitHub link per line (e.g. https://github.com/organization/repo/pull/123).
            </p>
          </div>
        ) : null}

        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium text-slate-700">
            Screenshots and files
          </legend>
          <p className="text-xs text-slate-500">
            Optional. No GitHub account needed: attach a screenshot, console log
            or recording export straight to the report.
          </p>
          <AttachmentPicker
            name="attachmentIdsPicker"
            onChange={setAttachmentIds}
            onUploadingChange={setPickerUploading}
            disabled={pending}
          />
        </fieldset>
      </div>
      {isAdmin ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label
              htmlFor="severity"
              className="text-sm font-medium text-slate-700"
            >
              Severity
            </label>
            <Select
              id="severity"
              name="severity"
              value={values.severity}
              onChange={(event) =>
                setValue("severity", event.target.value as (typeof severities)[number])
              }
              {...errs.attrs("severity")}
            >
              {severities.map((value) => (
                <option key={value} value={value}>
                  {severityLabels[value]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="assigneeId"
              className="text-sm font-medium text-slate-700"
            >
              Assignee
            </label>
            <AssigneeCombobox
              id="assigneeId"
              name="assigneeId"
              people={assigneeUsers}
              value={values.assigneeId}
              onChange={(val) => setValue("assigneeId", val)}
            />
            <FieldError formId={errs.formId} field="assigneeId" errors={errs.fieldErrors} />
          </div>
        </div>
      ) : currentUserId ? (
        <div className="flex items-center gap-2 pt-1">
          <input
            type="checkbox"
            id="assignToMe"
            checked={values.assignToMe}
            onChange={(e) => setValue("assignToMe", e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
          />
          <label
            htmlFor="assignToMe"
            className="text-sm font-medium text-slate-700 cursor-pointer"
          >
            Assign this issue to myself
          </label>
        </div>
      ) : null}
      {error ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1" role="alert">
          <p className="text-sm text-red-600">{error}</p>
          {canRetry ? (
            <button
              type="button"
              disabled={pending || isUploading}
              onClick={() => formRef.current?.requestSubmit()}
              className="text-sm font-medium text-teal-700 underline-offset-2 hover:underline disabled:opacity-50"
            >
              Try again
            </button>
          ) : null}
        </div>
      ) : null}
      <Button type="submit" disabled={pending || isUploading}>
        {pending ? "Creating…" : isUploading ? "Uploading…" : "Create issue"}
      </Button>
    </form>
  );
}

export { CreateIssueForm as CreateBugForm };
