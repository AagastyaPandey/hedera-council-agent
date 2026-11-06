import { describe, expect, it } from "vitest";
import { decodeAction, decodeBundle } from "../sentinel/decode";
import { ADDRESSES, FUNCTIONS } from "../packages/shared/addresses";
import { getDemo } from "../lib/demo";
import { buildConcreteCalls } from "../packages/shared/calls";

describe("calldata decoder", () => {
  it("decodes the approved bundle into human text", () => {
    const demo = getDemo();
    const decoded = decodeBundle(demo.approvedCalls);
    expect(decoded).toHaveLength(3);
    expect(decoded[0].function).toBe("transfer()");
    expect(decoded[0].humanText).toContain("200,000 USDC");
    expect(decoded[0].humanText).toContain("GrowthLabs Multisig");
    expect(decoded[2].function).toBe("approve()");
    expect(decoded[2].humanText).toContain("TreasuryOps");
    expect(decoded[2].humanText).toContain("5,000 USDC");
  });

  it("unwraps multicall children recursively", () => {
    const demo = getDemo();
    const submitted = demo.runs["04-nested-ownership"].submitted;
    expect(submitted).toHaveLength(1);
    expect(submitted[0].function).toBe("multicall()");
    expect(submitted[0].nested).toHaveLength(2);
    expect(submitted[0].nested[0].function).toBe("transfer()");
    expect(submitted[0].nested[1].function).toBe("transferOwnership()");
    expect(submitted[0].nested[1].humanText).toContain("ownership of TreasuryProxy");
  });

  it("shows unknown selectors instead of hiding them", () => {
    const decoded = decodeAction({ target: ADDRESSES.usdc, value: 0n, data: "0xdeadbeef" });
    expect(decoded.unknown).toBe(true);
    expect(decoded.humanText).toBe("UNKNOWN FUNCTION 0xdeadbeef");
    expect(decoded.flag).toBeTruthy();
  });

  it("decodes upgradeToAndCall payloads", () => {
    const demo = getDemo();
    const submitted = demo.runs["06-delegatecall-payload"].submitted;
    expect(submitted[0].function).toBe("upgradeToAndCall()");
    expect(submitted[0].humanText).toContain("Upgrades TreasuryProxy");
    expect(submitted[0].humanText).toContain("executes payload");
  });

  it("encodes selectors that match the registry", () => {
    const [transfer] = buildConcreteCalls([
      {
        kind: "ERC20_TRANSFER",
        target: ADDRESSES.usdc,
        counterparty: ADDRESSES.growthLabs,
        amount: "1",
      },
    ]);
    expect(transfer.data.slice(0, 10)).toBe(FUNCTIONS.transfer.selector);
    const [approve] = buildConcreteCalls([
      {
        kind: "ERC20_APPROVE",
        target: ADDRESSES.usdc,
        counterparty: ADDRESSES.treasuryOps,
        amount: "1",
      },
    ]);
    expect(approve.data.slice(0, 10)).toBe(FUNCTIONS.approve.selector);
    const [upgrade] = buildConcreteCalls([
      {
        kind: "UPGRADE",
        target: ADDRESSES.treasuryProxy,
        counterparty: ADDRESSES.maliciousImpl,
      },
    ]);
    expect(upgrade.data.slice(0, 10)).toBe(FUNCTIONS.upgradeTo.selector);
  });
});
