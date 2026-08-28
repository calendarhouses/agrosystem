/**
 * Реекспорт реєстру + конфігу для зручного імпорту.
 */
export {
  basDefaultWarehouseKey,
  basDieselNomenclatureKey,
  basOrganizationKey,
  isBasDraftPostEnabled,
} from "@/lib/bas-drafts/config";
export {
  BAS_DRAFT_PIPELINES,
  listBasDraftPipelinesByReadiness,
  type BasDraftPipeline,
  type BasDraftPipelineReadiness,
} from "@/lib/bas-drafts/registry";
export { postBasDocumentDraft } from "@/lib/bas-drafts/post";
