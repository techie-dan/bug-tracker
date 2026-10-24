// @vitest-environment jsdom
"use client";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { addCommentAction } from "@/app/actions/issues";
import { CommentForm } from "./comment-form";

const mockToast = vi.fn();
vi.mock("@/components/ui/toast", () => ({
  useToast: () => mockToast,
}));

vi.mock("@/app/actions/issues", () => ({
  addCommentAction: vi.fn(),
}));

const mockedAddComment = vi.mocked(addCommentAction);

// Set by tests that defer the mocked action's resolution; always released in
// afterEach so a failed assertion cannot leak a pending transition.
let releasePendingAction: (() => void) | null = null;

afterEach(() => {
  releasePendingAction?.();
  releasePendingAction = null;
  cleanup();
});

const defaultProps = {
  bugId: "b1",
  users: [] as { id: string; name: string }[],
};

function renderForm(props: Parameters<typeof CommentForm>[0] = defaultProps) {
  return render(<CommentForm {...props} />);
}

function bodyTextarea() {
  return screen.getByLabelText("Add to conversation") as HTMLTextAreaElement;
}

function submitButton() {
  return screen.getByRole("button", {
    name: /^(Post to conversation|Posting…|Uploading…)$/,
  }) as HTMLButtonElement;
}

describe("CommentForm optimistic update and rollback", () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    mockToast.mockReset();
    mockedAddComment.mockReset();
    mockedAddComment.mockResolvedValue({ ok: true });
    user = userEvent.setup();
  });

  it("posts a comment, clears the form, and calls onSuccess", async () => {
    const onSuccess = vi.fn();
    // Hold the action open until the test releases it so the pending state
    // ("Posting…"/disabled) is observable instead of racing the assertion.
    mockedAddComment.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releasePendingAction = () => resolve({ ok: true });
        }),
    );
    renderForm({ ...defaultProps, onSuccess });

    const textarea = bodyTextarea();
    await user.type(textarea, "Looks good to me");
    expect(textarea.value).toBe("Looks good to me");
    // "Looks good to me" is 16 characters.
    expect(screen.getByText("16/2000")).toBeTruthy();

    await user.click(submitButton());
    await waitFor(() => {
      expect(mockedAddComment).toHaveBeenCalledTimes(1);
      expect(submitButton().disabled).toBe(true);
      expect(submitButton().textContent).toBe("Posting…");
    });

    releasePendingAction?.();
    releasePendingAction = null;

    // Everything settles once the transition completes.
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
      expect(textarea.value).toBe("");
      expect(submitButton().textContent).toBe("Post to conversation");
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByRole("status").textContent).toBe("Comment posted.");
      expect(mockToast).toHaveBeenCalledWith("Comment posted.");
      // Body was cleared, so the button stays disabled for the empty form.
      expect(submitButton().disabled).toBe(true);
    });

    expect(mockedAddComment).toHaveBeenCalledWith("b1", expect.any(FormData));
    const formData = mockedAddComment.mock.calls[0]?.[1] as FormData;
    expect(formData.get("body")).toBe("Looks good to me");
  });

  it("keeps the body and shows the error when the action fails", async () => {
    mockedAddComment.mockResolvedValueOnce({ error: "Rate limited, try again" });

    renderForm();

    const textarea = bodyTextarea();
    await user.type(textarea, "Hey");

    await user.click(submitButton());

    // Rolled back once the transition settles: error shown, body kept,
    // button back to its idle state.
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe(
        "Rate limited, try again",
      );
      expect(textarea.value).toBe("Hey");
      expect(submitButton().disabled).toBe(false);
      expect(submitButton().textContent).toBe("Post to conversation");
    });
  });

  it("disables the submit button when the body is empty", () => {
    renderForm();
    expect(submitButton().disabled).toBe(true);
  });

  it("freezes the comment editor while posting and clears only the submitted snapshot (#733)", async () => {
    mockedAddComment.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releasePendingAction = () => resolve({ ok: true });
        }),
    );
    renderForm(defaultProps);

    const textarea = bodyTextarea();
    await user.type(textarea, "first comment");
    await user.click(submitButton());

    await waitFor(() => {
      expect(submitButton().textContent).toBe("Posting…");
    });
    // The editor is frozen for the duration of the submission (#733).
    expect(textarea.disabled).toBe(true);

    releasePendingAction?.();
    releasePendingAction = null;

    // Only the submitted snapshot is cleared; the editor is usable again.
    await waitFor(() => {
      expect(textarea.value).toBe("");
      expect(textarea.disabled).toBe(false);
      expect(submitButton().textContent).toBe("Post to conversation");
    });
    expect(mockedAddComment).toHaveBeenCalledTimes(1);
  });

  it("renders the reply variant and supports cancelling", async () => {
    const onCancel = vi.fn();
    renderForm({
      ...defaultProps,
      parentId: "c1",
      parentAuthorName: "Alice",
      onCancel,
    });

    expect(screen.getByLabelText("Reply to Alice")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Post reply" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("promises a notification in the placeholder, matching the delivery (#691)", () => {
    renderForm();
    expect(bodyTextarea().placeholder).toBe(
      "Add to the conversation… Type @ to mention someone (they get notified)",
    );
  });

  it("shows the notification note on the top-level form (#691)", () => {
    renderForm();
    expect(
      screen.getByText(
        /People you @mention get an email and an in-app notification/,
      ),
    ).toBeTruthy();
  });

  it("shows the same notification note on reply forms (#691)", () => {
    renderForm({
      ...defaultProps,
      parentId: "c1",
      parentAuthorName: "Alice",
    });
    expect(
      screen.getByText(
        /People you @mention get an email and an in-app notification/,
      ),
    ).toBeTruthy();
  });

  it("disables submit button and prevents submission while an attachment is uploading (#734)", async () => {
    let resolveUpload: (val: unknown) => void = () => {};
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpload = () =>
            resolve({
              ok: true,
              json: async () => ({ id: "att-99", size: 2048 }),
            });
        }),
    );

    try {
      const { container } = renderForm();
      const textarea = bodyTextarea();
      await user.type(textarea, "Comment with attachment");

      const fileInput = container.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      expect(fileInput).toBeTruthy();

      const file = new File(["sample"], "sample.png", { type: "image/png" });
      await user.upload(fileInput, file);

      // Upload in flight: button disabled and shows Uploading…
      await waitFor(() => {
        expect(submitButton().disabled).toBe(true);
        expect(submitButton().textContent).toBe("Uploading…");
      });

      // Attempting to submit while uploading does not invoke addCommentAction
      const form = container.querySelector("form") as HTMLFormElement;
      form.requestSubmit();
      expect(mockedAddComment).not.toHaveBeenCalled();

      // Resolve the upload
      resolveUpload(null);

      await waitFor(() => {
        expect(submitButton().disabled).toBe(false);
        expect(submitButton().textContent).toBe("Post to conversation");
      });

      // Submit once uploads have settled
      await user.click(submitButton());
      await waitFor(() => {
        expect(mockedAddComment).toHaveBeenCalledTimes(1);
      });

      const formData = mockedAddComment.mock.calls[0]?.[1] as FormData;
      expect(formData.get("attachmentIds")).toBe("att-99");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("provides settlement feedback: announces status, scrolls to comment, highlights, and focuses it (#703)", async () => {
    mockedAddComment.mockResolvedValueOnce({ ok: true, commentId: "comm-456" });

    const commentLi = document.createElement("li");
    commentLi.id = "comment-comm-456";
    const commentArticle = document.createElement("article");
    const commentLink = document.createElement("a");
    commentLink.href = "#comment-comm-456";
    commentArticle.appendChild(commentLink);
    commentLi.appendChild(commentArticle);
    document.body.appendChild(commentLi);

    const scrollIntoViewMock = vi.fn();
    commentLi.scrollIntoView = scrollIntoViewMock;

    try {
      renderForm();
      const textarea = bodyTextarea();
      await user.type(textarea, "New comment content");
      await user.click(submitButton());

      await waitFor(() => {
        expect(screen.getByRole("status").textContent).toBe("Comment posted.");
        expect(mockToast).toHaveBeenCalledWith("Comment posted.");
        expect(window.location.hash).toBe("#comment-comm-456");
      });

      await waitFor(() => {
        expect(scrollIntoViewMock).toHaveBeenCalled();
        expect(commentArticle.classList.contains("ring-2")).toBe(true);
      });
    } finally {
      document.body.removeChild(commentLi);
    }
  });
});
