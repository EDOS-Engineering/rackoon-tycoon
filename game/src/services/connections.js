// connections.js — Typed wire connections (Phase 5: T5.1 / T5.2).
//
// A wire is no longer just "a link"; it represents a real AWS networking
// construct. Each type carries distinct cost, visuals, and topology rules, so
// the player learns when to reach for which:
//
//   vpc         — default same-VPC link. Cheap. Intra-AZ free; cross-AZ adds the
//                 standard inter-AZ transfer surcharge.
//   peering     — 1:1 VPC Peering. Non-transitive (A↔B + B↔C does NOT yield
//                 A↔C). No hourly fee; you still pay cross-AZ/region transfer.
//   tgw         — Transit Gateway. Hub-and-spoke with transitive routing across
//                 many VPCs; adds per-GB data-processing on top of transfer.
//   privatelink — Interface endpoint to a single service. Traffic stays on the
//                 AWS private network (no public / cross-AZ exposure), so it is
//                 exempt from the cross-AZ surcharge; per-hour + per-GB instead.
//
// (Gateway VPC Endpoint and Direct Connect are intentionally NOT here: the
// Gateway endpoint already exists as a placeable building, and Direct Connect
// needs an on-prem/partner node the catalog doesn't model yet — deferred.)
//
// `transferMul` multiplies the per-hop data-transfer charge (see billing). The
// per-pair legality `connTypeAllows` layers on top of the service-level canWire.

import { SINK_ROLES } from "./catalog.js";

export const CONN = {
  vpc: {
    id: "vpc",
    label: "VPC Link",
    short: "VPC",
    color: "#4cc9f0",
    transferMul: 1,
    crossAzExempt: false,
    blurb:
      "Default same-VPC link. Cheapest path. Intra-AZ traffic is free; crossing an AZ band adds the standard inter-AZ transfer cost.",
    examTip:
      "Traffic within a single AZ in one VPC is free. Cross-AZ traffic between your resources is ~$0.01/GB each way — keep chatty tiers in one AZ when you can.",
  },
  peering: {
    id: "peering",
    label: "VPC Peering",
    short: "Peer",
    color: "#52b788",
    transferMul: 1,
    crossAzExempt: false,
    blurb:
      "1:1 VPC Peering. Non-transitive — peering A↔B and B↔C does NOT give A↔C. No hourly fee; you pay only cross-AZ/region data transfer.",
    examTip:
      "VPC Peering is non-transitive and has no bandwidth bottleneck. For a many-VPC hub-and-spoke mesh, reach for Transit Gateway instead of N² peerings.",
  },
  tgw: {
    id: "tgw",
    label: "Transit Gateway",
    short: "TGW",
    color: "#b5179e",
    transferMul: 1.6,
    crossAzExempt: false,
    blurb:
      "Transit Gateway — hub-and-spoke router with transitive routing across many VPCs. Scales to thousands of attachments; adds per-GB data processing on top of transfer.",
    examTip:
      "Transit Gateway = transitive routing + central hub, $0.02/GB processed plus an hourly attachment fee. Peering = 1:1, no processing fee, but non-transitive. Many VPCs → TGW.",
  },
  privatelink: {
    id: "privatelink",
    label: "PrivateLink",
    short: "PLink",
    color: "#4361ee",
    transferMul: 1.3,
    crossAzExempt: true,
    requiresSinkEnd: true,
    blurb:
      "PrivateLink — a private interface endpoint to a single service via an ENI. Traffic never leaves the AWS private network (no public or cross-AZ exposure). Per-hour + per-GB. One end must be the service you expose.",
    examTip:
      "PrivateLink (interface endpoint) privately exposes one service — yours, a partner's, or on-prem. Gateway endpoints (free) cover only S3 + DynamoDB; PrivateLink covers everything else.",
  },
};

export const CONN_ORDER = ["vpc", "peering", "tgw", "privatelink"];
export const DEFAULT_CONN = "vpc";

export function getConn(id) {
  return CONN[id] || CONN[DEFAULT_CONN];
}

// Per-type legality for a wire between two services, layered ON TOP of the
// service-level canWire() role/VPCE rules. Order-independent.
//   - PrivateLink: exactly one end must be a sink/storage (you PrivateLink TO a
//     service endpoint, not between two pass-through network tiles).
export function connTypeAllows(typeId, svcA, svcB) {
  const t = CONN[typeId];
  if (!t) return false;
  if (t.requiresSinkEnd) {
    const isSink = (s) => SINK_ROLES.has(s.role);
    if (isSink(svcA) === isSink(svcB)) return false; // need exactly one sink end
  }
  return true;
}
