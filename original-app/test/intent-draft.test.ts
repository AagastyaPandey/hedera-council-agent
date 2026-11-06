import { expect } from "chai";

// This suite asserts the recorded mock fixtures. Pin the adapter to recorded
// mode so an ambient NEXT_PUBLIC_DATA_MODE=live (e.g. from the repo .env used
// for Sepolia) cannot turn these fixture lookups into relative API fetches.
process.env.NEXT_PUBLIC_DATA_MODE = "mock";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  confirmIntent,
  getEvidenceDocument,
  getIntentDraft,
  verifyEvidenceSource,
} = require("../app/lib/data") as typeof import("../app/lib/data");

describe("Intent drafts · attack proposal", () => {
  it("uses a PARAM_SET-only draft grounded in fee-tuning text", async () => {
    const draft = await getIntentDraft("8");

    expect(draft.title).to.equal("Fee Tuning: attack (recorded)");
    expect(draft.document).to.include(
      "routine parameter tuning of the fee module"
    );
    expect(draft.document?.toLowerCase()).to.not.include("upgrade");
    expect(draft.actions).to.have.length(1);
    expect(draft.actions[0].kind).to.equal("PARAM_SET");
    expect(draft.actions[0].selector).to.equal("0x69fe0e2d");
    expect(draft.actions.some((action) => action.kind === "ERC20_TRANSFER")).to.equal(
      false
    );
    expect(draft.unresolved).to.have.length(0);

    const document = await getEvidenceDocument("8", draft.version);
    expect(document.content).to.include(
      "routine parameter tuning of the fee module"
    );
    const verification = await verifyEvidenceSource(
      "8",
      draft.actions[0].source.docHash,
      draft.actions[0].source.span
    );
    expect(verification.status).to.equal("MATCH");
    expect(verification.spanValid).to.equal(true);

    const confirmation = await confirmIntent("8", 0);
    expect(confirmation.rules).to.have.length(1);
    expect(confirmation.rules[0].kindLabel).to.equal("PARAM_SET");
    expect(confirmation.rules[0].selector).to.equal("0x69fe0e2d");
  });
});
