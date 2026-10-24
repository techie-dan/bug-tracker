"use client";

import { useEffect, useState, useTransition } from "react";
import {
  createCategoryAction,
  updateCategoryAction,
  toggleCategoryStatusAction,
  deleteCategoryAction,
} from "@/app/actions/categories";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { InUseNotice, type InUse } from "@/components/in-use-notice";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";

export type CategoryWithCount = {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  _count: {
    bugs: number;
  };
};

export function CategoryManager({
  initialCategories,
  deletedCounts = {},
}: {
  initialCategories: CategoryWithCount[];
  /** Soft-deleted issues per platform, which block deletion but are hidden. */
  deletedCounts?: Record<string, number>;
}) {
  const [inUse, setInUse] = useState<InUse | null>(null);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [error, setError] = useState<string | null>(null);
  // The input the current error is about, if any (#309): it is marked
  // invalid, described by the message, and focused.
  const [errorField, setErrorField] = useState<string | null>(null);
  const invalidAttrs = (id: string) =>
    errorField === id
      ? ({ "aria-invalid": true, "aria-describedby": "platform-error" } as const)
      : {};
  const [pending, startTransition] = useTransition();
  // The inputs are disabled while a request is pending, and focusing a
  // disabled control silently does nothing — so wait until it is enabled.
  useEffect(() => {
    if (errorField && !pending) document.getElementById(errorField)?.focus();
  }, [errorField, pending]);
  const confirm = useConfirm();
  const toast = useToast();

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setError(null);
    setErrorField(null);

    const formData = new FormData();
    formData.set("name", newName.trim());

    startTransition(async () => {
      const res = await createCategoryAction(formData);
      if (res.error) {
        setError(res.error);
        setErrorField("newPlatformName");
      } else {
        setNewName("");
      }
    });
  };

  const handleStartEdit = (category: CategoryWithCount) => {
    setEditingId(category.id);
    setEditingName(category.name);
    setError(null);
  };

  const handleSaveEdit = (categoryId: string) => {
    if (!editingName.trim()) return;
    setError(null);
    setErrorField(null);

    const formData = new FormData();
    formData.set("name", editingName.trim());

    startTransition(async () => {
      const res = await updateCategoryAction(categoryId, formData);
      if (res.error) {
        setError(res.error);
        setErrorField(`rename-platform-${categoryId}`);
      } else {
        setEditingId(null);
        setEditingName("");
      }
    });
  };

  const handleToggle = (categoryId: string) => {
    setError(null);
    startTransition(async () => {
      const res = await toggleCategoryStatusAction(categoryId);
      if (res.error) {
        setError(res.error);
      }
    });
  };

  const handleDelete = async (category: CategoryWithCount) => {
    if (category._count.bugs > 0) {
      setError(null);
      setInUse({
        kind: "platform",
        id: category.id,
        name: category.name,
        filterValue: category.id,
        total: category._count.bugs,
        deleted: deletedCounts[category.id] ?? 0,
        isActive: category.isActive,
      });
      return;
    }
    setInUse(null);

    const confirmed = await confirm({
      title: `Delete platform "${category.name}"?`,
      body: "This cannot be undone.",
      confirmLabel: "Delete platform",
      tone: "danger",
    });
    if (!confirmed) return;

    setError(null);
    startTransition(async () => {
      const res = await deleteCategoryAction(category.id);
      if (res.error) {
        setError(res.error);
        toast(res.error, "error");
      } else {
        toast(`Platform "${category.name}" deleted.`);
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">
          Add new platform
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Create platforms such as Desktop, Web, or Mobile.
        </p>

        <form onSubmit={handleCreate} className="mt-4 flex flex-wrap gap-3">
          <Input
            id="newPlatformName"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Platform name (e.g. Cloud)"
            className="max-w-xs"
            disabled={pending}
            minLength={2}
            maxLength={50}
            required
            // #213: this field had no accessible name - screen readers only
            // announced the placeholder, which many drop once a value is typed.
            aria-label="New platform name"
            {...invalidAttrs("newPlatformName")}
          />
          <Button type="submit" disabled={pending || !newName.trim()}>
            {pending ? "Adding…" : "Add platform"}
          </Button>
        </form>
      </div>

      {inUse ? (
        <InUseNotice
          inUse={inUse}
          pending={pending}
          onDismiss={() => setInUse(null)}
          onDeactivate={() =>
            startTransition(async () => {
              const res = await toggleCategoryStatusAction(inUse.id);
              if (res.error) {
                toast(res.error, "error");
              } else {
                // The row re-renders as inactive from the refreshed props.
                toast(`Platform “${inUse.name}” deactivated.`);
                setInUse(null);
              }
            })
          }
        />
      ) : null}

      {error ? (
        <div
          id="platform-error"
          className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-slate-50 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-900">
            Existing platforms
          </h2>
          <p className="text-xs text-slate-500">
            Active platforms appear on the issue creation form. Inactive
            platforms remain on existing issues but cannot be selected for new
            ones.
          </p>
        </div>

        {initialCategories.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-500">
            No platforms defined yet.
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {initialCategories.map((cat) => {
              const isEditing = editingId === cat.id;

              return (
                <div
                  key={cat.id}
                  className="flex flex-wrap items-center justify-between gap-4 p-4 sm:px-6"
                >
                  <div className="flex flex-1 items-center gap-3">
                    {isEditing ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          id={`rename-platform-${cat.id}`}
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          className="h-11 w-48 text-sm sm:h-8"
                          disabled={pending}
                          // Focus the field the user just opened for renaming;
                          // this is not a page-load autofocus.
                          // eslint-disable-next-line jsx-a11y/no-autofocus
                          autoFocus
                          minLength={2}
                          maxLength={50}
                          // #213: the rename field announced only "edit, text".
                          aria-label={`Rename platform ${cat.name}`}
                          {...invalidAttrs(`rename-platform-${cat.id}`)}
                        />
                        <Button
                          className="min-h-11 px-3 text-xs sm:min-h-0 sm:px-2.5 sm:py-1"
                          onClick={() => handleSaveEdit(cat.id)}
                          disabled={pending || !editingName.trim()}
                        >
                          Save
                        </Button>
                        <Button
                          className="min-h-11 px-3 text-xs sm:min-h-0 sm:px-2.5 sm:py-1"
                          variant="ghost"
                          onClick={() => setEditingId(null)}
                          disabled={pending}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <>
                        <span className="font-medium text-slate-900">
                          {cat.name}
                        </span>
                        <Badge
                          className={
                            cat.isActive
                              ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border border-slate-200 bg-slate-100 text-slate-600"
                          }
                        >
                          {cat.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </>
                    )}
                  </div>

                  {/*
                    #694: the action cluster never wrapped, so on a 360px phone
                    the row overflowed the card's `overflow-hidden` and Delete
                    was clipped and unreachable. Wrap it instead (the same fix
                    as milestone-manager), and give the buttons a 44px touch
                    target on phones while keeping the compact desktop size.
                  */}
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <span className="text-xs text-slate-600">
                      {cat._count.bugs} issue{cat._count.bugs === 1 ? "" : "s"}
                    </span>

                    {!isEditing ? (
                      <Button
                        className="min-h-11 px-3 text-xs sm:min-h-0 sm:px-2.5 sm:py-1"
                        variant="ghost"
                        onClick={() => handleStartEdit(cat)}
                        disabled={pending}
                      >
                        Edit
                      </Button>
                    ) : null}

                    <Button
                      className="min-h-11 px-3 text-xs sm:min-h-0 sm:px-2.5 sm:py-1"
                      variant="secondary"
                      onClick={() => handleToggle(cat.id)}
                      disabled={pending}
                    >
                      {cat.isActive ? "Deactivate" : "Activate"}
                    </Button>

                    {/*
                      Not disabled when the platform is in use (#314): a
                      disabled button cannot say why, and that is exactly the
                      question. Clicking it explains instead of deleting.
                    */}
                    <Button
                      className={`min-h-11 px-3 text-xs sm:min-h-0 sm:px-2.5 sm:py-1 ${
                        cat._count.bugs > 0
                          ? "text-slate-600 hover:bg-slate-100"
                          : "text-red-600 hover:bg-red-50 hover:text-red-700"
                      }`}
                      variant="ghost"
                      onClick={() => handleDelete(cat)}
                      disabled={pending}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
