import { test, expect, reportIssue } from "./fixtures";

test("comments on an issue and replies to the comment", async ({ page, uniq }) => {
  await reportIssue(page, uniq("Comment thread check"));

  // The comments themselves, not the activity log that quotes them.
  const thread = page.locator("[id^='comment-']");
  const comment = `Same here on Firefox ${Date.now()}`;
  await page.locator("textarea#body").fill(comment);
  await page.getByRole("button", { name: /Post to conversation|Post comment/ }).click();
  await expect(thread.getByText(comment).first()).toBeVisible();

  const reply = `Fixed by clearing the cache ${Date.now()}`;
  await page.getByRole("button", { name: "Reply" }).first().click();
  const replyBox = page.locator("textarea[id^='body-']").first();
  await replyBox.fill(reply);
  await page.getByRole("button", { name: /Post reply|Reply/ }).last().click();
  await expect(thread.getByText(reply).first()).toBeVisible();
  await expect(page.getByText(/Replying to/).first()).toBeVisible();

  // Both survive a reload: they were saved, not just drawn.
  await page.reload();
  await expect(thread.getByText(comment).first()).toBeVisible();
  await expect(thread.getByText(reply).first()).toBeVisible();
});
