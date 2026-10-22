import { describe, expect, it } from "vitest";
import {
  agentMentionId,
  extractMentionedAgentIds,
  extractMentionedUserIds,
  filterUsersForMention,
  formatMention,
  getMentionQuery,
  insertMention,
  newlyMentionedAgentIds,
  newlyMentionedUserIds,
  normalizeMentions,
  parseAgentMentionId,
  tokenizeMentions,
} from "./mentions";

const aliceId = "clxxxxxxxxxxxxxxxxxxxxxxxx1";
const bobId = "clxxxxxxxxxxxxxxxxxxxxxxxx2";

describe("formatMention", () => {
  it("formats a soft-mention tag", () => {
    expect(formatMention("Alice Smith", aliceId)).toBe(
      `@[Alice Smith](${aliceId})`,
    );
  });

  it("strips brackets from display names", () => {
    expect(formatMention("Al[ice]", aliceId)).toBe(`@[Alice](${aliceId})`);
  });
});

describe("tokenizeMentions", () => {
  it("returns a single text token for plain comments", () => {
    expect(tokenizeMentions("Looks good on staging.")).toEqual([
      { type: "text", value: "Looks good on staging." },
    ]);
  });

  it("splits text and mention tags", () => {
    const body = `Hey @[Alice](${aliceId}), please check.`;
    expect(tokenizeMentions(body)).toEqual([
      { type: "text", value: "Hey " },
      { type: "mention", name: "Alice", userId: aliceId },
      { type: "text", value: ", please check." },
    ]);
  });

  it("keeps malformed tags as plain text", () => {
    const body = "Broken @[Alice(missing) and @[Bob]() end";
    const tokens = tokenizeMentions(body);
    expect(tokens.every((t) => t.type === "text")).toBe(true);
    expect(tokens.map((t) => (t.type === "text" ? t.value : "")).join("")).toBe(
      body,
    );
  });

  it("does not throw on empty or odd input", () => {
    expect(tokenizeMentions("")).toEqual([{ type: "text", value: "" }]);
    expect(tokenizeMentions("@[[[]]](())")).toEqual([
      { type: "text", value: "@[[[]]](())" },
    ]);
  });
});

describe("extractMentionedUserIds", () => {
  it("returns unique user ids from well-formed tags", () => {
    const body = `@[Alice](${aliceId}) and @[Bob](${bobId}) then @[Alice](${aliceId}) again`;
    expect(extractMentionedUserIds(body)).toEqual([aliceId, bobId]);
  });

  it("ignores malformed tags", () => {
    expect(extractMentionedUserIds("hi @alice @[Bob]")).toEqual([]);
  });
});

describe("getMentionQuery", () => {
  it("detects an open @ query at the caret", () => {
    const value = "Hello @al";
    expect(getMentionQuery(value, value.length)).toEqual({
      start: 6,
      query: "al",
    });
  });

  it("returns null inside a completed mention tag", () => {
    const value = `Thanks @[Alice](${aliceId})`;
    expect(getMentionQuery(value, value.length)).toBeNull();
  });

  it("returns null when @ is mid-word", () => {
    expect(getMentionQuery("email@alice", 11)).toBeNull();
  });

  it("returns null inside inline code", () => {
    const value = "run `@al";
    expect(getMentionQuery(value, value.length)).toBeNull();
  });

  it("returns null inside a fenced code block", () => {
    const value = "```\nuser @al";
    expect(getMentionQuery(value, value.length)).toBeNull();
  });

  it("still detects mentions after a closed code span", () => {
    const value = "`code` then @al";
    expect(getMentionQuery(value, value.length)).toEqual({
      start: 12,
      query: "al",
    });
  });
});

describe("filterUsersForMention", () => {
  const users = [
    { id: aliceId, name: "Alice Smith" },
    { id: bobId, name: "Bob Jones" },
  ];

  it("filters case-insensitively by name", () => {
    expect(filterUsersForMention(users, "ali")).toEqual([users[0]]);
  });

  it("returns a limited list when query is empty", () => {
    expect(filterUsersForMention(users, "", 1)).toEqual([users[0]]);
  });
});

describe("insertMention", () => {
  it("replaces the open query with a formatted tag and trailing space", () => {
    const value = "Hi @al";
    const mention = getMentionQuery(value, value.length);
    expect(mention).not.toBeNull();
    if (!mention) return;

    const result = insertMention(value, mention, value.length, "Alice", aliceId);
    expect(result.value).toBe(`Hi @[Alice](${aliceId}) `);
    expect(result.caret).toBe(result.value.length);
  });
});

describe("normalizeMentions", () => {
  const usersMap = new Map([
    [aliceId, "Alice Smith"],
    [bobId, "Bob Jones"],
  ]);

  it("canonicalizes a valid mention with the user's real name", () => {
    const input = `Hi @[Alice](${aliceId})!`;
    expect(normalizeMentions(input, usersMap)).toBe(
      `Hi @[Alice Smith](${aliceId})!`,
    );
  });

  it("rewrites an unknown user ID to plain text @Name", () => {
    const input = "Hi @[Mark Essien](fake123)";
    expect(normalizeMentions(input, usersMap)).toBe("Hi @Mark Essien");
  });

  it("corrects a mismatched name to the user's real name from the database", () => {
    const input = `Assigned to @[Super Admin](${aliceId}) by mistake`;
    expect(normalizeMentions(input, usersMap)).toBe(
      `Assigned to @[Alice Smith](${aliceId}) by mistake`,
    );
  });

  it("handles mixed valid, unknown, and plain text mentions", () => {
    const input = `@[Imposter](${aliceId}) met @[Unknown](no-id) and @[Bob](${bobId})`;
    expect(normalizeMentions(input, usersMap)).toBe(
      `@[Alice Smith](${aliceId}) met @Unknown and @[Bob Jones](${bobId})`,
    );
  });
});

describe("newlyMentionedUserIds (#228)", () => {
  it("returns people tagged only in the new text", () => {
    const before = "Looks broken on staging.";
    const after = `Looks broken on staging. cc @[Alice](${aliceId})`;
    expect(newlyMentionedUserIds(before, after)).toEqual([aliceId]);
  });

  it("does not re-notify people who were already tagged", () => {
    const before = `cc @[Alice](${aliceId})`;
    const after = `cc @[Alice](${aliceId}) and @[Bob](${bobId})`;
    expect(newlyMentionedUserIds(before, after)).toEqual([bobId]);
  });

  it("returns nothing when an edit only removes or keeps mentions", () => {
    const before = `cc @[Alice](${aliceId}) and @[Bob](${bobId})`;
    expect(newlyMentionedUserIds(before, `cc @[Alice](${aliceId})`)).toEqual([]);
    expect(newlyMentionedUserIds(before, before)).toEqual([]);
  });
});

describe("code-aware mention processing (#731)", () => {
  const nameMap = new Map([
    [aliceId, "Alice Smith"],
    [bobId, "Bob Jones"],
  ]);

  it("does not extract or rewrite mention tags inside fenced code", () => {
    const body = `before @[Alice](${aliceId})\n\`\`\`\nliteral @[Example](${bobId}) stays\n\`\`\`\nafter`;
    expect(extractMentionedUserIds(body)).toEqual([aliceId]);
    expect(normalizeMentions(body, nameMap)).toBe(body.replace(`@[Alice](${aliceId})`, `@[Alice Smith](${aliceId})`));
  });

  it("does not extract or rewrite mention tags inside inline code", () => {
    const body = `see \`@[Example](${bobId})\` and @[Alice](${aliceId})`;
    expect(extractMentionedUserIds(body)).toEqual([aliceId]);
    expect(normalizeMentions(body, nameMap)).toBe(
      `see \`@[Example](${bobId})\` and @[Alice Smith](${aliceId})`,
    );
  });

  it("treats an unterminated fence as code to the end", () => {
    const body = "```js\n" + "tag @[Example](" + bobId + ")";
    expect(extractMentionedUserIds(body)).toEqual([]);
    expect(normalizeMentions(body, nameMap)).toBe(body);
  });

  it("keeps code samples byte-identical when they contain tag-like text", () => {
    const body = `\`\`\`text\n@[Example](${bobId})\n\`\`\``;
    expect(normalizeMentions(body, nameMap)).toBe(body);
  });

  it("still processes prose mentions with no code present", () => {
    const body = `@[Imposter](${aliceId}) met @Unknown`;
    expect(extractMentionedUserIds(body)).toEqual([aliceId]);
    expect(normalizeMentions(body, nameMap)).toBe(
      `@[Alice Smith](${aliceId}) met @Unknown`,
    );
  });
});

describe("agent mentions (#603)", () => {
  const agentId = "clxxxxxxxxxxxxxxxxxxxxxxxa1";
  const tag = `@[Mark's Claude](agent:${agentId})`;

  it("formats and parses the agent: id prefix", () => {
    expect(agentMentionId(agentId)).toBe(`agent:${agentId}`);
    expect(formatMention("Mark's Claude", agentMentionId(agentId))).toBe(tag);
    expect(parseAgentMentionId(`agent:${agentId}`)).toBe(agentId);
    expect(parseAgentMentionId(aliceId)).toBeNull();
    expect(parseAgentMentionId("agent:")).toBeNull();
  });

  it("keeps agent ids out of user ids and extracts them separately", () => {
    const body = `@[Alice](${aliceId}) and ${tag}, again ${tag}`;
    expect(extractMentionedUserIds(body)).toEqual([aliceId]);
    expect(extractMentionedAgentIds(body)).toEqual([agentId]);
  });

  it("ignores agent tags inside code", () => {
    expect(extractMentionedAgentIds(`\`${tag}\``)).toEqual([]);
  });

  it("finds only newly mentioned agents on edit", () => {
    expect(newlyMentionedAgentIds("hi", `hi ${tag}`)).toEqual([agentId]);
    expect(newlyMentionedAgentIds(`hi ${tag}`, `hello ${tag}`)).toEqual([]);
  });

  it("keeps a known agent tag with its real name and degrades unknown ones", () => {
    const known = new Map([[agentMentionId(agentId), "Mark's Claude"]]);
    expect(normalizeMentions(`@[Old name](agent:${agentId}) hi`, known)).toBe(`${tag} hi`);
    expect(normalizeMentions(`@[Stranger](agent:other) hi`, known)).toBe("@Stranger hi");
  });

  it("inserts an agent option as an agent tag", () => {
    const mention = getMentionQuery("ping @Ma", 8)!;
    expect(insertMention("ping @Ma", mention, 8, "Mark's Claude", agentMentionId(agentId)).value).toBe(`ping ${tag} `);
  });
});
