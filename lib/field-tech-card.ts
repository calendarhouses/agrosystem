/**
 * Технологічна матриця («метро») етапів поля за культурою.
 * Зіставлення work_type з field_operations → етап техкарти.
 */

export type TechCardStageStatus =
  | "done"
  | "current"
  | "upcoming"
  | "missed";

export type TechCardStageDef = {
  stage: number;
  title: string;
  shortTitle: string;
  /** Підказки типів робіт для UI */
  workHints: string[];
  /** Ключові слова (lowercase uk) для match work_type */
  match: string[];
};

/** Універсальна карта для просапних (кукурудза / соняшник / соя) і fallback */
export const DEFAULT_TECH_CARD_STAGES: TechCardStageDef[] = [
  {
    stage: 1,
    title: "Осінній обробіток ґрунту",
    shortTitle: "Оранка / глибокорозпушування",
    workHints: ["Оранка", "Глибокорозпушування", "Чизелювання"],
    match: ["оран", "глибокор", "чизел", "плоскоріз", "дискув"],
  },
  {
    stage: 2,
    title: "Ранньовесняне закриття вологи",
    shortTitle: "Боронування",
    workHints: ["Боронування", "Закриття вологи"],
    match: ["борон", "волог", "шлейф"],
  },
  {
    stage: 3,
    title: "Передпосівна культивація та сівба",
    shortTitle: "Культивація + посів",
    workHints: ["Передпосівна культивація", "Посів"],
    match: ["передпосів", "посів", "сівб", "загортан"],
  },
  {
    stage: 4,
    title: "Ґрунтовий / страховий гербіцидний захист",
    shortTitle: "ЗЗР / гербіцид",
    workHints: ["Внесення ЗЗР", "Обприскування"],
    match: ["ззр", "гербіц", "обприск", "захист", "фунгіц", "інсектиц"],
  },
  {
    stage: 5,
    title: "Листкове підживлення / міжрядний обробіток",
    shortTitle: "Підживлення / міжряддя",
    workHints: ["Внесення добрив", "Міжрядний обробіток", "Культивація"],
    match: ["піджив", "добрив", "міжряд", "культив", "листков"],
  },
  {
    stage: 6,
    title: "Десикація / Збирання врожаю",
    shortTitle: "Десикація / збирання",
    workHints: ["Десикація", "Збирання"],
    match: ["десик", "збир", "жнив", "урожа"],
  },
];

export type TechCardOpInput = {
  id: string;
  workType: string;
  status: string;
  date: string | null;
  areaHa: number | null;
};

export type TechCardStageResult = {
  stage: number;
  title: string;
  shortTitle: string;
  workHints: string[];
  status: TechCardStageStatus;
  matchedOperations: Array<{
    id: string;
    workType: string;
    status: string;
    date: string | null;
    areaHa: number | null;
  }>;
};

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase("uk-UA");
}

export function matchWorkTypeToStage(
  workType: string,
  stages: TechCardStageDef[] = DEFAULT_TECH_CARD_STAGES
): number | null {
  const wt = normalize(workType);
  if (!wt) return null;

  // Спец-кейси: «культивація» без передпосів/міжряд → етап 3 якщо є «посів» поруч у назві, інакше 5
  if (wt.includes("передпосів") || wt.includes("посів") || wt.includes("сівб")) {
    return 3;
  }
  if (wt.includes("міжряд")) return 5;
  if (
    wt.includes("культив") &&
    !wt.includes("передпосів") &&
    !wt.includes("міжряд")
  ) {
    // загальна культивація частіше передпосівна навесні
    return 3;
  }

  for (const stage of stages) {
    if (stage.match.some((kw) => wt.includes(kw))) return stage.stage;
  }
  return null;
}

export function buildFieldTechCardMatrix(input: {
  crop: string | null;
  operations: TechCardOpInput[];
  stages?: TechCardStageDef[];
}): {
  crop: string;
  stages: TechCardStageResult[];
  currentStage: number | null;
  progressPercent: number;
  chainLabel: string;
} {
  const stages = input.stages ?? DEFAULT_TECH_CARD_STAGES;
  const crop = (input.crop ?? "").trim() || "—";

  const byStage = new Map<number, TechCardOpInput[]>();
  for (const op of input.operations) {
    const stageNo = matchWorkTypeToStage(op.workType, stages);
    if (stageNo == null) continue;
    const list = byStage.get(stageNo) ?? [];
    list.push(op);
    byStage.set(stageNo, list);
  }

  const hasDone = (stageNo: number) =>
    (byStage.get(stageNo) ?? []).some(
      (op) => String(op.status) === "completed"
    );
  const hasActive = (stageNo: number) =>
    (byStage.get(stageNo) ?? []).some((op) => {
      const s = String(op.status);
      return s === "in_progress" || s === "assigned";
    });

  const lastDoneStage = [...stages]
    .reverse()
    .find((s) => hasDone(s.stage))?.stage;

  let currentAssigned: number | null = null;
  for (const s of stages) {
    if (hasActive(s.stage)) {
      currentAssigned = s.stage;
      break;
    }
  }
  if (currentAssigned == null) {
    const next = stages.find((s) => !hasDone(s.stage));
    currentAssigned = next?.stage ?? null;
  }

  const results: TechCardStageResult[] = stages.map((def) => {
    const matched = byStage.get(def.stage) ?? [];
    let status: TechCardStageStatus = "upcoming";

    if (hasDone(def.stage)) {
      status = "done";
    } else if (currentAssigned === def.stage) {
      status = "current";
    } else if (
      lastDoneStage != null &&
      def.stage < lastDoneStage &&
      !hasDone(def.stage)
    ) {
      status = "missed";
    } else {
      status = "upcoming";
    }

    return {
      stage: def.stage,
      title: def.title,
      shortTitle: def.shortTitle,
      workHints: def.workHints,
      status,
      matchedOperations: matched.map((op) => ({
        id: op.id,
        workType: op.workType,
        status: op.status,
        date: op.date,
        areaHa: op.areaHa,
      })),
    };
  });

  const doneCount = results.filter((s) => s.status === "done").length;
  const progressPercent = Math.round((doneCount / stages.length) * 100);

  const chainLabel = results
    .map((s) => {
      const mark =
        s.status === "done"
          ? "✓"
          : s.status === "current"
            ? "●"
            : s.status === "missed"
              ? "○!"
              : "○";
      return `${mark}${s.stage}`;
    })
    .join(" → ");

  return {
    crop,
    stages: results,
    currentStage: currentAssigned,
    progressPercent,
    chainLabel,
  };
}
