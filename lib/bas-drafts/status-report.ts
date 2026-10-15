/**
 * Звіт: які контури чернеток готові / увімкнені live.
 */

import {
  isBasDraftPipelineEnabled,
  isBasDraftPostEnabled,
} from "@/lib/bas-drafts/config";
import { BAS_DRAFT_PIPELINES } from "@/lib/bas-drafts/registry";

export function getBasDraftPipelinesStatus() {
  const globalOn = isBasDraftPostEnabled();
  const rows = BAS_DRAFT_PIPELINES.filter(
    (p) => p.readiness !== "out_of_scope" && p.basDocument
  ).map((p) => {
    const pipelineFlagOn = isBasDraftPipelineEnabled(p.id);
    return {
      id: p.id,
      section: p.section,
      basDocument: p.basDocument,
      readiness: p.readiness,
      live: globalOn && pipelineFlagOn,
      notes: p.notes,
    };
  });

  return {
    ok: true as const,
    globalPostEnabled: globalOn,
    liveCount: rows.filter((r) => r.live).length,
    totalDocumentPipelines: rows.length,
    recommendedEnv: {
      BAS_DRAFT_POST_ENABLED: "true",
      BAS_DRAFT_PIPELINES_ENABLED:
        "inventory_inbound_receipt,inventory_sale,inventory_outbound_lzk,fuel_inbound,fuel_transfer,fuel_outbound_refuel,field_operation_waybill",
      // або коротко: "*"
    },
    rows,
    hint: globalOn
      ? "Глобальний POST увімкнено. Live лише рядки з live=true."
      : "BAS_DRAFT_POST_ENABLED вимкнено — усі контури в dry-run / pending.",
  };
}
